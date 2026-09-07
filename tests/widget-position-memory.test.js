const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so activateTheme falls through to the file.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const modules = [
    path.join(__dirname, '..', 'setup', 'envFile.js'),
    path.join(__dirname, '..', 'config', 'liveEnv.js'),
    path.join(__dirname, '..', 'services', 'themeStore.js'),
    path.join(__dirname, '..', 'core', 'state.js'),
    path.join(__dirname, '..', 'services', 'obs.js'),
    path.join(__dirname, '..', 'services', 'widgetLayout.js')
];

const websocketPath = require.resolve('obs-websocket-js');

/**
 * Coming back to a theme and finding the widget where you left it.
 *
 * A `!tr` / `!bc` preset says where a theme belongs. Somebody who never types
 * those and simply drags the widget where they want it had no such record, so
 * a theme switch re-fitted the design into whatever rectangle the other theme
 * had left behind - and fitting only ever shrinks, so the widget got smaller
 * on every switch, for as long as the stream went on.
 */
function withStage(run, { presets = {}, positions = {}, activePosition = 'topright' } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-position-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);

    // Two editor themes of different sizes, like a gaming strip and a BRB panel.
    const designs = { wide: [680, 192], tall: [420, 300] };

    for (const [name, [width, height]] of Object.entries(designs)) {
        fs.mkdirSync(path.join(themesDir, name));
        fs.writeFileSync(path.join(themesDir, name, 'index.html'), '<div class="widget"></div>');
        fs.writeFileSync(path.join(themesDir, name, 'style.css'),
            `.widget { width: ${width}px; height: ${height}px; }`);
        fs.writeFileSync(path.join(themesDir, name, 'properties.json'), '{}');
    }

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
    process.env.QUEUEIFY_DATA_DIR = sandbox;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');

    fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, JSON.stringify({ theme: 'wide' }));
    fs.writeFileSync(process.env.QUEUEIFY_SETTINGS_FILE, JSON.stringify({
        widgetPresets: presets,
        widgetPositions: positions,
        activeWidgetPosition: activePosition
    }));
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE,
        ['OBS_WEBSOCKET_IP=127.0.0.1', 'OBS_SCENE=Gaming', 'OBS_SOURCE=Queueify', ''].join('\n'));

    // The widget as OBS sees it: a browser source, and a scene item on top.
    let item = {
        sourceWidth: 680, sourceHeight: 192,
        scaleX: 1, scaleY: 1,
        positionX: 620, positionY: 888,
        alignment: 5, rotation: 0,
        boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0,
        cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0
    };

    class FakeObsWebSocket {
        constructor() { this.identified = false; }
        on() {}
        off() {}
        async connect() { this.identified = true; }
        async disconnect() { this.identified = false; }

        async call(request, payload) {
            switch (request) {
                case 'GetSceneItemList':
                    return { sceneItems: [{ sourceName: 'Queueify', sceneItemId: 7 }] };
                case 'GetSceneItemTransform':
                    return { sceneItemTransform: item };
                case 'GetInputSettings':
                    return { inputKind: 'browser_source', inputSettings: {} };
                case 'SetInputSettings':
                    item = { ...item, sourceWidth: payload.inputSettings.width, sourceHeight: payload.inputSettings.height };
                    return {};
                case 'SetSceneItemTransform':
                    item = { ...item, ...payload.sceneItemTransform };
                    return {};
                default:
                    return {};
            }
        }
    }

    const realWebsocket = require.cache[websocketPath];
    require.cache[websocketPath] = {
        id: websocketPath,
        filename: websocketPath,
        loaded: true,
        exports: { OBSWebSocket: FakeObsWebSocket, EventSubscription: { All: 1, SceneItemTransformChanged: 2 } }
    };

    for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];

    const layout = require(modules[5]);

    /** What the viewer sees: the item's rectangle on the canvas. */
    const shown = () => ({
        x: item.positionX,
        y: item.positionY,
        width: item.sourceWidth * item.scaleX,
        height: item.sourceHeight * item.scaleY
    });

    /** A theme switch, exactly as a scene change makes one. */
    const switchTo = async theme => {
        await layout.activateTheme(theme);
        const placed = await layout.restorePosition(theme);
        if (placed.reason === 'no_preset') await layout.reconcile();
        return placed;
    };

    const drag = rect => {
        item = {
            ...item,
            positionX: rect.x,
            positionY: rect.y,
            scaleX: rect.width / item.sourceWidth,
            scaleY: rect.height / item.sourceHeight
        };
    };

    return Promise.resolve(run({ layout, shown, switchTo, drag, state: require(modules[3]) }))
        .finally(async () => {
            // core/state writes on a debounce; let it finish before the folder goes.
            await new Promise(resolve => setTimeout(resolve, 250));

            if (realWebsocket) require.cache[websocketPath] = realWebsocket;
            else delete require.cache[websocketPath];

            for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_SETTINGS_FILE',
                'QUEUEIFY_DATA_DIR', 'QUEUEIFY_ENV_FILE']) {
                delete process.env[key];
            }
            for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];
            fs.rmSync(sandbox, { recursive: true, force: true });
        });
}

