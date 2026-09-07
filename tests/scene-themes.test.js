const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so no test can reach a running Queueify.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const modules = [
    path.join(__dirname, '..', 'setup', 'envFile.js'),
    path.join(__dirname, '..', 'config', 'liveEnv.js'),
    path.join(__dirname, '..', 'services', 'themeStore.js'),
    path.join(__dirname, '..', 'services', 'widgetLayout.js'),
    path.join(__dirname, '..', 'services', 'sceneThemes.js')
];

function writeTheme(themesDir, name) {
    fs.mkdirSync(path.join(themesDir, name), { recursive: true });
    fs.writeFileSync(path.join(themesDir, name, 'index.html'), '<div class="widget"></div>');
    fs.writeFileSync(path.join(themesDir, name, 'style.css'), '.widget { width: 680px; height: 192px; }');
    fs.writeFileSync(path.join(themesDir, name, 'properties.json'), '{}');
}

async function withSandbox(run, { mapping = null, theme = 'default' } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-scene-themes-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);
    writeTheme(themesDir, 'default');
    writeTheme(themesDir, 'stacked');

    const configFile = path.join(sandbox, 'widget-config.json');
    fs.writeFileSync(configFile, JSON.stringify({ theme }));

    const mappingFile = path.join(sandbox, 'scene-themes.json');
    if (mapping) fs.writeFileSync(mappingFile, JSON.stringify(mapping));

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = configFile;
    process.env.QUEUEIFY_SCENE_THEMES_FILE = mappingFile;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, 'OBS_WEBSOCKET_IP=\n');

    for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];

    try {
        await run({
            scenes: require(modules[4]),
            mappingFile,
            liveTheme: () => JSON.parse(fs.readFileSync(configFile, 'utf8')).theme
        });
    } finally {
        for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE',
            'QUEUEIFY_SCENE_THEMES_FILE', 'QUEUEIFY_ENV_FILE']) {
            delete process.env[key];
        }
        for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

test('no mapping file at all is the same as every scene being left alone', async () => {
    await withSandbox(async ({ scenes }) => {
        assert.deepStrictEqual(scenes.read(), {});
        assert.strictEqual(scenes.themeForScene('Gaming'), null);
    });
});

test('a scene with a theme switches the widget to it', async () => {
    await withSandbox(async ({ scenes, liveTheme }) => {
        const result = await scenes.applyForScene('Gaming');

        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.theme, 'stacked');
        assert.strictEqual(liveTheme(), 'stacked');
    }, { mapping: { Gaming: 'stacked' } });
});

test('a scene nobody mapped changes nothing', async () => {
    await withSandbox(async ({ scenes, liveTheme }) => {
        const result = await scenes.applyForScene('Starting soon');

        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.reason, 'unmapped');
        assert.strictEqual(liveTheme(), 'default');
    }, { mapping: { Gaming: 'stacked' } });
});

test('a scene already showing its theme is not switched again', async () => {
    await withSandbox(async ({ scenes }) => {
        const result = await scenes.applyForScene('Gaming');
        assert.strictEqual(result.reason, 'already_live');
    }, { mapping: { Gaming: 'stacked' }, theme: 'stacked' });
});

test('a mapping pointing at a theme that is gone is reported, not applied', async () => {
    await withSandbox(async ({ scenes, liveTheme }) => {
        const result = await scenes.applyForScene('Gaming');

        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.reason, 'missing_theme');
        assert.strictEqual(liveTheme(), 'default');
    }, { mapping: { Gaming: 'deleted-theme' } });
});

test('saving refuses a theme that is not there rather than storing a dead entry', async () => {
    await withSandbox(async ({ scenes }) => {
        const { mapping, dropped } = await scenes.write({
            Gaming: 'stacked',
            Chatting: 'nope',
            Intro: ''
        });

        assert.deepStrictEqual(mapping, { Gaming: 'stacked' });
        assert.deepStrictEqual(dropped, [{ scene: 'Chatting', theme: 'nope' }]);
        assert.deepStrictEqual(scenes.read(), { Gaming: 'stacked' });
    });
});

test('an empty choice is how a scene is unmapped again', async () => {
    await withSandbox(async ({ scenes }) => {
        await scenes.write({ Gaming: '' });
        assert.deepStrictEqual(scenes.read(), {});
    }, { mapping: { Gaming: 'stacked' } });
});

test('a damaged mapping file turns the feature off instead of throwing', async () => {
    await withSandbox(async ({ scenes, mappingFile }) => {
        fs.writeFileSync(mappingFile, 'not json at all');
        assert.deepStrictEqual(scenes.read(), {});
    }, { mapping: { Gaming: 'stacked' } });
});
