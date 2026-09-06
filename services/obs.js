const { OBSWebSocket, EventSubscription } = require("obs-websocket-js");
const { getObsConfig, getDashboardUrl } = require("../config/liveEnv");

const obs = new OBSWebSocket();

// The credentials the live socket was opened with, so a later .env edit can be
// noticed and reconnected rather than silently ignored.
let activeCredentials = null;
// One in-flight connect attempt, shared by concurrent commands.
let connecting = null;

obs.on("ConnectionClosed", () => {
    activeCredentials = null;
});

function credentialsOf(config) {
    return JSON.stringify([config.ip, config.port, config.password]);
}

/**
 * Errors carrying a `code` and the settings that produced them, so callers can
 * tell the user which value to fix instead of "command failed".
 */
function obsError(code, message, config) {
    const err = new Error(message);
    err.code = code;
    err.obs = {
        ip: config.ip,
        port: config.port,
        scene: config.scene,
        source: config.source
    };
    return err;
}

function describeObsError(message, ip, port) {
    if (/auth/i.test(message)) return 'OBS rejected the password. Copy it from Tools -> WebSocket Server Settings -> Show Connect Info.';
    if (/ECONNREFUSED/i.test(message)) return `Nothing is listening on ${ip}:${port}. Open OBS and enable Tools -> WebSocket Server Settings.`;
    if (/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN/i.test(message)) return `Could not reach ${ip}. Check the IP address.`;
    if (/ETIMEDOUT|Timed out/i.test(message)) return `Timed out reaching ${ip}:${port}. A firewall may be blocking it.`;
    if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return `Could not resolve "${ip}". Check the IP address.`;
    return message;
}

/**
 * Connects if needed and returns the settings currently in force.
 *
 * Every OBS call goes through here, so credentials filled in after the bot
 * booted are picked up on the next command, and a socket opened against stale
 * ones is replaced instead of being reused.
 */
async function ensureConnected() {
    const config = getObsConfig();

    if (!config.connectable) {
        throw obsError('obs_not_configured', 'OBS connection details are not set in .env.', config);
    }

    const credentials = credentialsOf(config);

    if (obs.identified && activeCredentials === credentials) return config;

    if (connecting && connecting.credentials === credentials) {
        await connecting.attempt;
        return config;
    }

    // Either the socket is dead or it belongs to superseded settings.
    await obs.disconnect().catch(() => {});

    const attempt = (async () => {
        try {
            await obs.connect(`ws://${config.ip}:${config.port}`, config.password || undefined, {
                // SceneItemTransformChanged is classed as high-volume, so the
                // default subscription leaves it out - and without it nothing
                // ever hears the widget being dragged or resized.
                eventSubscriptions: EventSubscription.All | EventSubscription.SceneItemTransformChanged
            });
            activeCredentials = credentials;
        } catch (err) {
            activeCredentials = null;
            throw obsError('obs_unreachable', describeObsError(err.message, config.ip, config.port), config);
        }
    })();

    connecting = { credentials, attempt };

    try {
        await attempt;
    } finally {
        if (connecting?.attempt === attempt) connecting = null;
    }

    return config;
}

/** OBS's request error for "no such thing"; anything else is a real fault. */
function isNotFound(err) {
    return err?.code === 600 || /not found|does not exist/i.test(err?.message || '');
}

async function resolveSceneItem(config) {
    if (!config.scene || !config.source) {
        throw obsError('obs_target_missing', 'OBS_SCENE and OBS_SOURCE are not set in .env.', config);
    }

    let sceneItems;
    try {
        ({ sceneItems } = await obs.call("GetSceneItemList", { sceneName: config.scene }));
    } catch (err) {
        if (isNotFound(err)) {
            throw obsError('obs_scene_missing', `OBS has no scene named "${config.scene}".`, config);
        }
        throw err;
    }

    const item = sceneItems.find(item => item.sourceName === config.source);

    if (!item) {
        throw obsError('obs_source_missing', `Source "${config.source}" not found in scene "${config.scene}".`, config);
    }

    return item.sceneItemId;
}

async function connect() {
    const config = await ensureConnected();
    console.log(`Connected to OBS at ${config.ip}:${config.port}`);
    return config;
}

