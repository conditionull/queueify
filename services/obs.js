const { OBSWebSocket, EventSubscription } = require("obs-websocket-js");
const { getObsConfig, getDashboardUrl } = require("../config/liveEnv");
const widgetPresets = require("./widgetPresets");

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
 * Calls back once OBS has accepted a connection - at startup, and again every
 * time OBS is closed and reopened while the bot runs.
 */
function onConnected(listener) {
    obs.on('Identified', listener);
    return () => obs.off('Identified', listener);
}

/**
 * Calls back whenever OBS cuts to a different scene.
 *
 * This is what lets a theme belong to a scene: gameplay gets the slim strip,
 * the chatting scene gets the big panel, and switching between them in OBS is
 * the whole gesture.
 */
function onProgramSceneChanged(listener) {
    const handler = event => listener(event?.sceneName);

    obs.on('CurrentProgramSceneChanged', handler);
    return () => obs.off('CurrentProgramSceneChanged', handler);
}

/** The scene OBS is showing right now, so a mapping can be applied on startup. */
async function currentProgramScene() {
    await ensureConnected();
    const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene');
    return currentProgramSceneName;
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

// How much bigger than the displayed size the page may be rendered. Past this
// OBS's downscale starts to bite; below it, extra pixels only sharpen things.
const SUPERSAMPLE_LIMIT = 2.5;

// How far the footprint's shape may drift from the design's before it counts
// as a different shape rather than rounding.
const ASPECT_TOLERANCE = 0.01;

/**
 * How many pixels to render the design with, and how big it should end up on
 * the canvas - both in the design's own proportions.
 *
 * Sizing each axis on its own was the bug behind "the theme is cut off" and
 * "it goes weird until I nudge it". The footprint on the canvas belongs to
 * whatever design was there before, so a tall theme dropped into a wide slot
 * got a wide, short browser source: the page then drew 300 x 406 into 680 x
 * 406 and OBS squashed the lot back down to 680 x 192.
 *
 * So the design's ratio is what decides, on both counts. A footprint of a
 * different shape is refitted - the design goes *inside* the space the old one
 * had, never spilling past it - and one factor sizes both axes, so the page is
 * only ever asked to render the shape it was drawn at.
 */
function renderSizeFor({ displayedWidth, displayedHeight, designWidth, designHeight }) {
    const designW = designWidth > 0 ? designWidth : displayedWidth;
    const designH = designHeight > 0 ? designHeight : displayedHeight;

    let shownWidth = displayedWidth > 0 ? displayedWidth : designW;
    let shownHeight = displayedHeight > 0 ? displayedHeight : designH;

    const wantedRatio = designW / designH;
    const shownRatio = shownWidth / shownHeight;
    const refitted = Math.abs(shownRatio - wantedRatio) > wantedRatio * ASPECT_TOLERANCE;

    if (refitted) {
        const fit = Math.min(shownWidth / designW, shownHeight / designH);
        shownWidth = designW * fit;
        shownHeight = designH * fit;
    }

    // One factor, both axes. The page is zoomed by this same number, so the
    // design always fills its browser source exactly - which is what stops
    // anything being cropped no matter how small the widget is on screen.
    let factor = shownWidth / designW;

    // Never below the design's own size, or the layout is drawn squashed;
    // never more than SUPERSAMPLE_LIMIT times what is shown, or OBS throws
    // most of the pixels away and the text goes crunchy.
    factor = factor >= 1 ? factor : Math.min(1, factor * SUPERSAMPLE_LIMIT);

    // Held inside what OBS accepts for a browser source, still in one piece:
    // clamping the two axes separately is what would bend the ratio again.
    factor = Math.min(factor, MAX_SOURCE_SIZE / Math.max(designW, designH));
    factor = Math.max(factor, MIN_SOURCE_SIZE / Math.min(designW, designH));

    return {
        width: Math.round(designW * factor),
        height: Math.round(designH * factor),
        displayedWidth: shownWidth,
        displayedHeight: shownHeight,
        factor,
        refitted
    };
}

/**
 * Gives the browser source the right number of pixels for the size the widget
 * is displayed at, and sets the scene item's scale to suit.
 *
 * `place` is the rectangle the widget belongs in - a saved `!tr` / `!bc`
 * position - and when it is given, that rather than wherever the last theme
 * left the item is what gets matched.
 *
 * Doing both here, rather than resizing and then repositioning, is not tidiness.
 * OBS applies a browser source resize asynchronously: read `sourceWidth` back
 * straight afterwards and it is still the old number, so a scale worked out
 * from it is wrong by exactly the ratio of the two themes. That was the widget
 * "slightly shifting" after a scene change. The scale here is worked out
 * against the size the source is being set to, which needs no reading back.
 */
async function matchWidgetToScreen({ designWidth, designHeight, place = null } = {}) {
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

    // Where the widget should end up: the rectangle a saved position framed,
    // or the one it already occupies.
    const target = place || {
        x: placement.transform.positionX,
        y: placement.transform.positionY,
        width: placement.displayedWidth,
        height: placement.displayedHeight,
        alignment: placement.transform.alignment,
        kind: null
    };

    const fit = renderSizeFor({
        displayedWidth: target.width,
        displayedHeight: target.height,
        designWidth,
        designHeight
    });

    const { width, height } = fit;

    // Whatever is left over after the source has been sized is the item's job -
    // as one scale, worked out against the whole number of pixels the source is
    // actually being given. Dividing each axis by its own ideal rounds
    // differently on each, and sends OBS a scale that is very slightly uneven:
    // enough, over a few theme switches, to be visible.
    const scale = Math.min(fit.displayedWidth / width, fit.displayedHeight / height);
    const displayedWidth = width * scale;
    const displayedHeight = height * scale;

    // A widget that has to change size keeps the edges its command is named
    // for, rather than its top-left corner - otherwise it creeps away from the
    // bottom of the screen every time the design changes shape.
    const anchored = widgetPresets.anchorAt(target, displayedWidth, displayedHeight, target.kind);

    const inPlace =
        Math.abs(anchored.x - placement.transform.positionX) < 0.5 &&
        Math.abs(anchored.y - placement.transform.positionY) < 0.5;

    const alreadyMatched =
        placement.sourceWidth === width &&
        placement.sourceHeight === height &&
        !fit.refitted &&
        inPlace &&
        (placement.bounded || (
            Math.abs(placement.scaleX - scale) < 0.002 &&
            Math.abs(placement.scaleY - scale) < 0.002
        ));

    if (alreadyMatched) {
        return {
            ...placement,
            width,
            height,
            positionX: placement.transform.positionX,
            positionY: placement.transform.positionY,
            unchanged: true,
            refitted: false
        };
    }

    await obs.call('SetInputSettings', {
        inputName: placement.source,
        inputSettings: { width, height }
    });

    // One write, and the numbers in it are worked out against the size the
    // source is being set to just above - never against a size read back from
    // OBS, which would still be the old one.
    const sceneItemTransform = {
        positionX: anchored.x,
        positionY: anchored.y
    };

    if (placement.bounded) {
        // A bounding box keeps the item's footprint for us, so normally there
        // is nothing to do. The exception is a box of the wrong shape: OBS
        // will happily stretch the new design to fill it, which is the squash
        // this whole function exists to avoid.
        sceneItemTransform.boundsWidth = displayedWidth;
        sceneItemTransform.boundsHeight = displayedHeight;
    } else {
        sceneItemTransform.scaleX = scale;
        sceneItemTransform.scaleY = scale;
    }

    await obs.call('SetSceneItemTransform', {
        sceneName: placement.scene,
        sceneItemId: placement.sceneItemId,
        sceneItemTransform
    });

    return {
        ...placement,
        width,
        height,
        positionX: anchored.x,
        positionY: anchored.y,
        displayedWidth,
        displayedHeight,
        unchanged: false,
        refitted: fit.refitted
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
    getWidgetPlacement,
    matchWidgetToScreen,
    renderSizeFor,
    onSceneItemTransformChanged,
    onProgramSceneChanged,
    currentProgramScene,
    onConnected,
    refreshWidgetSource,
    testConnection,
    describeFailure
};
