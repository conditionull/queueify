const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const modules = [
    path.join(__dirname, '..', 'setup', 'envFile.js'),
    path.join(__dirname, '..', 'config', 'liveEnv.js'),
    path.join(__dirname, '..', 'services', 'themeStore.js'),
    path.join(__dirname, '..', 'core', 'state.js'),
    path.join(__dirname, '..', 'services', 'widgetLayout.js')
];

/**
 * What the editor says about a theme's saved `!tr` / `!bc` positions.
 *
 * A position stores the rectangle the widget occupied on the OBS canvas, so it
 * survives the browser source being resized - the scale to land in it is
 * worked out fresh every time. Only a change of *shape* leaves it unable to
 * frame the design, and only a theme's own positions are its business.
 */
function withSandbox(run, { presets = {}, config = {} } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-presets-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
    process.env.QUEUEIFY_DATA_DIR = sandbox;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');

    fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, JSON.stringify(config));
    fs.writeFileSync(process.env.QUEUEIFY_SETTINGS_FILE, JSON.stringify({ widgetPresets: presets }));
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, 'OBS_WEBSOCKET_IP=\n');

    for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];

    try {
        return run(require(modules[4]));
    } finally {
        for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_SETTINGS_FILE',
            'QUEUEIFY_DATA_DIR', 'QUEUEIFY_ENV_FILE']) {
            delete process.env[key];
        }
        for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

/**
 * A position framed with the widget filling a 680 x 192 browser source at 1:1,
 * so the rectangle it occupied on the canvas was 680 x 192.
 */
const framedWide = {
    positionX: 1200, positionY: 40,
    width: 680, height: 192,
    sourceWidth: 680, sourceHeight: 192,
    scaleX: 1, scaleY: 1
};

test('a position framed at the design it still is counts as current', () => {
    withSandbox(layout => {
        const presets = layout.presetsFor('neon', { width: 680, height: 192 });

        assert.strictEqual(presets.length, 1);
        assert.strictEqual(presets[0].command, '!tr');
        assert.strictEqual(presets[0].stale, false);
    }, { presets: { 'topright:neon': framedWide } });
});

test('resizing a design without changing its shape leaves the position usable', () => {
    withSandbox(layout => {
        // Twice as big, same proportions: the rectangle is still the right
        // shape, so nothing needs setting again.
        const [preset] = layout.presetsFor('neon', { width: 1360, height: 384 });
        assert.strictEqual(preset.stale, false);
    }, { presets: { 'topright:neon': framedWide } });
});

test('changing a design shape does need the position setting again', () => {
    withSandbox(layout => {
        const [preset] = layout.presetsFor('neon', { width: 300, height: 406 });

        assert.strictEqual(preset.stale, true);
        assert.strictEqual(preset.framedWidth, 680);
        assert.strictEqual(preset.framedHeight, 192);
    }, { presets: { 'topright:neon': framedWide } });
});

test('only the positions actually saved for this theme are reported', () => {
    withSandbox(layout => {
        // The complaint this fixes: with only !bc set for a theme, the editor
        // told people to run !tr set as well, because a position saved before
        // themes had their own was being counted for every theme.
        const presets = layout.presetsFor('neon', { width: 300, height: 406 });

        assert.deepStrictEqual(presets.map(preset => preset.command), ['!bc']);
    }, {
        presets: {
            'bottomcenter:neon': framedWide,
            topright: framedWide,
            bottomcenter: framedWide
        }
    });
});

test("both of a theme's own positions are reported when both are set", () => {
    withSandbox(layout => {
        const presets = layout.presetsFor('neon', { width: 300, height: 406 });

        assert.deepStrictEqual(presets.map(preset => preset.command), ['!tr', '!bc']);
        assert.ok(presets.every(preset => preset.stale));
    }, {
        presets: {
            'topright:neon': framedWide,
            'bottomcenter:neon': framedWide
        }
    });
});

test('a theme with nothing saved for it reports nothing', () => {
    withSandbox(layout => {
        assert.deepStrictEqual(layout.presetsFor('neon', { width: 680, height: 192 }), []);
    }, { presets: { 'topright:other': framedWide } });
});

test('a bounded item is measured by its box, not by its scale', () => {
    withSandbox(layout => {
        const [preset] = layout.presetsFor('neon', { width: 680, height: 192 });
        assert.strictEqual(preset.stale, false);
        assert.strictEqual(preset.framedWidth, 680);
    }, {
        presets: {
            'topright:neon': {
                sourceWidth: 680, sourceHeight: 192,
                boundsType: 'OBS_BOUNDS_SCALE_INNER',
                boundsWidth: 680, boundsHeight: 192,
                width: 9999, height: 9999,
                scaleX: 3, scaleY: 3
            }
        }
    });
});

test('with no OBS the fit report still answers what it can', async () => {
    await withSandbox(async layout => {
        const report = await layout.describeFit({ theme: 'neon', width: 300, height: 406 });

        assert.strictEqual(report.obsConfigured, false);
        assert.strictEqual(report.connected, false);
        assert.strictEqual(report.source, null);
        // Without OBS the honest answer is "the design's own size".
        assert.deepStrictEqual(report.needed, { width: 300, height: 406 });
        assert.strictEqual(report.presets[0].stale, true);
    }, { presets: { 'topright:neon': framedWide } });
});

test('the report knows whether the theme being edited is the live one', async () => {
    await withSandbox(async layout => {
        assert.strictEqual((await layout.describeFit({ theme: 'neon' })).live, true);
        assert.strictEqual((await layout.describeFit({ theme: 'other' })).live, false);
    }, { config: { theme: 'neon' } });
});
