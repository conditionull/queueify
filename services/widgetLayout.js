const fs = require('fs');
const path = require('path');

const obs = require('./obs');
const themeStore = require('./themeStore');
const widgetPresets = require('./widgetPresets');
const { getObsConfig } = require('../config/liveEnv');
const state = require('../core/state');

/**
 * Makes the widget render at exactly the size it is shown at.
 *
 * OBS resamples a browser source whenever the pixels it renders and the size
 * it is displayed at disagree: stretched up it goes soft, squeezed down it
 * goes crunchy - the "deep fried" look. Neither is fixed by rendering more
 * pixels and letting OBS shrink them, because OBS downsamples with a plain
 * bilinear filter.
 *
 * So the widget is measured against the canvas instead: the browser source is
 * given as many pixels as the item occupies, the item's scale goes back to
 * 1:1, and the page is zoomed by the same amount so the design fills it. Every
 * pixel is then drawn once, at its final size.
 */

const CONFIG_FILE = process.env.QUEUEIFY_WIDGET_CONFIG_FILE
    || path.join(__dirname, '..', 'widget', 'config.json');

const WIDGET_URL = process.env.QUEUEIFY_WIDGET_URL || 'http://localhost:3001';

// What a theme is designed at when it does not say - the size Queueify's
// hand-written themes have always been documented with.
const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 192;
const MAX_RENDER_SCALE = 4;

// Our own writes come back as the same event the resize watcher listens for;
// ignore the echo for a moment after making one.
let quietUntil = 0;

function readWidgetConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

const MIN_RENDER_SCALE = 0.25;

/**
 * How much the page is zoomed. Automatic matching produces fractional values
 * (a widget shown at 850px wide from a 680px design is 1.25x), so this is not
 * rounded to a whole number.
 */
function renderScaleOf(config) {
    const scale = Number(config.renderScale);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.min(Math.max(scale, MIN_RENDER_SCALE), MAX_RENDER_SCALE);
}

// Sizing is not a setting. There is one right answer for a given design and a
// given size on the canvas, and Queueify works it out.
function isAutomatic() {
    return true;
}

/**
 * The size the active theme is drawn at, and the zoom currently in force.
 *
 * Editor themes carry their canvas size; hand-written ones state it in their
 * own stylesheet, so `minimal` is correctly 400x36 rather than an assumed
 * 680x192.
 */
function requiredSize(config = readWidgetConfig()) {
    const scale = renderScaleOf(config);
    const designed = themeStore.canvasSizeOf(config.theme || '');

    const designWidth = designed ? designed.width : DEFAULT_WIDTH;
    const designHeight = designed ? designed.height : DEFAULT_HEIGHT;

    return {
        theme: config.theme || 'default',
        renderScale: scale,
        designWidth,
        designHeight,
        width: Math.round(designWidth * scale),
        height: Math.round(designHeight * scale)
    };
}

/**
 * Remembers where a theme's widget is on the canvas, so coming back to it puts
 * it there again.
 *
 * A `!tr` / `!bc` preset says where a theme *belongs*. This is the weaker,
 * broader thing: where it actually was. Somebody who never uses those commands
 * and simply drags the widget where they want it had no such record, so
 * switching away and back re-fitted the design into whatever rectangle the
 * other theme had left - and because fitting only ever shrinks, the widget got
 * smaller on every single switch.
 *
 * The positioning mode in force is stored with it. Running `!tr` afterwards is
 * a deliberate "put it top right", and has to win over a spot remembered
 * before it was asked for.
 */