async function setTransform(transform) {
    const config = await ensureConnected();
    const sceneItemId = await resolveSceneItem(config);

    await obs.call("SetSceneItemTransform", {
        sceneName: config.scene,
        sceneItemId,
        sceneItemTransform: {
            positionX: transform.positionX,
            positionY: transform.positionY,

            scaleX: transform.scaleX,
            scaleY: transform.scaleY,

            rotation: transform.rotation,

            alignment: transform.alignment,

            cropTop: transform.cropTop,
            cropBottom: transform.cropBottom,
            cropLeft: transform.cropLeft,
            cropRight: transform.cropRight,
        },
    });

    console.log("Transform request sent");
}

async function getTransform() {
    const config = await ensureConnected();
    const sceneItemId = await resolveSceneItem(config);

    const { sceneItemTransform } = await obs.call("GetSceneItemTransform", {
        sceneName: config.scene,
        sceneItemId,
    });

    return sceneItemTransform;
}

async function moveSource(x, y) {
    const transform = await getTransform();

    transform.positionX = x;
    transform.positionY = y;

    await setTransform(transform);
}

/**
 * Resizes the widget's browser source and shrinks the scene item by the same
 * factor, so the widget keeps its on-screen size while being drawn with more
 * pixels. Returns the factor stored transforms need multiplying by.
 *
 * OBS renders a browser source at exactly its configured size; enlarging the
 * item afterwards just stretches that bitmap. Giving the page more pixels to
 * draw into is the only way to stay sharp when the widget is big on screen.
 */
async function setWidgetResolution({ width, height }) {
    const config = await ensureConnected();
    const sceneItemId = await resolveSceneItem(config);

    const { inputKind } = await obs.call('GetInputSettings', { inputName: config.source });

    if (!/browser/i.test(inputKind || '')) {
        throw obsError(
            'obs_not_browser_source',
            `"${config.source}" is a ${inputKind || 'non-browser'} source, so its render size cannot be set here.`,
            config
        );
    }

    const { sceneItemTransform: before } = await obs.call('GetSceneItemTransform', {
        sceneName: config.scene,
        sceneItemId
    });

    // Already the right size: touching it would only make OBS re-render.
    if (before.sourceWidth === width && before.sourceHeight === height) {
        return {
            scene: config.scene,
            source: config.source,
            width,
            height,
            previousWidth: width,
            previousHeight: height,
            factorX: 1,
            factorY: 1,
            unchanged: true,
            bounded: Boolean(before.boundsType && before.boundsType !== 'OBS_BOUNDS_NONE')
        };
    }

    // sourceWidth is the browser source's own pixel size, which is what the
    // scale is relative to - not what the item measures on the canvas.
    const previousWidth = before.sourceWidth || width;
    const previousHeight = before.sourceHeight || height;
    const factorX = previousWidth / width;
    const factorY = previousHeight / height;

    await obs.call('SetInputSettings', {
        inputName: config.source,
        inputSettings: { width, height }
    });

    // A bounded item is sized by its bounding box, so its footprint already
    // survives the resize; only a free-scaled item needs compensating.
    const bounded = before.boundsType && before.boundsType !== 'OBS_BOUNDS_NONE';

    if (!bounded) {
        await obs.call('SetSceneItemTransform', {
            sceneName: config.scene,
            sceneItemId,
            sceneItemTransform: {
                scaleX: (before.scaleX || 1) * factorX,
                scaleY: (before.scaleY || 1) * factorY
            }
        });
    }

    return {
        scene: config.scene,
        source: config.source,
        width,
        height,
        previousWidth,
        previousHeight,
        factorX,
        factorY,
        bounded: Boolean(bounded)
    };
}

/**
 * Calls back once OBS has accepted a connection - at startup, and again every
 * time OBS is closed and reopened while the bot runs.
 */
function onConnected(listener) {
    obs.on('Identified', listener);
    return () => obs.off('Identified', listener);
}

/**
 * Calls back when someone moves or resizes a scene item in OBS.
 *
 * Registered once; the listener itself works out whether the item that changed
 * is the widget, because the scene and source names can change under it.
 */
