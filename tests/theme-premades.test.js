const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

/**
 * The premade themes: JSON files in services/presets, read fresh on every
 * call so one edited in the editor shows without a restart.
 *
 * The first half checks the files that ship. The rest runs against a copy in
 * a sandbox, set before the store is required - the store reads the folder's
 * path when it loads, and a write must never land in the real one.
 */

const SHIPPED = path.join(__dirname, '..', 'services', 'presets');
const storePath = require.resolve('../services/themeStore');

function freshStore(presetsDir) {
    delete require.cache[storePath];
    if (presetsDir) process.env.QUEUEIFY_PRESETS_DIR = presetsDir;
    else delete process.env.QUEUEIFY_PRESETS_DIR;
    const store = require(storePath);
    delete require.cache[storePath];
    delete process.env.QUEUEIFY_PRESETS_DIR;
    return store;
}

function sandboxCopy() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-premades-'));
    for (const file of fs.readdirSync(SHIPPED)) fs.copyFileSync(path.join(SHIPPED, file), path.join(dir, file));
    return dir;
}

/* ------------------------------------------------------ the shipped files */

test('every shipped premade is already in the shape the store would save it in', () => {
    const store = freshStore();

    for (const file of fs.readdirSync(SHIPPED)) {
        const raw = JSON.parse(fs.readFileSync(path.join(SHIPPED, file), 'utf8'));

        // Anything that differs is a typo the normalizer papered over - a font
        // that does not exist, an icon Lucide does not have, a bad color.
        assert.deepStrictEqual(store.normalizeModel(raw.model, { label: raw.label }), raw.model,
            `${file} is not what it would normalize to`);
        assert.ok(raw.label && raw.description && Array.isArray(raw.tags) && raw.tags.length, `${file} is missing its blurb`);
    }
});

test('every part of every premade starts inside its own canvas, switched on or not', () => {
    for (const preset of freshStore().listPresets()) {
        const { width, height } = preset.model.canvas;
        const parts = [...preset.model.modules, ...preset.model.cards, ...preset.model.icons, ...preset.model.labels];

        for (const part of parts) {
            const name = `${preset.id}: ${part.type || part.name || part.text || part.id}`;
            assert.ok(part.x >= 0 && part.y >= 0, `${name} starts off the top or left`);
            assert.ok(part.x + part.w <= width && part.y + part.h <= height, `${name} hangs off the bottom or right`);
        }
    }
});

test('Orbit Wide is Orbit as a banner, right after it, with its art in orbit off the card\'s end', () => {
    const presets = freshStore().listPresets();
    const at = presets.findIndex(preset => preset.id === 'orbit-wide');
    const { canvas, cards, modules } = presets[at].model;
    const art = modules.find(module => module.type === 'art');
    const [card, ring] = cards;

    assert.strictEqual(presets[at - 1].id, 'orbit');
    assert.ok(canvas.width >= canvas.height * 2.5, 'banner-shaped');
    assert.ok(art.x < card.x + card.w && art.x + art.w > card.x + card.w, 'over the card\'s right end');
    assert.strictEqual(ring.x + ring.w / 2, art.x + art.w / 2, 'with the orbit centered on it');
    assert.ok(!modules.find(module => module.type === 'next').hidden, 'with Up next on');
});

test('the premades come in their order, Default first', () => {
    const presets = freshStore().listPresets();

    assert.strictEqual(presets[0].id, 'default');
    assert.ok(presets.length >= 10, 'there should be plenty to pick from');
    for (let at = 1; at < presets.length; at += 1) {
        assert.ok(presets[at - 1].order <= presets[at].order, `${presets[at].id} is out of order`);
    }
});

/* ------------------------------------------------------------- in a sandbox */