function recordPlacement(theme, rect) {
    if (!theme || !rect) return null;

    const width = Number(rect.width);
    const height = Number(rect.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    const remembered = {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width,
        height,
        alignment: Number.isFinite(rect.alignment) ? rect.alignment : widgetPresets.TOP_LEFT,
        kind: widgetPresets.kindOf(state.activeWidgetPosition)
    };

    const previous = (state.widgetPositions || {})[theme];
    const unchanged = previous
        && Math.abs(previous.x - remembered.x) < 0.5
        && Math.abs(previous.y - remembered.y) < 0.5
        && Math.abs(previous.width - remembered.width) < 0.5
        && Math.abs(previous.height - remembered.height) < 0.5
        && previous.kind === remembered.kind;

    if (unchanged) return previous;

    state.widgetPositions[theme] = remembered;
    state.saveSettings();
    return remembered;
}

/** Reads the widget's rectangle out of OBS and remembers it for `theme`. */
async function rememberPosition(theme) {
    if (!theme || !getObsConfig().configured) return null;

    try {
        const placement = await obs.getWidgetPlacement();

        return recordPlacement(theme, {
            x: placement.transform.positionX,
            y: placement.transform.positionY,
            width: placement.displayedWidth,
            height: placement.displayedHeight,
            alignment: placement.transform.alignment
        });
    } catch {
        // OBS is not there. Nothing to remember, and nothing broken by it.
        return null;
    }
}

/**
 * The remembered rectangle for a theme, if it still speaks for the positioning
 * mode in force. Running `!tr` after dragging the widget about means top right
 * is what was asked for, so the drag no longer counts.
 */
function lastPositionFor(theme, kind) {
    const last = (state.widgetPositions || {})[theme];
    if (!last || last.kind !== kind) return null;
    if (!(last.width > 0) || !(last.height > 0)) return null;

    return {
        x: last.x,
        y: last.y,
        width: last.width,
        height: last.height,
        alignment: Number.isFinite(last.alignment) ? last.alignment : widgetPresets.TOP_LEFT
    };
}

/**
 * Puts the widget back where this theme was framed with `!tr` / `!bc`.
 *
 * Switching theme changes the widget's size, and OBS holds a scene item by its
 * top-left corner - so a bottom-centred widget that gets smaller creeps up and
 * to the left, and one that gets bigger runs off the screen. Each theme has
 * its own saved position for exactly this reason; this is what puts it back.
 */
async function restorePosition(theme, { kind = null } = {}) {
    const wanted = widgetPresets.kindOf(kind || state.activeWidgetPosition);
    const presets = state.widgetPresets || {};

    // `!tr` and `!bc` mean their own preset and nothing else - that is the
    // whole point of typing them. Everything else (a theme switch, a scene
    // change) wants wherever this theme actually was: the same thing when a
    // preset put it there, and the right thing when a person did.
    const framed = (kind ? null : lastPositionFor(theme, wanted))
        || widgetPresets.footprintOf(presets[widgetPresets.nameFor(wanted, theme)])
        // A position saved before themes had their own is the only one
        // somebody upgrading has, so it still counts.
        || widgetPresets.footprintOf(presets[wanted]);

    if (!framed) return { applied: false, reason: 'no_preset', kind: wanted };

    // Through the same single pass that sizes the browser source. The scale
    // that lands the widget in this rectangle depends on how many pixels the
    // source is about to have, and only that pass knows the answer before OBS
    // does - asking OBS straight after a resize gets the old number back.
    const result = await reconcile({ place: { ...framed, kind: wanted } });
    return { ...result, kind: wanted };
}

/**
 * Brings OBS in line with the widget as it stands. Safe to call whenever the
 * theme or sharpness changes, and on startup: it does nothing when the source
 * is already right.
 */
/**
 * Writes the zoom the page should use. Goes through the widget server when it
 * is running so open widgets reload themselves; otherwise straight to the file.
 */
async function saveRenderScale(scale) {
    const rounded = Math.round(scale * 100) / 100;
    const config = readWidgetConfig();

    if (renderScaleOf(config) === rounded) return false;

    try {
        const res = await fetch(`${WIDGET_URL}/api/widget/render-scale`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scale: rounded })
        });

        if (res.ok) return true;
    } catch {
        // No widget server running - fall through to the file.
    }

    config.renderScale = rounded;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
    return true;
}

