const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so the file-writing fallback is what runs.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const modules = [
    path.join(__dirname, '..', 'setup', 'envFile.js'),
    path.join(__dirname, '..', 'config', 'liveEnv.js'),
    path.join(__dirname, '..', 'services', 'themeStore.js'),
    // Both of these read the widget config file path at load time, and the
    // theme routes now go through them to put a theme on screen.
    path.join(__dirname, '..', 'services', 'widgetLayout.js'),
    path.join(__dirname, '..', 'services', 'sceneThemes.js'),
    path.join(__dirname, '..', 'setup', 'server.js')
];

/** A hand-written theme, exactly like the shipped ones: no theme.json. */
function writeBuiltIn(themesDir, name) {
    fs.mkdirSync(path.join(themesDir, name), { recursive: true });
    fs.writeFileSync(path.join(themesDir, name, 'index.html'), '<div class="widget"></div>');
    fs.writeFileSync(path.join(themesDir, name, 'style.css'), '.widget { color: red; }');
    fs.writeFileSync(path.join(themesDir, name, 'properties.json'), '{}');
}

async function withServer(run) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-theme-api-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);
    writeBuiltIn(themesDir, 'default');

    const widgetConfig = path.join(sandbox, 'widget-config.json');
    fs.writeFileSync(widgetConfig, JSON.stringify({ theme: 'default' }));

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = widgetConfig;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, 'OBS_WEBSOCKET_IP=\n');

    for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];

    const { createApp } = require(modules[modules.length - 1]);
    const server = await new Promise(resolve => {
        const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        await run({
            base: `http://127.0.0.1:${server.address().port}`,
            themesDir,
            widgetConfig,
            readWidgetConfig: () => JSON.parse(fs.readFileSync(widgetConfig, 'utf8'))
        });
    } finally {
        await new Promise(done => server.close(done));
        for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_ENV_FILE']) {
            delete process.env[key];
        }
        for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

function put(base, name, model) {
    return fetch(`${base}/api/themes/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
    });
}

async function defaults(base) {
    return (await (await fetch(`${base}/api/themes`)).json()).defaults;
}

test('a theme saved through the dashboard becomes a real, listed theme', async () => {
    await withServer(async ({ base, themesDir }) => {
        const model = await defaults(base);
        model.label = 'Neon';

        const res = await put(base, 'neon', model);
        assert.strictEqual(res.status, 200);

        // The widget discovers themes by folder, so the files are the feature.
        for (const file of ['index.html', 'style.css', 'properties.json', 'theme.json']) {
            assert.ok(fs.existsSync(path.join(themesDir, 'neon', file)), `${file} missing`);
        }

        const listed = await (await fetch(`${base}/api/themes`)).json();
        const neon = listed.themes.find(theme => theme.name === 'neon');
        assert.strictEqual(neon.label, 'Neon');
        assert.strictEqual(neon.editable, true);
    });
});

test('activating a theme points the live widget at it', async () => {
    await withServer(async ({ base, readWidgetConfig }) => {
        await put(base, 'neon', await defaults(base));

        const res = await fetch(`${base}/api/themes/neon/activate`, { method: 'POST' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(readWidgetConfig().theme, 'neon');
    });
});

test('deleting the live theme falls back instead of leaving a dead pointer', async () => {
    await withServer(async ({ base, readWidgetConfig, themesDir }) => {
        await put(base, 'neon', await defaults(base));
        await fetch(`${base}/api/themes/neon/activate`, { method: 'POST' });

        const res = await fetch(`${base}/api/themes/neon`, { method: 'DELETE' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await res.json()).switchedTo, 'default');
        assert.strictEqual(readWidgetConfig().theme, 'default');
        assert.ok(!fs.existsSync(path.join(themesDir, 'neon')));
    });
});

test('built-in themes cannot be edited or deleted over the API', async () => {
    await withServer(async ({ base, themesDir }) => {
        const save = await put(base, 'default', await defaults(base));
        assert.strictEqual(save.status, 400);
        assert.strictEqual((await save.json()).code, 'not_editable');

        const remove = await fetch(`${base}/api/themes/default`, { method: 'DELETE' });
        assert.strictEqual(remove.status, 400);

        const open = await fetch(`${base}/api/themes/default`);
        assert.strictEqual(open.status, 400);

        assert.strictEqual(
            fs.readFileSync(path.join(themesDir, 'default', 'style.css'), 'utf8'),
            '.widget { color: red; }'
        );
    });
});

test('a name that could escape the themes folder is refused', async () => {
    await withServer(async ({ base, themesDir }) => {
        for (const name of ['..%2Fevil', 'Uppercase', 'has%20space']) {
            const res = await put(base, name, await defaults(base));
            assert.strictEqual(res.status, 400, `${name} should be refused`);
        }

        assert.deepStrictEqual(fs.readdirSync(themesDir), ['default']);
    });
});

test('the preview stylesheet comes from the same generator as the saved file', async () => {
    await withServer(async ({ base, themesDir }) => {
        const model = await defaults(base);
        model.modules.find(module => module.type === 'title').fontSize = 41;

        const preview = await (await fetch(`${base}/api/themes-preview/css`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        })).json();

        assert.ok(preview.css.includes('font-size: 41px;'));

        await put(base, 'neon', model);
        const saved = fs.readFileSync(path.join(themesDir, 'neon', 'style.css'), 'utf8');

        assert.strictEqual(saved, preview.css, 'what the editor shows must be what gets written');
    });
});

test('the preview always has a song to draw, even with no widget server', async () => {
    await withServer(async ({ base }) => {
        const song = await (await fetch(`${base}/api/themes-preview/song`)).json();

        assert.strictEqual(song.sample, true);
        assert.ok(song.title && song.artist);
        assert.ok(song.palette.vibrant);
    });
});