function onSceneItemTransformChanged(listener) {
    obs.on('SceneItemTransformChanged', listener);
    return () => obs.off('SceneItemTransformChanged', listener);
}

/**
 * Where the widget sits on the OBS canvas, and how big it ends up looking.
 *
 * `sourceWidth` is how many pixels the browser source renders; multiplying by
 * the item's scale (or reading its bounding box) gives what the viewer sees.
 * When those two differ, OBS is resampling the widget - which is what makes it
 * blurry when enlarged and crunchy when shrunk.
 */
async function getWidgetPlacement() {
    const config = await ensureConnected();
    const sceneItemId = await resolveSceneItem(config);

    const { sceneItemTransform: transform } = await obs.call('GetSceneItemTransform', {
        sceneName: config.scene,
        sceneItemId
    });

    const bounded = Boolean(transform.boundsType && transform.boundsType !== 'OBS_BOUNDS_NONE');

    const displayedWidth = bounded ? transform.boundsWidth : transform.sourceWidth * (transform.scaleX || 1);
    const displayedHeight = bounded ? transform.boundsHeight : transform.sourceHeight * (transform.scaleY || 1);

    return {
        scene: config.scene,
        source: config.source,
        sceneItemId,
        bounded,
        sourceWidth: transform.sourceWidth,
        sourceHeight: transform.sourceHeight,
        scaleX: transform.scaleX || 1,
        scaleY: transform.scaleY || 1,
        displayedWidth,
        displayedHeight,
        transform
    };
}

const MIN_SOURCE_SIZE = 40;
const MAX_SOURCE_SIZE = 4096;

function clampSize(value, fallback) {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(Math.max(Math.round(value), MIN_SOURCE_SIZE), MAX_SOURCE_SIZE);
}

/**
 * Sizes the browser source for a widget being shown at `displayed` size, given
 * the size its theme was designed at.
 *
 * Two ways to get this wrong, and both look bad:
 *
 * - Render fewer pixels than the design and the layout is squashed - a 38px
 *   title drawn at 20px, on fractional pixel positions. That reads as blurry.
 * - Render far more than is shown and OBS has to throw most of them away with
 *   a bilinear filter, which is what makes text look fried.
 *
 * So: never render below the design size, never more than twice what is shown,
 * and let the scene item's scale take up whatever slack is left. Shown bigger
 * than designed, the page simply renders bigger and the item stays at 1:1.
 */
// How much bigger than the displayed size the page may be rendered. Past this
// OBS's downscale starts to bite; below it, extra pixels only sharpen things.
const SUPERSAMPLE_LIMIT = 2.5;

function sourceSizeFor(displayed, design) {
    // Render the design at full size, or bigger if the widget is shown bigger.
    // Anything less squashes the layout, which is what "blurry" really was.
    const ideal = Math.max(design, displayed);

    // The one exception: a widget shrunk to a fraction of its design would
    // leave OBS throwing most of the pixels away, so cap how far that goes.
    const capped = Math.min(ideal, displayed * SUPERSAMPLE_LIMIT);

    return clampSize(capped, design);
}

/**
 * Gives the browser source the right number of pixels for the size the widget
 * is displayed at, and sets the scene item's scale to suit.
 */
async function matchWidgetToScreen({ designWidth, designHeight } = {}) {
    const placement = await getWidgetPlacement();
    const config = getObsConfig();

    const { inputKind } = await obs.call('GetInputSettings', { inputName: placement.source });

    if (!/browser/i.test(inputKind || '')) {
        throw obsError(
            'obs_not_browser_source',
            `"${placement.source}" is a ${inputKind || 'non-browser'} source, so its render size cannot be set here.`,
            config
        );
    }

    const width = sourceSizeFor(placement.displayedWidth, designWidth || placement.displayedWidth);
    const height = sourceSizeFor(placement.displayedHeight, designHeight || placement.displayedHeight);

    // Whatever is left over after the source has been sized is the item's job.
    const wantedScaleX = placement.displayedWidth / width;
    const wantedScaleY = placement.displayedHeight / height;

    const alreadyMatched =
        placement.sourceWidth === width &&
        placement.sourceHeight === height &&
        (placement.bounded || (
            Math.abs(placement.scaleX - wantedScaleX) < 0.002 &&
            Math.abs(placement.scaleY - wantedScaleY) < 0.002
        ));

    if (alreadyMatched) {
        return { ...placement, width, height, unchanged: true, factorX: 1, factorY: 1 };
    }

    await obs.call('SetInputSettings', {
        inputName: placement.source,
        inputSettings: { width, height }
    });

    // A bounded item is sized by its box, so OBS keeps its footprint for us.
    if (!placement.bounded) {
        await obs.call('SetSceneItemTransform', {
            sceneName: placement.scene,
            sceneItemId: placement.sceneItemId,
            sceneItemTransform: { scaleX: wantedScaleX, scaleY: wantedScaleY }
        });
    }

    return {
        ...placement,
        width,
        height,
        unchanged: false,
        // Saved presets hold the scale that went with the old source size.
        factorX: (placement.sourceWidth || width) / width,
        factorY: (placement.sourceHeight || height) / height
    };
}