/**
 * Puts a theme on screen.
 *
 * Goes through the widget server when it is running, so every open widget
 * reloads itself; `npm run setup` on its own has no widget server, and then
 * the config file is the only copy there is.
 */
async function activateTheme(theme) {
    // Before anything moves: where the outgoing theme was is only knowable
    // now, and it is exactly what coming back to it needs.
    const leaving = readWidgetConfig().theme;
    if (leaving && leaving !== theme) await rememberPosition(leaving);

    try {
        const res = await fetch(`${WIDGET_URL}/api/widget/theme`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme })
        });

        if (res.ok) return { live: true };

        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || `Widget server refused the change (${res.status})`);
    } catch (err) {
        // A refusal is a real answer and must not be papered over; only a
        // server that is not there falls back to the file.
        if (!(err instanceof TypeError || err.cause)) throw err;

        const config = readWidgetConfig();
        config.theme = theme;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        return { live: false };
    }
}

/**
 * Whether a widget page is connected and will therefore reload itself.
 *
 * Fails safe: anything unexpected counts as "not listening", and OBS gets the
 * reload it would always have had.
 */
async function widgetIsListening() {
    try {
        const res = await fetch(`${WIDGET_URL}/api/widget/config`);
        if (!res.ok) return false;

        return Number((await res.json()).clients) > 0;
    } catch {
        return false;
    }
}

/**
 * Brings OBS and the widget in line with each other. Safe to call whenever the
 * theme changes, when the item is moved or resized in OBS, and on startup: it
 * does nothing when everything already matches.
 */
async function reconcile({ refresh = true, design = null, place = null } = {}) {
    if (!getObsConfig().configured) {
        return { applied: false, reason: 'obs_not_configured' };
    }

    const config = readWidgetConfig();
    // Normally the live theme decides. The editor passes its own design in, so
    // "make OBS fit this" can size for the theme being worked on - without it,
    // the fit button set the source and the live theme's size promptly undid
    // the change.
    const needed = design && design.width > 0 && design.height > 0
        ? { ...requiredSize(config), designWidth: design.width, designHeight: design.height }
        : requiredSize(config);

    // Without this the resize watcher chases our own writes, and a theme
    // switch becomes two reconciles fighting over the same scene item.
    quietUntil = Date.now() + 2500;

    try {
        const matched = await obs.matchWidgetToScreen({
            designWidth: needed.designWidth,
            designHeight: needed.designHeight,
            place
        });

        // The page is zoomed to fill however many pixels the source now has.
        // At or above the design size that is 1 or more, so the layout is never
        // squashed; below it, OBS does a gentle downscale of a full-size render.
        const scale = matched.width / (needed.designWidth || DEFAULT_WIDTH);
        const scaleChanged = await saveRenderScale(scale);

        // Where the widget ended up is where it should be found next time.
        recordPlacement(needed.theme, {
            x: matched.positionX,
            y: matched.positionY,
            width: matched.displayedWidth,
            height: matched.displayedHeight,
            alignment: matched.transform ? matched.transform.alignment : undefined
        });

        // A widget that is connected reloads itself when the theme changes, so
        // reloading the OBS source as well is a second blank browser source
        // for no reason. This is only for the copy that cannot hear us: a
        // source that was suspended, or one showing a page from before the bot
        // started - neither of which is listening.
        if (refresh && !(await widgetIsListening())) {
            await obs.refreshWidgetSource().catch(() => {});
        }

        return {
            applied: true,
            changed: !matched.unchanged || scaleChanged,
            width: matched.width,
            height: matched.height,
            displayedWidth: Math.round(matched.displayedWidth),
            displayedHeight: Math.round(matched.displayedHeight),
            renderScale: Math.round(scale * 100) / 100,
            refitted: Boolean(matched.refitted),
            designWidth: needed.designWidth,
            designHeight: needed.designHeight,
            theme: needed.theme
        };
    } catch (err) {
        return { applied: false, reason: err.code || 'error', message: err.message, error: err, ...needed };
    } finally {
        // Long enough for OBS to have applied the resize and stopped
        // announcing it, short enough that a real drag is still picked up.
        quietUntil = Date.now() + 1500;
    }
}

