const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Locks: the padlock beside each part's eye in the editor.
 *
 * A lock only stops the editor dragging, resizing, or nudging a part. It is
 * saved with the theme so it is still on after a reload, but the widget
 * never reads it.
 */

const locked = () => store.normalizeModel({
    ...store.defaultModel(),
    canvas: { ...store.defaultModel().canvas, locked: true },
    modules: store.defaultModel().modules.map(module => ({ ...module, locked: module.type === 'title' })),
    cards: [{ x: 10, y: 10, w: 100, h: 40, locked: true }],
    labels: [{ text: 'Now playing', locked: true }],
    icons: [{ name: 'music', locked: true }]
});

test('a theme saved before locks has nothing locked', () => {
    const model = store.normalizeModel({
        version: 9,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'art' }, { type: 'title' }],
        cards: [{ x: 10, y: 10, w: 100, h: 40 }]
    });

    assert.strictEqual(model.canvas.locked, false);
    assert.ok(model.modules.every(module => module.locked === false));
    assert.strictEqual(model.cards[0].locked, false);
});

test('a lock survives a round trip on the canvas and on every kind of part', () => {
    const model = store.normalizeModel(JSON.parse(JSON.stringify(locked())));

    assert.strictEqual(model.canvas.locked, true);
    assert.strictEqual(model.modules.find(module => module.type === 'title').locked, true);
    assert.strictEqual(model.modules.find(module => module.type === 'artist').locked, false);
    assert.strictEqual(model.cards[0].locked, true);
    assert.strictEqual(model.labels[0].locked, true);
    assert.strictEqual(model.icons[0].locked, true);
});

test('a lock from a doctored file is only ever true or false', () => {
    const model = store.normalizeModel({ ...store.defaultModel(), canvas: { locked: 'yes please' }, cards: [{ locked: 0 }] });

    assert.strictEqual(model.canvas.locked, true);
    assert.strictEqual(model.cards[0].locked, false);
});

test('locking changes nothing the widget draws', () => {
    const plain = store.normalizeModel({
        ...store.defaultModel(),
        cards: [{ x: 10, y: 10, w: 100, h: 40 }],
        labels: [{ text: 'Now playing' }],
        icons: [{ name: 'music' }]
    });

    assert.strictEqual(store.generateCss(locked()), store.generateCss(plain));
    assert.strictEqual(store.generateHtml('demo', locked()), store.generateHtml('demo', plain));
});
