const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so no test can reach a running Queueify.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const layoutPath = path.join(__dirname, '..', 'services', 'widgetLayout.js');
const storePath = path.join(__dirname, '..', 'services', 'themeStore.js');
const liveEnvPath = path.join(__dirname, '..', 'config', 'liveEnv.js');
const envFilePath = path.join(__dirname, '..', 'setup', 'envFile.js');
const statePath = path.join(__dirname, '..', 'core', 'state.js');

function freshLayout({ widgetConfig = {}, obsConfigured = false } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-layout-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
    process.env.QUEUEIFY_DATA_DIR = sandbox;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');

    fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, JSON.stringify(widgetConfig));
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, obsConfigured
        ? 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Gaming\nOBS_SOURCE=Queueify\n'
        : 'OBS_WEBSOCKET_IP=\n');

    for (const modulePath of [envFilePath, liveEnvPath, storePath, statePath, layoutPath]) {
        delete require.cache[require.resolve(modulePath)];
    }

    return { layout: require(layoutPath), store: require(storePath), sandbox, themesDir };
}

function cleanup(sandbox) {
    for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_SETTINGS_FILE',
        'QUEUEIFY_DATA_DIR', 'QUEUEIFY_ENV_FILE']) {
        delete process.env[key];
    }
    for (const modulePath of [envFilePath, liveEnvPath, storePath, statePath, layoutPath]) {
        delete require.cache[require.resolve(modulePath)];
    }
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
}

test('a hand-written theme needs the stock browser source size', () => {
    const { layout, sandbox } = freshLayout({ widgetConfig: { theme: 'minimal' } });

    try {
        assert.deepStrictEqual(layout.requiredSize(), {
            theme: 'minimal',
            renderScale: 1,
            designWidth: 680,
            designHeight: 192,
            width: 680,
            height: 192
        });
    } finally {
        cleanup(sandbox);
    }
});

test('a theme made in the editor needs the size it was designed at', async () => {
    const { layout, store, sandbox } = freshLayout({ widgetConfig: { theme: 'tall' } });

    try {
        const model = store.defaultModel('Tall');
        model.canvas.width = 300;
        model.canvas.height = 400;
        await store.saveTheme('tall', model);

        const needed = layout.requiredSize();
        assert.strictEqual(needed.designWidth, 300);
        assert.strictEqual(needed.designHeight, 400);
        assert.strictEqual(needed.width, 300);
    } finally {
        cleanup(sandbox);
    }
});

test('sharpness multiplies the size the source has to be', async () => {
    const { layout, store, sandbox } = freshLayout({ widgetConfig: { theme: 'wide', renderScale: 2 } });

    try {
        const model = store.defaultModel('Wide');
        model.canvas.width = 500;
        model.canvas.height = 100;
        await store.saveTheme('wide', model);

        const needed = layout.requiredSize();
        assert.strictEqual(needed.renderScale, 2);
        assert.strictEqual(needed.width, 1000);
        assert.strictEqual(needed.height, 200);
        // The design itself has not changed, only how many pixels it is drawn with.
        assert.strictEqual(needed.designWidth, 500);
    } finally {
        cleanup(sandbox);
    }
});

test('a broken or missing theme falls back to the stock size rather than throwing', () => {
    const { layout, sandbox, themesDir } = freshLayout({ widgetConfig: { theme: 'wrecked' } });

    try {
        fs.mkdirSync(path.join(themesDir, 'wrecked'));
        fs.writeFileSync(path.join(themesDir, 'wrecked', 'index.html'), '<div class="widget"></div>');
        fs.writeFileSync(path.join(themesDir, 'wrecked', 'theme.json'), '{ not json');

        assert.strictEqual(layout.requiredSize().width, 680);
    } finally {
        cleanup(sandbox);
    }
});

test('saved presets move by the same factor the scene item did', async () => {
    const { layout, sandbox } = freshLayout();

    try {
        const state = require(statePath);
        state.widgetPresets = {
            topright: { positionX: 10, positionY: 20, scaleX: 0.5, scaleY: 0.5 },
            'bottomcenter:swag': { positionX: 4, positionY: 8, scaleX: 1, scaleY: 2 },
            broken: null
        };

        // The source doubled in size, so the item is half the scale it was.
        const changed = layout.rescalePresets(0.5, 0.5);

        assert.strictEqual(changed, 2);
        assert.strictEqual(state.widgetPresets.topright.scaleX, 0.25);
        assert.strictEqual(state.widgetPresets['bottomcenter:swag'].scaleY, 1);
        // Positions are untouched: only the scale changed.
        assert.strictEqual(state.widgetPresets.topright.positionX, 10);

        // core/state writes on a debounce; let it finish before the folder goes.
        await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
        cleanup(sandbox);
    }
});

