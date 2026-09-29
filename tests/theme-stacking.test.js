const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Stacking and the inset panel: what lets one part sit over another in any
 * order, and a part stick out past the edge of the panel.
 *
 * Both have to leave an older theme exactly as it was, so most of this is
 * about what is *not* written.
 */

const withParts = (extra = {}) => store.normalizeModel({
    ...store.defaultModel(),
    cards: [{ x: 10, y: 10, w: 100, h: 40 }, { x: 20, y: 20, w: 60, h: 30, layer: 'front' }],
    labels: [{ text: 'Now playing' }],
    icons: [{ name: 'music' }],
    ...extra
});

const zOf = (model, key) => store.stackOf(model).indexOf(key);

test('a theme saved before stacking keeps the order the widget always drew', () => {
    const model = withParts();

    assert.deepStrictEqual(store.stackOf(model), [
        'card:c0', 'art', 'card:c1', 'title', 'artist', 'progress', 'elapsed', 'duration',
        'icon:i0', 'label:l0', 'next'
    ]);
    assert.strictEqual(model.cards[0].z, 0);
    assert.strictEqual(model.modules.find(module => module.type === 'next').z, 10);
});

test('an unrearranged theme writes no stacking rules and no panel layer', () => {
    const css = store.generateCss(withParts());

    assert.ok(!css.includes('Stacking'));
    assert.ok(!css.includes('.widget::before'));
});

test('ranks are settled into a plain order, whatever the file says', () => {
    const model = withParts();
    model.cards[0].z = 50;
    model.cards[1].z = 50;
    delete model.labels[0].z;

    const settled = store.normalizeModel(JSON.parse(JSON.stringify(model)));
    const ranks = store.stackOf(settled).map(key => zOf(settled, key));

    assert.deepStrictEqual(ranks, ranks.map((_, at) => at));
    // A tie is settled by the old order: the back card before the front one.
    assert.ok(zOf(settled, 'card:c0') < zOf(settled, 'card:c1'));
    assert.strictEqual(zOf(settled, 'card:c1'), store.stackOf(settled).length - 1);
});

test('a rearranged theme gives every part its own z-index, last in the sheet', () => {
    const model = withParts({ canvas: { ...store.defaultModel().canvas, blur: 6 } });
    model.modules.find(module => module.type === 'progress').knob = 10;
    // The card behind everything goes over the title.
    model.cards[0].z = model.modules.find(module => module.type === 'title').z + 0.5;

    const settled = store.normalizeModel(JSON.parse(JSON.stringify(model)));
    const css = store.generateCss(settled);
    const block = css.slice(css.indexOf('/* Stacking'));

    assert.ok(zOf(settled, 'card:c0') > zOf(settled, 'title'));
    for (const selector of ['.cover, .canvas', '.title-wrapper', '.card-c0', '.icon-i0', '.qlabel-l0', '.next-wrapper']) {
        assert.match(block, new RegExp(selector.replace(/[.*]/g, '\\$&') + ' \\{ z-index: \\d+; \\}'));
    }

    const z = selector => Number(block.match(new RegExp(selector.replace(/[.:]/g, '\\$&') + ' \\{ z-index: (\\d+)'))[1]);
    assert.ok(z('.card-c0') > z('.title-wrapper'));
    assert.strictEqual(z('.widget::after'), z('.cover, .canvas') + 1, 'the blur sits just over the art');
    assert.strictEqual(z('.progress-knob'), z('.progress-container') + 1, 'the knob sits just over its bar');
});

test('the panel inset is four sides, clamped to the canvas, and none by default', () => {
    assert.deepStrictEqual(store.normalizeModel(store.defaultModel()).canvas.inset, [0, 0, 0, 0]);

    const canvas = { width: 400, height: 100, inset: [20, 'x', 900, -5] };
    assert.deepStrictEqual(store.normalizeModel({ canvas }).canvas.inset, [20, 0, 100, 0]);
});

test('an inset panel is its own layer, and the widget around it is clear', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        canvas: { ...store.defaultModel().canvas, inset: [30, 0, 30, 44], borderWidth: 2, radius: 24 }
    });
    const css = store.generateCss(model);
    const widget = css.slice(css.indexOf('.widget {')).split('}')[0];
    const panel = css.slice(css.indexOf('.widget::before {')).split('}')[0];

    assert.match(widget, /background: transparent;/);
    assert.match(widget, /border: 0px solid/);
    assert.match(widget, /border-radius: 0px;/);
    assert.match(panel, /inset: 30px 0px 30px 44px;/);
    assert.match(panel, /z-index: 0;/);
    assert.match(panel, /border: 2px solid/);
    assert.match(panel, /border-radius: 24px;/);
});

test('a hidden panel draws no panel layer, inset or not', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        canvas: { ...store.defaultModel().canvas, inset: [30, 0, 30, 44], hidden: true }
    });

    assert.ok(!store.generateCss(model).includes('.widget::before'));
});

test('Vinyl has its record sticking out of the panel', () => {
    const vinyl = store.listPresets().find(preset => preset.id === 'vinyl').model;
    const [top, right, bottom, left] = vinyl.canvas.inset;
    const record = vinyl.cards[0];

    assert.ok(record.y < top, 'over the top edge');
    assert.ok(record.y + record.h > vinyl.canvas.height - bottom, 'over the bottom edge');
    assert.ok(record.x < left, 'over the left edge');
    assert.strictEqual(right, 0);
    assert.ok(zOf(vinyl, 'card:c0') < zOf(vinyl, 'art'), 'with the art on top of it, as its label');
});
