const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A random free port: never the one a running Queueify is using.
process.env.QUEUEIFY_WIDGET_PORT = '0';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-widget-'));
const themesDir = path.join(sandbox, 'themes');
fs.mkdirSync(themesDir);

process.env.QUEUEIFY_THEMES_DIR = themesDir;
process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');

/** A theme with markup of its own, so the wrong one is obvious. */
function writeTheme(name, marker) {
    fs.mkdirSync(path.join(themesDir, name), { recursive: true });
    fs.writeFileSync(path.join(themesDir, name, 'index.html'),
        `<!DOCTYPE html><html><head><link rel="stylesheet" href="/themes/${name}/style.css"></head>` +
        `<body><div class="widget" data-theme="${marker}"></div></body></html>`);
    fs.writeFileSync(path.join(themesDir, name, 'style.css'), `/* ${name} */`);
    fs.writeFileSync(path.join(themesDir, name, 'properties.json'), '{}');
}

writeTheme('default', 'the-default-one');
writeTheme('chosen', 'the-chosen-one');
fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, JSON.stringify({ theme: 'chosen' }));

const startWidgetServer = require('../widget/server');

let base;
let server;

test.before(async () => {
    server = await startWidgetServer();
    base = `http://127.0.0.1:${server.address().port}`;

    // Without this the listening socket keeps the test process alive after the
    // last assertion, and the run never finishes.
    server.unref();
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(sandbox, { recursive: true, force: true });
    for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_WIDGET_PORT']) {
        delete process.env[key];
    }
});

/**
 * The regression this file exists for: the widget used to pick its theme
 * before reading the config, so the very first request - the one OBS makes -
 * served "default" markup, which then got another theme's stylesheet applied
 * over it. That looked like a broken widget with stray bars in it.
 */
test('the first request already serves the configured theme', async () => {
    const html = await (await fetch(`${base}/`)).text();

    assert.match(html, /data-theme="the-chosen-one"/);
    assert.ok(!html.includes('the-default-one'), 'the default theme must not be served instead');
    assert.match(html, /\/themes\/chosen\/style\.css/, 'and its own stylesheet has to come with it');
});

test('the config endpoint agrees with what was served', async () => {
    const config = await (await fetch(`${base}/api/widget/config`)).json();

    assert.strictEqual(config.effectiveTheme, 'chosen');
    assert.strictEqual(config.renderScale, 1);
    assert.strictEqual(config.width, 680);
});

test('switching theme changes what the next request gets', async () => {
    const res = await fetch(`${base}/api/widget/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'default' })
    });

    assert.strictEqual(res.status, 200);

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /data-theme="the-default-one"/);
});

test('an unknown theme is refused rather than written', async () => {
    const res = await fetch(`${base}/api/widget/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: '../escape' })
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, 'utf8')).theme, 'default');
});

test('the themes list reports what is on disk', async () => {
    const themes = await (await fetch(`${base}/api/widget/themes`)).json();

    assert.deepStrictEqual(themes.sort(), ['chosen', 'default']);
});

/**
 * Starting a second copy of Queueify used to crash with a TypeError from
 * inside the listen callback, because the address was read after the socket
 * had already failed. It has to come back as a plain, explainable error.
 */
test('a port that is already taken is reported, not crashed on', async () => {
    const net = require('net');

    const blocker = net.createServer();
    await new Promise(resolve => blocker.listen(0, resolve));
    const taken = blocker.address().port;

    process.env.QUEUEIFY_WIDGET_PORT = String(taken);

    try {
        await assert.rejects(
            () => startWidgetServer(),
            err => err.code === 'EADDRINUSE' && err.port === taken && /already running/.test(err.message)
        );
    } finally {
        process.env.QUEUEIFY_WIDGET_PORT = '0';
        await new Promise(resolve => blocker.close(resolve));
    }
});
