const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Independent corners: the canvas, the art and the progress bar can round
 * each corner by its own amount, as Figma lets you.
 *
 * `corners` is null for "all four the same as `radius`", so a theme that never
 * used it generates the stylesheet it always did.
 */

const ruleFor = (css, selector) => {
    const at = css.indexOf(selector + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

const moduleOf = (model, type) => model.modules.find(m => m.type === type);

test('a new theme has one radius per shape', () => {
    const model = store.normalizeModel(store.defaultModel());

    assert.strictEqual(model.canvas.corners, null);
    assert.strictEqual(moduleOf(model, 'art').corners, null);
    assert.strictEqual(moduleOf(model, 'progress').corners, null);
});

test('a theme saved before independent corners generates the same stylesheet', () => {
    const saved = {
        version: 6,
        canvas: { width: 680, height: 192, radius: 40 },
        modules: [{ type: 'art', radius: 12 }, { type: 'progress', radius: 3 }]
    };
    const css = store.generateCss(store.normalizeModel(saved));

    assert.match(ruleFor(css, '.widget'), /border-radius: 40px;/);
    assert.match(ruleFor(css, '.canvas'), /border-radius: 12px;/);
    assert.match(ruleFor(css, '.progress-container'), /border-radius: 3px;/);
});

test('four corners are written clockwise from the top left', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        canvas: { ...store.defaultModel().canvas, corners: [0, 24, 48, 8] },
        modules: [
            { type: 'art', corners: [16, 0, 16, 0] },
            { type: 'progress', corners: [999, 0, 0, 999] }
        ]
    });
    const css = store.generateCss(model);

    assert.match(ruleFor(css, '.widget'), /border-radius: 0px 24px 48px 8px;/);
    assert.match(ruleFor(css, '.canvas'), /border-radius: 16px 0px 16px 0px;/);
    assert.match(ruleFor(css, '.progress-container'), /border-radius: 999px 0px 0px 999px;/);
    // The played part follows the bar's shape rather than carrying its own.
    assert.match(ruleFor(css, '.progress'), /border-radius: inherit;/);
});

test('corners are clamped and rounded like every other number', () => {
    const model = store.normalizeModel({
        canvas: { corners: [-5, 12.6, 5000, '7'] },
        modules: [{ type: 'progress', corners: [5000, 0, 0, 0] }]
    });

    assert.deepStrictEqual(model.canvas.corners, [0, 13, 400, 7]);
    assert.deepStrictEqual(moduleOf(model, 'progress').corners, [999, 0, 0, 0]);
});

// A theme file can be imported from anyone, and this reaches the stylesheet.
test('anything that is not four numbers falls back to the single radius', () => {
    for (const corners of [[1, 2, 3], [1, 2, 3, 4, 5], 'red', { 0: 1 }, [1, 2, 3, '4px; }'], [1, 2, null, NaN]]) {
        const model = store.normalizeModel({ canvas: { radius: 20, corners } });

        assert.strictEqual(model.canvas.corners, null, JSON.stringify(corners));
        assert.match(ruleFor(store.generateCss(model), '.widget'), /border-radius: 20px;/);
    }
});