/**
 * Presses "Refresh cache of current page" on the widget's browser source.
 *
 * The widget reloads itself when a theme changes, but only if its page is
 * still connected - an OBS source that was suspended, or one showing a page
 * from before the bot restarted, needs OBS to reload it.
 */
async function refreshWidgetSource() {
    const config = await ensureConnected();

    if (!config.source) {
        throw obsError('obs_target_missing', 'OBS_SOURCE is not set in .env.', config);
    }

    await obs.call('PressInputPropertiesButton', {
        inputName: config.source,
        propertyName: 'refreshnocache'
    });

    return { source: config.source };
}

/**
 * Verifies OBS credentials with a throwaway connection and reports the scenes
 * and sources it finds, so setup can offer real choices instead of asking the
 * user to type exact names. Never touches the long-lived `obs` client above.
 */
async function testConnection({ ip, port, password, timeoutMs = 8000 }) {
    const probe = new OBSWebSocket();

    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out reaching OBS. Is the WebSocket server enabled?')), timeoutMs);
    });

    try {
        await Promise.race([
            probe.connect(`ws://${ip}:${port}`, password || undefined),
            timeout
        ]);

        const { scenes } = await probe.call('GetSceneList');
        const named = scenes.map(scene => scene.sceneName).slice(0, 25);

        const detail = [];
        for (const sceneName of named) {
            try {
                const { sceneItems } = await probe.call('GetSceneItemList', { sceneName });
                detail.push({ scene: sceneName, sources: sceneItems.map(item => item.sourceName) });
            } catch {
                detail.push({ scene: sceneName, sources: [] });
            }
        }

        return { ok: true, scenes: detail };
    } catch (err) {
        return { ok: false, error: describeObsError(err.message, ip, port) };
    } finally {
        // Without this the pending timer keeps the event loop alive for the
        // full timeout even after the probe has already resolved or failed.
        clearTimeout(timer);
        await probe.disconnect().catch(() => {});
    }
}

/**
 * Maps an OBS failure onto the chat message that tells the user what to fix.
 * Returns null for anything that is not an OBS configuration problem.
 */
function describeFailure(err) {
    const details = err?.obs || {};
    // Every one of these is fixed in the dashboard, which is running right now.
    const dashboard = getDashboardUrl();

    switch (err?.code) {
        case 'obs_not_configured':
        case 'obs_target_missing':
            return { key: 'widget.obsNotConfigured', values: { dashboard } };
        case 'obs_unreachable':
            return { key: 'widget.obsUnreachable', values: { ip: details.ip || '?', port: details.port || '?' } };
        case 'obs_scene_missing':
            return { key: 'widget.obsSceneMissing', values: { scene: details.scene || '', dashboard } };
        case 'obs_source_missing':
            return { key: 'widget.obsSourceMissing', values: { scene: details.scene || '', source: details.source || '', dashboard } };
        default:
            return null;
    }
}

module.exports = {
    connect,
    ensureConnected,
    moveSource,
    getTransform,
    setTransform,
    setWidgetResolution,
    getWidgetPlacement,
    matchWidgetToScreen,
    sourceSizeFor,
    onSceneItemTransformChanged,
    onConnected,
    refreshWidgetSource,
    testConnection,
    describeFailure
};
