const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const obs = require('./obs');
const themeStore = require('./themeStore');
const widgetLayout = require('./widgetLayout');
const { getObsConfig } = require('../config/liveEnv');

/**
 * A theme per OBS scene, applied when OBS cuts to it.
 *
 * The widget wants to look different in different places: a slim strip along
 * the bottom while a game is on, the big panel while you are talking to chat.
 * Doing that by hand means remembering `!theme` on every transition, which
 * nobody does mid-stream - so the scene itself carries the choice.
 *
 * The mapping is scene name -> theme name, and a scene with no entry changes
 * nothing: switching to it leaves whatever is on screen alone. That is what
 * makes this safe to half-fill in. `!theme` still wins for as long as you stay
 * on the scene you typed it on; the next switch to a mapped scene takes over
 * again.
 */

const FILE = process.env.QUEUEIFY_SCENE_THEMES_FILE
    || path.join(__dirname, '..', 'config', 'scene-themes.json');

function read() {
    try {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        const mapping = {};
        for (const [scene, theme] of Object.entries(parsed)) {
            if (typeof scene === 'string' && scene && typeof theme === 'string' && theme) {
                mapping[scene] = theme;
            }
        }
        return mapping;
    } catch {
        // No file yet, or one that has been damaged. Either way the feature is
        // simply off, which is the same as every scene being unmapped.
        return {};
    }
}

/**
 * Saves the mapping, dropping anything that names a theme which is not there.
 *
 * A dead entry would fail silently at the worst moment - mid-stream, on a
 * scene change - so it is refused here instead, where somebody is looking.
 */
async function write(input) {
    const mapping = {};
    const dropped = [];

    for (const [scene, theme] of Object.entries(input && typeof input === 'object' ? input : {})) {
        if (typeof scene !== 'string' || !scene) continue;

        // An empty choice is how the dashboard says "leave this scene alone".
        if (!theme) continue;

        if (typeof theme !== 'string' || !themeStore.exists(theme)) {
            dropped.push({ scene, theme });
            continue;
        }

        mapping[scene] = theme;
    }

    await fsPromises.mkdir(path.dirname(FILE), { recursive: true });
    await fsPromises.writeFile(FILE, JSON.stringify(mapping, null, 4));

    return { mapping, dropped };
}

function themeForScene(scene) {
    return read()[scene] || null;
}

/**
 * Switches the widget to whatever the given scene asks for.
 *
 * An unmapped scene, or one already showing its theme, does nothing at all -
 * so this is safe to call on every scene change and on startup.
 */
async function applyForScene(scene) {
    const theme = themeForScene(scene);
    if (!theme) return { changed: false, reason: 'unmapped', scene };

    if (!themeStore.exists(theme)) {
        return { changed: false, reason: 'missing_theme', scene, theme };
    }

    if ((widgetLayout.readWidgetConfig().theme || 'default') === theme) {
        return { changed: false, reason: 'already_live', scene, theme };
    }

    await widgetLayout.activateTheme(theme);

    // A theme is a size as much as a look, and a size change moves the widget,
    // because OBS holds a scene item by its top-left corner. Each theme has its
    // own saved !tr / !bc position; restoring it also re-matches OBS to the
    // design, in one pass. Sizing and then repositioning as two steps is what
    // left the widget slightly adrift: the second step read the source size
    // back from OBS before OBS had finished applying the first.
    const placed = await widgetLayout.restorePosition(theme);

    // No saved position for this theme - size it and leave it where it is.
    const obsResult = placed.reason === 'no_preset'
        ? await widgetLayout.reconcile()
        : placed;

    return { changed: true, scene, theme, obs: obsResult, placed };
}

// OBS re-announces the program scene while a transition runs, so the same
// name can arrive more than once; and applying a theme is several requests.
let applying = null;
let lastApplied = null;

async function onSceneChange(scene) {
    if (!scene || scene === lastApplied) return null;
    if (applying) return null;

    lastApplied = scene;
    applying = applyForScene(scene)
        .then(result => {
            if (result.changed) {
                console.log(`Scene "${scene}" uses the "${result.theme}" theme - switched.`);
            }
            return result;
        })
        .catch(err => {
            // A scene change must never take the bot down with it; the next
            // switch tries again.
            console.warn(`Could not switch theme for scene "${scene}":`, err.message);
            return null;
        })
        .finally(() => { applying = null; });

    return applying;
}

/**
 * Starts following OBS's scene changes.
 *
 * Registered whether or not OBS is reachable yet, like the rest of the widget
 * listeners: it is a listener on the client itself, so opening OBS later still
 * works. `onConnected` covers the scene OBS is already on when it appears.
 */
function watch() {
    const stopSceneChanges = obs.onProgramSceneChanged(scene => { onSceneChange(scene); });

    const stopConnected = obs.onConnected(async () => {
        if (!Object.keys(read()).length) return;

        try {
            // Whatever OBS is showing right now counts as a scene change we
            // missed - Queueify may have started with OBS already open.
            lastApplied = null;
            await onSceneChange(await obs.currentProgramScene());
        } catch {
            // OBS went away again; the next scene change picks it up.
        }
    });

    return () => { stopSceneChanges(); stopConnected(); };
}

/** The scenes OBS knows about, for the dashboard's dropdowns. */
async function listScenes() {
    const config = getObsConfig();
    if (!config.connectable) return { ok: false, error: 'OBS is not set up yet.' };

    const result = await obs.testConnection({
        ip: config.ip,
        port: config.port,
        password: config.password
    });

    if (!result.ok) return result;
    return { ok: true, scenes: result.scenes.map(scene => scene.scene) };
}

module.exports = {
    FILE,
    read,
    write,
    themeForScene,
    applyForScene,
    watch,
    listScenes
};