/* ------------------------------------------------------- the fit report */

/**
 * The positions saved for one theme, and whether each still frames it exactly.
 *
 * Only the theme's own positions count here. A position saved before themes
 * had their own is still *used* as a fallback by the chat commands, but it
 * belongs to no theme in particular - reporting it under whichever theme
 * happens to be open told people to run `!tr set` for a position they had
 * never set, which is worse than saying nothing.
 *
 * A preset survives the browser source being resized; that is the point of
 * storing a rectangle rather than a scale. What it cannot survive is the
 * design changing shape, and that is the only thing worth a warning.
 */
function presetsFor(themeName, design) {
    if (!themeName) return [];

    const saved = state.widgetPresets || {};
    const presets = [];

    for (const [kind, { command, holds }] of Object.entries(widgetPresets.KINDS)) {
        const preset = saved[widgetPresets.nameFor(kind, themeName)];
        if (!preset) continue;

        const framed = widgetPresets.footprintOf(preset);

        presets.push({
            kind,
            command,
            holds,
            stale: !widgetPresets.fitsShape(preset, design),
            framedWidth: framed ? Math.round(framed.width) : null,
            framedHeight: framed ? Math.round(framed.height) : null
        });
    }

    return presets;
}

/**
 * Everything the theme editor needs to say something true about OBS.
 *
 * The editor used to compare a design against the *live* theme's size, which
 * is a different theme's number: it warned about designs that were fine,
 * stayed quiet about ones that were not, and never changed its mind after a
 * theme was switched. This asks OBS what the browser source actually is.
 */