test('an unchanged size leaves presets alone', async () => {
    const { layout, sandbox } = freshLayout();

    try {
        const state = require(statePath);
        state.widgetPresets = { topright: { scaleX: 0.75, scaleY: 0.75 } };

        assert.strictEqual(layout.rescalePresets(1, 1), 0);
        assert.strictEqual(state.widgetPresets.topright.scaleX, 0.75);
        await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
        cleanup(sandbox);
    }
});

test('with no OBS configured, reconciling reports that instead of failing', async () => {
    const { layout, sandbox } = freshLayout();

    try {
        const result = await layout.reconcile();

        assert.strictEqual(result.applied, false);
        assert.strictEqual(result.reason, 'obs_not_configured');
    } finally {
        cleanup(sandbox);
    }
});

test('an unreachable OBS is reported, not thrown', async () => {
    // Port 1 refuses immediately, so this exercises the failure path quickly.
    const { layout, sandbox } = freshLayout({ obsConfigured: true });
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE,
        'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_WEBSOCKET_PORT=1\nOBS_SCENE=Gaming\nOBS_SOURCE=Queueify\n');

    try {
        const result = await layout.reconcile();

        assert.strictEqual(result.applied, false);
        assert.ok(result.message, 'the reason should be readable');
        assert.strictEqual(result.width, 680, 'it still reports the size that was wanted');
    } finally {
        cleanup(sandbox);
    }
});

/**
 * The sizing rule, which is the whole of "why does it look blurry / fried":
 * never render below the design (that squashes the layout), never more than
 * twice what is shown (that leaves OBS doing a heavy downscale).
 */
test('the rendered size is chosen so OBS never has to stretch or crush it', () => {
    const { sandbox } = freshLayout();
    const { sourceSizeFor } = require(path.join(__dirname, '..', 'services', 'obs.js'));

    try {
        // Shown smaller than designed: render the design in full and let OBS
        // scale it down gently, rather than squashing the layout.
        assert.strictEqual(sourceSizeFor(362, 680), 680);
        assert.strictEqual(sourceSizeFor(297, 680), 680);

        // Shown at or above the design: render exactly that, 1:1.
        assert.strictEqual(sourceSizeFor(680, 680), 680);
        assert.strictEqual(sourceSizeFor(1360, 680), 1360);
        assert.strictEqual(sourceSizeFor(2610, 680), 2610);

        // Shrunk to a fraction of the design, the render is capped so OBS is
        // not left throwing most of the pixels away.
        assert.strictEqual(sourceSizeFor(100, 1920), 250);

        // Small themes are not blown up to a stock size.
        assert.strictEqual(sourceSizeFor(400, 400), 400);
        assert.strictEqual(sourceSizeFor(800, 400), 800);
    } finally {
        cleanup(sandbox);
    }
});

test('the zoom is allowed to be fractional', () => {
    const { layout, sandbox } = freshLayout({ widgetConfig: { renderScale: 1.27 } });

    try {
        // A 680px design shown at 864px is 1.27x - rounding that to 1 would put
        // the blur straight back.
        assert.strictEqual(layout.requiredSize().renderScale, 1.27);
        assert.strictEqual(layout.renderScaleOf({ renderScale: 0.1 }), 0.25, 'clamped at the bottom');
        assert.strictEqual(layout.renderScaleOf({ renderScale: 99 }), 4, 'clamped at the top');
        assert.strictEqual(layout.renderScaleOf({ renderScale: 'nonsense' }), 1);
    } finally {
        cleanup(sandbox);
    }
});

test('a zoom is only written when it actually changed', async () => {
    const { layout, sandbox } = freshLayout({ widgetConfig: { renderScale: 2 } });

    try {
        assert.strictEqual(await layout.saveRenderScale(2), false, 'no write for the same value');
        assert.strictEqual(await layout.saveRenderScale(2.5), true);

        const saved = JSON.parse(fs.readFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, 'utf8'));
        assert.strictEqual(saved.renderScale, 2.5);
    } finally {
        cleanup(sandbox);
    }
});

test('a scale is rounded to two decimals, so it does not churn', async () => {
    const { layout, sandbox } = freshLayout();

    try {
        await layout.saveRenderScale(1.23456);

        const saved = JSON.parse(fs.readFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, 'utf8'));
        assert.strictEqual(saved.renderScale, 1.23);
    } finally {
        cleanup(sandbox);
    }
});

/**
 * The watcher that re-renders the widget when it is dragged in OBS only works
 * if the client asked for transform events. They are classed as high-volume,
 * so the library's default subscription leaves them out - and the whole
 * feature was silently dead because of it.
 */
test('the OBS connection subscribes to the transform events the watcher needs', () => {
    const { EventSubscription } = require('obs-websocket-js');
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'obs.js'), 'utf8');

    assert.match(source, /eventSubscriptions:\s*EventSubscription\.All\s*\|\s*EventSubscription\.SceneItemTransformChanged/);

    // And that flag really is outside the default set, which is why it matters.
    assert.ok((EventSubscription.All & EventSubscription.SceneItemTransformChanged) === 0,
        'if this ever lands in the default set, the explicit subscription is merely harmless');
});
