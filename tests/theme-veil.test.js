const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Blur and dim: the layer between what the panel is showing - its background,
 * and the album art or Canvas video - and the text drawn on top of it.
 *
 * It is a `backdrop-filter` rather than a `filter` on the artwork because a
 * filter samples past the element's own edges, which fades a blurred Canvas
 * video away around the edge of the panel it is filling.
 */

const canvasOf = (overrides) => store.normalizeModel({
    ...store.defaultModel(),
    canvas: { ...store.defaultModel().canvas, ...overrides }
});

const veil = (css) => {
    const at = css.indexOf('.widget::after {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

test('a new theme has neither, and the stylesheet does not mention them', () => {
    const model = store.normalizeModel(store.defaultModel());

    assert.strictEqual(model.canvas.blur, 0);
    assert.strictEqual(model.canvas.dim, 0);
    assert.strictEqual(veil(store.generateCss(model)), null);
});

test('a theme saved before they existed keeps the widget it had', () => {
    // Version 2 is every theme written between the time labels and this.
    const model = store.normalizeModel({
        version: 2,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'title' }, { type: 'artist' }, { type: 'art' }, { type: 'progress' }]
    });

    assert.strictEqual(model.canvas.blur, 0);
    assert.strictEqual(model.canvas.dim, 0);
    assert.strictEqual(veil(store.generateCss(model)), null);
});

test('blur is a backdrop filter, so the artwork keeps its edges', () => {
    const rule = veil(store.generateCss(canvasOf({ blur: 16 })));

    assert.match(rule, /[^-]backdrop-filter: blur\(16px\);/);
    // Older CEF builds - which is what OBS embeds - want the prefix.
    assert.match(rule, /-webkit-backdrop-filter: blur\(16px\);/);
});

/**
 * Dim is part of the filter rather than black laid over the top. A theme can
 * have its panel hidden, and an overlay would put a black rectangle over
 * something meant to be transparent; `brightness` never touches alpha.
 */
test('dim darkens what is there without filling in what is not', () => {
    const rule = veil(store.generateCss(canvasOf({ dim: 0.6 })));

    assert.match(rule, /backdrop-filter: brightness\(0\.4\);/);
    assert.ok(!rule.includes('background'), 'nothing is painted over the panel');
    assert.ok(!rule.includes('blur'), 'no blur asked for, none emitted');
});

test('asking for both gives one filter with both steps', () => {
    const rule = veil(store.generateCss(canvasOf({ blur: 10, dim: 0.25 })));
    assert.match(rule, /backdrop-filter: blur\(10px\) brightness\(0\.75\);/);
});

test('a theme with its panel hidden is not given something to hide behind', () => {
    const css = store.generateCss(canvasOf({ hidden: true, dim: 0.5 }));

    assert.match(css, /background: transparent;/);
    assert.ok(!veil(css).includes('background'), 'the veil must stay transparent too');
});

test('either one on its own is enough to draw the layer', () => {
    assert.ok(veil(store.generateCss(canvasOf({ blur: 4 }))));
    assert.ok(veil(store.generateCss(canvasOf({ dim: 0.05 }))));
});

test('the layer sits over the artwork and under everything else', () => {
    const css = store.generateCss(canvasOf({ blur: 8, dim: 0.4 }));

    const layer = (selector) => {
        const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
        return Number(/z-index: (-?\d+);/.exec(rule)[1]);
    };

    const art = layer('.canvas');
    const over = layer('.widget::after');

    assert.ok(art < over, 'the artwork has to be behind it');

    for (const selector of ['.title-wrapper', '.artist-wrapper', '.progress-container',
                            '.elapsed-wrapper', '.duration-wrapper']) {
        assert.ok(layer(selector) > over, selector + ' must not be dimmed with the artwork');
    }
});

test('it cannot be clicked through to, and cannot catch a pointer', () => {
    const rule = veil(store.generateCss(canvasOf({ dim: 0.3 })));
    assert.match(rule, /pointer-events: none;/);
});

test('both are clamped like every other number', () => {
    const wild = canvasOf({ blur: 9000, dim: 42 });
    assert.strictEqual(wild.canvas.blur, 40);
    assert.strictEqual(wild.canvas.dim, 1);

    const negative = canvasOf({ blur: -5, dim: -1 });
    assert.strictEqual(negative.canvas.blur, 0);
    assert.strictEqual(negative.canvas.dim, 0);
});

test('a dim that is not a number falls back rather than reaching the CSS', () => {
    const model = canvasOf({ dim: '0.5); } body { display: none } .x { color: red' });

    assert.strictEqual(model.canvas.dim, 0);
    assert.strictEqual(veil(store.generateCss(model)), null);
});

test('dim is kept to two decimals, so the rgba() stays readable', () => {
    assert.strictEqual(canvasOf({ dim: 0.333333 }).canvas.dim, 0.33);
});

test('a theme that uses them survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(canvasOf({ blur: 12, dim: 0.5 })));
    const reread = store.normalizeModel(saved);

    assert.strictEqual(reread.canvas.blur, 12);
    assert.strictEqual(reread.canvas.dim, 0.5);
});