const near = (actual, expected, what) =>
    assert.ok(Math.abs(actual - expected) < 1, `${what}: expected ~${expected}, got ${actual}`);

test('a widget dragged into place is still there after switching away and back', () => {
    return withStage(async ({ shown, switchTo, drag }) => {
        // Nowhere near any preset - just where somebody wanted it.
        drag({ x: 300, y: 500, width: 500, height: 141 });
        const placed = shown();

        await switchTo('tall');
        await switchTo('wide');

        const back = shown();
        near(back.x, placed.x, 'x');
        near(back.y, placed.y, 'y');
        near(back.width, placed.width, 'width');
        near(back.height, placed.height, 'height');
    });
});

test('switching back and forth all night never shrinks it', () => {
    return withStage(async ({ shown, switchTo, drag }) => {
        drag({ x: 300, y: 500, width: 500, height: 141 });
        const placed = shown();

        for (let round = 0; round < 8; round += 1) {
            await switchTo('tall');
            await switchTo('wide');
        }

        // Before this, each switch fitted the design inside the rectangle the
        // other theme had left, and fitting only ever shrinks: eight rounds
        // took a 500px widget down to under 100.
        near(shown().width, placed.width, 'width after eight round trips');
        near(shown().height, placed.height, 'height after eight round trips');
    });
});

test('each theme keeps its own spot, not the last one used', () => {
    return withStage(async ({ shown, switchTo, drag }) => {
        drag({ x: 300, y: 500, width: 500, height: 141 });
        const wide = shown();

        await switchTo('tall');
        drag({ x: 1400, y: 60, width: 280, height: 200 });
        const tall = shown();

        await switchTo('wide');
        near(shown().x, wide.x, 'wide x');
        near(shown().width, wide.width, 'wide width');

        await switchTo('tall');
        near(shown().x, tall.x, 'tall x');
        near(shown().width, tall.width, 'tall width');
    });
});

test('a saved !bc position still wins for a theme that has one', () => {
    const framed = {
        positionX: 620, positionY: 888,
        width: 680, height: 192,
        sourceWidth: 680, sourceHeight: 192,
        scaleX: 1, scaleY: 1,
        alignment: 5, boundsType: 'OBS_BOUNDS_NONE'
    };

    return withStage(async ({ shown, switchTo }) => {
        await switchTo('tall');
        await switchTo('wide');

        // Never dragged, so the preset is the only thing that has ever placed
        // it - and it is where it lands.
        near(shown().x, 620, 'x');
        near(shown().y, 888, 'y');
        near(shown().width, 680, 'width');
    }, {
        presets: { 'bottomcenter:wide': framed },
        activePosition: 'bottomcenter'
    });
});

test('typing !bc wins over wherever the widget had been dragged', () => {
    const framed = {
        positionX: 620, positionY: 888,
        width: 680, height: 192,
        sourceWidth: 680, sourceHeight: 192,
        scaleX: 1, scaleY: 1,
        alignment: 5, boundsType: 'OBS_BOUNDS_NONE'
    };

    return withStage(async ({ layout, shown, drag }) => {
        drag({ x: 10, y: 10, width: 300, height: 85 });

        // An explicit command means its own preset and nothing else.
        const placed = await layout.restorePosition('wide', { kind: 'bottomcenter' });

        assert.strictEqual(placed.applied, true);
        near(shown().x, 620, 'x');
        near(shown().y, 888, 'y');
    }, { presets: { 'bottomcenter:wide': framed } });
});

test('a spot remembered under another positioning mode no longer counts', () => {
    const framed = {
        positionX: 1400, positionY: 20,
        width: 400, height: 113,
        sourceWidth: 680, sourceHeight: 192,
        scaleX: 0.588, scaleY: 0.588,
        alignment: 5, boundsType: 'OBS_BOUNDS_NONE'
    };

    return withStage(async ({ layout, shown }) => {
        // Remembered while !bc was in force; somebody has since typed !tr, so
        // top right is what was actually asked for.
        assert.strictEqual(layout.lastPositionFor('wide', 'topright'), null);
        assert.ok(layout.lastPositionFor('wide', 'bottomcenter'), 'still there for its own mode');

        await layout.restorePosition('wide');

        near(shown().x, 1400, 'x');
        near(shown().y, 20, 'y');
    }, {
        presets: { 'topright:wide': framed },
        positions: { wide: { x: 300, y: 500, width: 500, height: 141, alignment: 5, kind: 'bottomcenter' } },
        activePosition: 'topright'
    });
});

test('a position is remembered across a restart, not just in this session', () => {
    return withStage(async ({ switchTo, drag, state }) => {
        drag({ x: 300, y: 500, width: 500, height: 141 });
        await switchTo('tall');

        await new Promise(resolve => setTimeout(resolve, 250));

        const saved = JSON.parse(fs.readFileSync(process.env.QUEUEIFY_SETTINGS_FILE, 'utf8'));
        assert.ok(saved.widgetPositions.wide, 'the outgoing theme was written to disk');
        near(saved.widgetPositions.wide.x, 300, 'saved x');
        near(saved.widgetPositions.wide.width, 500, 'saved width');
        assert.strictEqual(saved.widgetPositions.wide.kind, state.activeWidgetPosition);
    });
});