async function describeFit({ theme, width, height } = {}) {
    const config = readWidgetConfig();
    const obsConfig = getObsConfig();

    const design = width > 0 && height > 0
        ? { width: Math.round(width), height: Math.round(height) }
        : themeStore.canvasSizeOf(theme || config.theme || '') || { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

    const report = {
        theme: theme || null,
        liveTheme: config.theme || 'default',
        live: Boolean(theme) && theme === (config.theme || 'default'),
        design,
        renderScale: renderScaleOf(config),
        obsConfigured: obsConfig.configured,
        connected: false,
        source: null,
        displayed: null,
        needed: { width: design.width, height: design.height },
        presets: presetsFor(theme || config.theme || '', design)
    };

    if (!obsConfig.configured) return report;

    try {
        const placement = await obs.getWidgetPlacement();

        const fit = obs.renderSizeFor({
            displayedWidth: placement.displayedWidth,
            displayedHeight: placement.displayedHeight,
            designWidth: design.width,
            designHeight: design.height
        });

        report.connected = true;
        report.source = { width: placement.sourceWidth, height: placement.sourceHeight };
        report.displayed = {
            width: Math.round(placement.displayedWidth),
            height: Math.round(placement.displayedHeight)
        };
        report.needed = { width: fit.width, height: fit.height };
        report.matched = placement.sourceWidth === fit.width && placement.sourceHeight === fit.height && !fit.refitted;
    } catch (err) {
        report.reason = err.code || 'error';
        report.message = err.message;
    }

    return report;
}

let pending = null;

/**
 * Re-matches the widget whenever it is moved or resized in OBS.
 *
 * Dragging a browser source bigger is exactly when a widget would go blurry,
 * so that is the moment to re-render it at its new size. Debounced, because
 * OBS fires this for every pixel of a drag.
 */
function watchObsResizes({ debounceMs = 900 } = {}) {
    return obs.onSceneItemTransformChanged(async event => {
        if (Date.now() < quietUntil) return;

        const config = getObsConfig();
        if (!config.configured || event.sceneName !== config.scene) return;

        clearTimeout(pending);
        pending = setTimeout(async () => {
            // Only act when the source is no longer the size the rule wants.
            // Moving a widget, or shrinking one that is already rendering its
            // design in full, needs no re-render.
            try {
                const placement = await obs.getWidgetPlacement();
                const design = requiredSize();

                // Dragging the widget somewhere is a placement like any other,
                // and the one that people who never touch !tr / !bc rely on.
                recordPlacement(design.theme, {
                    x: placement.transform.positionX,
                    y: placement.transform.positionY,
                    width: placement.displayedWidth,
                    height: placement.displayedHeight,
                    alignment: placement.transform.alignment
                });

                const fit = obs.renderSizeFor({
                    displayedWidth: placement.displayedWidth,
                    displayedHeight: placement.displayedHeight,
                    designWidth: design.designWidth,
                    designHeight: design.designHeight
                });

                if (!fit.refitted && placement.sourceWidth === fit.width && placement.sourceHeight === fit.height) return;

                quietUntil = Date.now() + 4000;
                const result = await reconcile();

                if (result.applied && result.changed) {
                    console.log(`Widget resized in OBS: now rendering at ${result.width} x ${result.height}.`);
                }
            } catch {
                // OBS went away mid-drag; the next command reconnects.
            } finally {
                quietUntil = Date.now() + 1500;
            }
        }, debounceMs);
    });
}

/**
 * Sizes and reloads the widget every time OBS connects.
 *
 * Opening OBS after the bot has started leaves the browser source showing
 * whatever it had cached, which is why it used to need a manual Refresh. This
 * catches the first connection and every reconnection after it.
 */
function refreshOnConnect() {
    return obs.onConnected(async () => {
        try {
            const result = await reconcile();

            if (result.applied && result.changed) {
                console.log(`Widget sized for OBS: rendering at ${result.width} x ${result.height}.`);
            }
        } catch {
            // OBS went away again; the next command reconnects.
        }
    });
}

/**
 * Pulls the widget back onto the canvas if it has been dragged off the edge.
 *
 * Easy to do by accident while framing a shot, and the widget then renders
 * partly or entirely outside what viewers see.
 */
async function nudgeOnScreen({ canvasWidth = 1920, canvasHeight = 1080 } = {}) {
    if (!getObsConfig().configured) {
        return { applied: false, reason: 'obs_not_configured' };
    }

    // Make sure the source is the right size for the live theme first, so the
    // numbers below describe the widget as it will actually be shown.
    await reconcile();

    const placement = await obs.getWidgetPlacement();
    const design = requiredSize();

    const scaleX = placement.displayedWidth / placement.sourceWidth;
    const scaleY = placement.displayedHeight / placement.sourceHeight;

    const x = Math.min(Math.max(placement.transform.positionX, 0), canvasWidth - placement.displayedWidth);
    const y = Math.min(Math.max(placement.transform.positionY, 0), canvasHeight - placement.displayedHeight);

    if (x === placement.transform.positionX && y === placement.transform.positionY) {
        return { applied: true, moved: false };
    }

    await obs.setTransform({
        ...placement.transform,
        positionX: x,
        positionY: y,
        scaleX,
        scaleY
    });

    return { applied: true, moved: true, x, y, designWidth: design.designWidth };
}

/** Reloads the widget in OBS without changing anything else. */
async function refresh() {
    if (!getObsConfig().configured) {
        return { applied: false, reason: 'obs_not_configured' };
    }

    try {
        await obs.refreshWidgetSource();
        return { applied: true };
    } catch (err) {
        return { applied: false, reason: err.code || 'error', message: err.message };
    }
}

module.exports = {
    CONFIG_FILE,
    isAutomatic,
    saveRenderScale,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    readWidgetConfig,
    renderScaleOf,
    requiredSize,
    activateTheme,
    restorePosition,
    rememberPosition,
    recordPlacement,
    lastPositionFor,
    presetsFor,
    describeFit,
    reconcile,
    nudgeOnScreen,
    refresh,
    watchObsResizes,
    refreshOnConnect
};
