const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

/**
 * What the browser source paints on its very first frame.
 *
 * A theme switch reloads the page, so whatever the first frame looks like is
 * what people see every time they change scene. It used to be the design drawn
 * at 1x inside a source sized for 2x - the widget in one corner with empty bars
 * down two sides - because the zoom arrived with the config, one fetch later.
 * And then an empty panel until Spotify answered.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-first-paint-'));
const themesDir = path.join(sandbox, 'themes');
fs.mkdirSync(themesDir);

// Set before requiring: the widget server reads both at load time.
process.env.QUEUEIFY_THEMES_DIR = themesDir;
process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
process.env.QUEUEIFY_WIDGET_PORT = '0';

fs.mkdirSync(path.join(themesDir, 'demo'));
fs.writeFileSync(path.join(themesDir, 'demo', 'index.html'),
    '<!DOCTYPE html>\n<html>\n\n<head>\n    <link rel="stylesheet" href="/themes/demo/style.css">\n' +
    '</head>\n\n<body>\n    <div class="widget"></div>\n</body>\n\n</html>\n');
fs.writeFileSync(path.join(themesDir, 'demo', 'style.css'), '.widget { width: 680px; height: 192px; }');
fs.writeFileSync(path.join(themesDir, 'demo', 'properties.json'), '{}');

fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE,
    JSON.stringify({ theme: 'demo', renderScale: 2.5 }));

const startWidgetServer = require('../widget/server');

let server;
let base;

test.before(async () => {
    server = await startWidgetServer();
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(done => server.close(done));
    for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_WIDGET_PORT']) {
        delete process.env[key];
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('the page arrives already zoomed, rather than fetching its own size', async () => {
    const html = await (await fetch(`${base}/`)).text();

    assert.match(html, /<style id="queueify-zoom">html\{zoom:2\.5\}/);
    // Before the theme's own stylesheet, so the very first paint has it.
    assert.ok(html.indexOf('queueify-zoom') < html.indexOf('/themes/demo/style.css'));
});

test('the page arrives hidden, so it cannot paint an empty widget', async () => {
    const html = await (await fetch(`${base}/`)).text();

    assert.match(html, /<style id="queueify-boot">\.widget\{opacity:0!important\}<\/style>/);
});

test('the theme itself is served untouched apart from that', async () => {
    const html = await (await fetch(`${base}/`)).text();

    assert.match(html, /<div class="widget"><\/div>/);
    assert.match(html, /<link rel="stylesheet" href="\/themes\/demo\/style\.css">/);
    assert.match(html, /^<!DOCTYPE html>/);
});

test('the zoom follows the config, not a number baked into the page', async () => {
    await fetch(`${base}/api/widget/render-scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: 1 })
    });

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /html\{zoom:1\}/);
});

test('the config says how many widgets are listening, so nothing reloads twice', async () => {
    const config = await (await fetch(`${base}/api/widget/config`)).json();

    assert.strictEqual(config.clients, 0);
    assert.strictEqual(typeof config.revision, 'number');
});