test('an edited premade shows on the next read, without a restart', () => {
    const dir = sandboxCopy();
    try {
        const store = freshStore(dir);
        const file = path.join(dir, 'vinyl.json');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        raw.label = 'Record Player';
        fs.writeFileSync(file, JSON.stringify(raw));

        assert.strictEqual(store.listPresets().find(preset => preset.id === 'vinyl').label, 'Record Player');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a broken premade file costs that premade, not the gallery', () => {
    const dir = sandboxCopy();
    const error = console.error;
    console.error = () => {};
    try {
        fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
        fs.writeFileSync(path.join(dir, 'Bad Name.json'), '{}');
        const ids = freshStore(dir).listPresets().map(preset => preset.id);

        assert.ok(!ids.includes('broken'));
        assert.ok(ids.includes('default'));
    } finally {
        console.error = error;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('saving over a premade keeps its blurb and place, and normalizes the model', async () => {
    const dir = sandboxCopy();
    try {
        const store = freshStore(dir);
        const before = JSON.parse(fs.readFileSync(path.join(dir, 'arcade.json'), 'utf8'));

        const model = store.presetModel('arcade');
        model.canvas.width = 700;
        model.labels = [{ text: '<b>hi</b>', color: 'not a color' }];
        await store.savePreset('arcade', model);

        const after = JSON.parse(fs.readFileSync(path.join(dir, 'arcade.json'), 'utf8'));
        assert.strictEqual(after.label, before.label);
        assert.strictEqual(after.description, before.description);
        assert.deepStrictEqual(after.tags, before.tags);
        assert.strictEqual(after.order, before.order);
        assert.strictEqual(after.model.canvas.width, 700);
        assert.strictEqual(after.model.labels[0].color, '#ffffff', 'checked like any saved theme');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('only an existing premade can be saved over', async () => {
    const dir = sandboxCopy();
    try {
        const store = freshStore(dir);

        await assert.rejects(store.savePreset('brand-new', store.defaultModel()), { code: 'not_found' });
        await assert.rejects(store.savePreset('../../etc/passwd', store.defaultModel()), { code: 'not_found' });
        assert.ok(!fs.existsSync(path.join(dir, 'brand-new.json')));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ---------------------------------------------------------------- the API */

async function withServer(run) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-premades-api-'));
    const themesDir = path.join(sandbox, 'themes');
    const presetsDir = sandboxCopy();
    fs.mkdirSync(path.join(themesDir, 'default'), { recursive: true });
    for (const file of ['index.html', 'style.css', 'properties.json']) {
        fs.writeFileSync(path.join(themesDir, 'default', file), 'stale');
    }

    process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';
    process.env.QUEUEIFY_THEMES_DIR = themesDir;
    process.env.QUEUEIFY_PRESETS_DIR = presetsDir;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE, '');

    const modules = ['../services/themeStore', '../services/widgetLayout', '../services/sceneThemes', '../setup/server']
        .map(name => require.resolve(name));
    for (const modulePath of modules) delete require.cache[modulePath];

    const { createApp } = require('../setup/server');
    const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });

    try {
        await run({ base: `http://127.0.0.1:${server.address().port}`, themesDir, presetsDir });
    } finally {
        await new Promise(done => server.close(done));
        for (const modulePath of modules) delete require.cache[modulePath];
        for (const key of ['QUEUEIFY_WIDGET_URL', 'QUEUEIFY_THEMES_DIR', 'QUEUEIFY_PRESETS_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_ENV_FILE']) {
            delete process.env[key];
        }
        fs.rmSync(sandbox, { recursive: true, force: true });
        fs.rmSync(presetsDir, { recursive: true, force: true });
    }
}

test('the gallery gets every premade as a page it can draw, with no script in it', async () => {
    await withServer(async ({ base }) => {
        const { presets } = await (await fetch(`${base}/api/presets`)).json();
        const orbit = presets.find(preset => preset.id === 'orbit');

        assert.ok(orbit.page.includes('<style>html, body'), 'its stylesheet written in');
        assert.ok(!orbit.page.includes('<script'), 'nothing that would run');
        assert.ok(orbit.page.includes('next-wrapper'), 'with its Up next row');
    });
});

test('saving over a premade writes the sandbox, and Default rebuilds the default theme', async () => {
    await withServer(async ({ base, themesDir, presetsDir }) => {
        const put = (id, model) => fetch(`${base}/api/presets/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model })
        });

        const { presets } = await (await fetch(`${base}/api/presets`)).json();
        const model = presets.find(preset => preset.id === 'default').model;
        model.canvas.width = 700;

        const response = await put('default', model);
        assert.strictEqual(response.status, 200);

        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(presetsDir, 'default.json'), 'utf8')).model.canvas.width, 700);
        assert.match(fs.readFileSync(path.join(themesDir, 'default', 'style.css'), 'utf8'), /width: 700px;/);

        assert.strictEqual((await put('nope', model)).status, 404);
    });
});
