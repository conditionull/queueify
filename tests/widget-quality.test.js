const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so the file-writing fallback is what runs.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const envFilePath = path.join(__dirname, '..', 'setup', 'envFile.js');
const liveEnvPath = path.join(__dirname, '..', 'config', 'liveEnv.js');
const layoutPath = path.join(__dirname, '..', 'services', 'widgetLayout.js');
const storePath = path.join(__dirname, '..', 'services', 'themeStore.js');
const serverPath = path.join(__dirname, '..', 'setup', 'server.js');

const modules = [envFilePath, liveEnvPath, storePath, layoutPath, serverPath];

/**
 * Sharpness is no longer something to choose: Queueify sizes the browser
 * source from the theme's design and the space it is given in OBS. These
 * cover what the dashboard still reports and offers.
 */
async function withServer(run, { widgetConfig = {}, themes = {} } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-quality-'));
    const themesDir = path.join(sandbox, 'themes');
    fs.mkdirSync(themesDir);

    for (const [name, css] of Object.entries(themes)) {
        fs.mkdirSync(path.join(themesDir, name));
        fs.writeFileSync(path.join(themesDir, name, 'index.html'), '<div class="widget"></div>');
        fs.writeFileSync(path.join(themesDir, name, 'style.css'), css);
        fs.writeFileSync(path.join(themesDir, name, 'properties.json'), '{}');
    }

    const configFile = path.join(sandbox, 'widget-config.json');
    fs.writeFileSync(configFile, JSON.stringify(widgetConfig));

    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = configFile;
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, 'OBS_WEBSOCKET_IP=\n');

    for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];

    const { createApp } = require(serverPath);
    const server = await new Promise(resolve => {
        const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        await run(`http://127.0.0.1:${server.address().port}`, configFile);
    } finally {
        await new Promise(done => server.close(done));
        for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_ENV_FILE']) {
            delete process.env[key];
        }
        for (const modulePath of modules) delete require.cache[require.resolve(modulePath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

test('status reports the size the active theme is designed at', async () => {
    await withServer(async base => {
        const status = await (await fetch(`${base}/api/status`)).json();

        assert.strictEqual(status.widget.baseWidth, 400);
        assert.strictEqual(status.widget.baseHeight, 36);
        assert.match(status.widget.url, /^http:\/\//);
    }, {
        widgetConfig: { theme: 'slim' },
        // A hand-written theme states its size in its own stylesheet.
        themes: { slim: '.widget { width: 400px; height: 36px; }' }
    });
});

test('a theme with no stated size falls back to the documented one', async () => {
    await withServer(async base => {
        const status = await (await fetch(`${base}/api/status`)).json();

        assert.strictEqual(status.widget.baseWidth, 680);
        assert.strictEqual(status.widget.baseHeight, 192);
    }, {
        widgetConfig: { theme: 'vague' },
        themes: { vague: '.widget { color: red; }' }
    });
});

test('re-checking without OBS says so instead of pretending', async () => {
    await withServer(async base => {
        const res = await fetch(`${base}/api/widget/rematch`, { method: 'POST' });

        assert.strictEqual(res.status, 400);
        assert.match((await res.json()).error, /OBS is not connected/);
    });
});

test('the old sharpness endpoint is gone, not silently accepting settings', async () => {
    await withServer(async base => {
        const res = await fetch(`${base}/api/widget/quality`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scale: 3 })
        });

        assert.strictEqual(res.status, 404, 'sharpness is not a setting any more');
    });
});
