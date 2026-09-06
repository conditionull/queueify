const fs = require('fs');
const path = require('path');

const obs = require('./obs');
const themeStore = require('./themeStore');
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
 * Saved !tr / !bc presets carry the scale the item had at the old source size,
 * so they move by the same factor the scene item just did. Without this,
 * recalling a preset after a resize would resize the widget on screen.
 */
function rescalePresets(factorX, factorY) {
    if (factorX === 1 && factorY === 1) return 0;

    let changed = 0;

    for (const preset of Object.values(state.widgetPresets || {})) {
        if (!preset) continue;
        if (typeof preset.scaleX === 'number') preset.scaleX *= factorX;
        if (typeof preset.scaleY === 'number') preset.scaleY *= factorY;
        changed++;
    }

    if (changed) state.saveSettings();
    return changed;
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
 * Brings OBS and the widget in line with each other. Safe to call whenever the
 * theme changes, when the item is moved or resized in OBS, and on startup: it
 * does nothing when everything already matches.
 */
async function reconcile({ refresh = true } = {}) {
    if (!getObsConfig().configured) {
        return { applied: false, reason: 'obs_not_configured' };
    }

    const config = readWidgetConfig();
    const needed = requiredSize(config);

    try {
        const matched = await obs.matchWidgetToScreen({
            designWidth: needed.designWidth,
            designHeight: needed.designHeight
        });

        const presetsAdjusted = matched.unchanged ? 0 : rescalePresets(matched.factorX, matched.factorY);

        // The page is zoomed to fill however many pixels the source now has.
        // At or above the design size that is 1 or more, so the layout is never
        // squashed; below it, OBS does a gentle downscale of a full-size render.
        const scale = matched.width / (needed.designWidth || DEFAULT_WIDTH);
        const scaleChanged = await saveRenderScale(scale);

        // Always reload afterwards: OBS caches the page, and a source that was
        // opened before the bot started is showing a stale one.
        if (refresh) await obs.refreshWidgetSource().catch(() => {});

        return {
            applied: true,
            changed: !matched.unchanged || scaleChanged,
            width: matched.width,
            height: matched.height,
            displayedWidth: Math.round(matched.displayedWidth),
            displayedHeight: Math.round(matched.displayedHeight),
            renderScale: Math.round(scale * 100) / 100,
            presetsAdjusted,
            designWidth: needed.designWidth,
            designHeight: needed.designHeight,
            theme: needed.theme
        };
    } catch (err) {
        return { applied: false, reason: err.code || 'error', message: err.message, ...needed };
    }
}

// Our own resize fires the same event we listen for; ignore the echo.
let quietUntil = 0;
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

                const wantedWidth = obs.sourceSizeFor(placement.displayedWidth, design.designWidth);
                const wantedHeight = obs.sourceSizeFor(placement.displayedHeight, design.designHeight);

                if (placement.sourceWidth === wantedWidth && placement.sourceHeight === wantedHeight) return;

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
    rescalePresets,
    reconcile,
    refresh,
    watchObsResizes,
    refreshOnConnect
};
