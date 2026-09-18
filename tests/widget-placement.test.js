const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

/**
 * The two OBS positions, driven from the dashboard instead of chat.
 *
 * `!tr` / `!bc` move the widget to a theme's saved spot and `!tr set` /
 * `!bc set` record where it is now. Both the commands and this endpoint call
 * widgetLayout, so there is one implementation of what they mean.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-place-'));
const themesDir = path.join(sandbox, 'themes');
fs.mkdirSync(themesDir);

process.env.QUEUEIFY_THEMES_DIR = themesDir;
process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
process.env.QUEUEIFY_SCENE_THEMES_FILE = path.join(sandbox, 'scene-themes.json');
process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'history.jsonl');
// Nothing is listening there, so nothing can reach a running Queueify.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, JSON.stringify({ theme: 'demo' }));

const { createApp } = require('../setup/server.js');
const widgetLayout = require('../services/widgetLayout');

let server;
let base;

test.before(async () => {
    const app = createApp();
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(done => server.close(done));
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const place = (body) => fetch(`${base}/api/widget/placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});

test('the commands and the endpoint share one implementation', () => {
    // If this moves, the buttons and the chat commands can start to disagree.
    assert.strictEqual(typeof widgetLayout.savePreset, 'function');

    for (const file of ['topright', 'bottomcenter']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'commands', file + '.js'), 'utf8');
        assert.match(source, /widgetLayout\.savePreset\(/,
            file + ' must not keep its own copy of what "set" means');
    }
});

/**
 * The editor reads this list to decide whether "Move here" can be pressed.
 * It is a list, not a lookup keyed by kind - indexing it by kind returns
 * undefined, which silently disables the button for a theme that does have a
 * position saved.
 */
test('the fit report lists presets, and each one names its kind', async () => {
    const res = await fetch(`${base}/api/widget/fit?theme=demo`);
    const report = await res.json();

    assert.ok(Array.isArray(report.presets), 'a list, not an object keyed by kind');
    assert.ok('obsConfigured' in report, 'the editor needs to tell "no" from "not yet"');

    for (const preset of report.presets) {
        assert.ok(['topright', 'bottomcenter'].includes(preset.kind));
        assert.strictEqual(typeof preset.stale, 'boolean');
    }
});

test('moving with nothing saved says what to do instead of failing quietly', async () => {
    for (const kind of ['topright', 'bottomcenter']) {
        const res = await place({ kind, action: 'apply' });
        const body = await res.json();

        assert.strictEqual(res.status, 409);
        assert.strictEqual(body.reason, 'no_preset');
        assert.match(body.error, /Save this spot/);
    }
});

test('saving without OBS set up is refused, not half-done', async () => {
    for (const kind of ['topright', 'bottomcenter']) {
        const res = await place({ kind, action: 'save' });
        const body = await res.json();

        assert.strictEqual(res.status, 409);
        assert.strictEqual(body.reason, 'obs_not_configured');
    }
});

/**
 * The kind names a saved preset and reaches OBS, so it is chosen from a list
 * rather than passed through - this endpoint is on the dashboard, which is
 * loopback-only, but that is not a reason to hand it an arbitrary string.
 */
test('an unknown position falls back rather than being passed along', async () => {
    const res = await place({ kind: '../../etc/passwd', action: 'apply' });
    const body = await res.json();

    // Treated as the default position, which has nothing saved for this theme.
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.reason, 'no_preset');
});

test('an unknown action is treated as a move, never as a save', async () => {
    const res = await place({ kind: 'topright', action: 'delete-everything' });
    const body = await res.json();

    assert.strictEqual(body.reason, 'no_preset', 'it fell through to the read-only path');
});

test('a request with no body at all does not throw', async () => {
    const res = await fetch(`${base}/api/widget/placement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    });

    assert.ok(res.status < 500, 'a missing kind is a bad request, not a crash');
});

test('the dashboard stays loopback-only', async () => {
    // The placement endpoint moves things in OBS, so it must live behind the
    // same guard as everything else the dashboard serves.
    const source = fs.readFileSync(path.join(__dirname, '..', 'setup', 'server.js'), 'utf8');

    const at = source.indexOf("app.post('/api/widget/placement'");
    const guard = source.indexOf('guardLoopbackOnly');

    assert.ok(at !== -1);
    assert.ok(guard !== -1 && guard < at,
        'the guard is installed before the routes it protects');
});
