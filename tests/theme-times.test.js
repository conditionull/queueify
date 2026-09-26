const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * The two clocks either side of the progress bar, and the outline that keeps
 * text readable over gameplay.
 */

const moduleOf = (model, type) => model.modules.find(module => module.type === type);

test('a new theme has both clocks, on either side of the bar', () => {
    const model = store.normalizeModel(store.defaultModel());

    const elapsed = moduleOf(model, 'elapsed');
    const duration = moduleOf(model, 'duration');
    const progress = moduleOf(model, 'progress');

    assert.strictEqual(elapsed.hidden, false);
    assert.strictEqual(duration.hidden, false);
    assert.ok(elapsed.x + elapsed.w <= progress.x, 'elapsed sits before the bar');
    assert.ok(duration.x >= progress.x + progress.w, 'the length sits after it');
});

test('a theme saved before the clocks existed does not suddenly grow two numbers', () => {
    const model = store.normalizeModel({
        version: 1,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'title' }, { type: 'artist' }, { type: 'art' }, { type: 'progress' }]
    });

    assert.strictEqual(moduleOf(model, 'elapsed').hidden, true);
    assert.strictEqual(moduleOf(model, 'duration').hidden, true);
    // Still present, so the elements app.js queries never go missing.
    assert.strictEqual(model.modules.filter(m => m.type === 'elapsed').length, 1);
});

test('an old theme that had already been given clocks keeps its own choice', () => {
    const model = store.normalizeModel({
        version: 1,
        modules: [{ type: 'elapsed', hidden: false, x: 10, y: 10, w: 40, h: 20 }]
    });

    assert.strictEqual(moduleOf(model, 'elapsed').hidden, false);
});

test('the generated theme has somewhere to write each clock', () => {
    const model = store.normalizeModel(store.defaultModel());
    const html = store.generateHtml('demo', model);

    assert.match(html, /class="elapsed"/);
    assert.match(html, /class="duration"/);
});

test('the clocks are laid out by the stylesheet like everything else', () => {
    const model = store.normalizeModel(store.defaultModel());
    const css = store.generateCss(model);

    assert.match(css, /\.elapsed-wrapper \{[\s\S]*?left: 200px;/);
    assert.match(css, /\.duration-wrapper \{[\s\S]*?left: 616px;/);
    // Digits must not jiggle as the seconds tick over.
    assert.match(css, /font-variant-numeric: tabular-nums/);
});

test('an outline is drawn behind the letters, not through them', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        modules: [{ type: 'title', outline: 3, outlineColor: '#101010' }]
    });

    const css = store.generateCss(model);

    assert.match(css, /-webkit-text-stroke: 6px #101010;/);
    // Without this the stroke is centered on the glyph edge and eats the text.
    assert.match(css, /paint-order: stroke fill;/);
});

test('no outline means no stroke rules at all', () => {
    const css = store.generateCss(store.normalizeModel(store.defaultModel()));
    assert.ok(!css.includes('-webkit-text-stroke'));
});

test('an outline color that is not a color falls back rather than reaching the CSS', () => {
    const model = store.normalizeModel({
        modules: [{ type: 'title', outline: 2, outlineColor: 'red; } body { display:none } .x {' }]
    });

    assert.strictEqual(moduleOf(model, 'title').outlineColor, '#000000');
});

test('outline width is clamped like every other number', () => {
    const model = store.normalizeModel({ modules: [{ type: 'artist', outline: 500 }] });
    assert.strictEqual(moduleOf(model, 'artist').outline, 12);
});

test('every preset places its clocks inside its own canvas', () => {
    for (const preset of store.listPresets()) {
        const { canvas } = preset.model;

        for (const type of ['elapsed', 'duration']) {
            const module = moduleOf(preset.model, type);
            assert.ok(module.x >= 0 && module.x + module.w <= canvas.width,
                `${preset.id}: ${type} runs off the canvas horizontally`);
            assert.ok(module.y >= 0 && module.y + module.h <= canvas.height,
                `${preset.id}: ${type} runs off the canvas vertically`);
        }
    }
});

test('the clocks use the fonts a design picked for them', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        modules: [{ type: 'elapsed', font: 'orbitron', fontWeight: 700 }]
    });

    assert.deepStrictEqual(store.googleFonts(model), [{ family: 'Orbitron', weights: [700] }]);
});

/**
 * The box a line of text lives in clips its overflow, so that a long title can
 * scroll rather than run off the panel. Half an outline is painted outside the
 * letters, and that clip was taking it off.
 */

test('an outlined box is grown to fit its stroke, and pulled back so nothing moves', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        modules: [{ type: 'title', x: 200, y: 46, w: 456, h: 36, outline: 3 }]
    });

    const rule = /\.title-wrapper \{([\s\S]*?)\}/.exec(store.generateCss(model))[1];

    assert.match(rule, /padding: 3px;/, 'the clip has to sit outside the stroke');
    assert.match(rule, /margin: -3px;/, 'and the box has to come back by the same amount');

    // The rectangle the editor draws and the user drags is untouched: this
    // moves where the clip falls, not where the text is.
    assert.match(rule, /left: 200px;/);
    assert.match(rule, /top: 46px;/);
    assert.match(rule, /width: 456px;/);
    assert.match(rule, /height: 36px;/);
});

test('half a pixel of stroke still gets a whole pixel of room', () => {
    const model = store.normalizeModel({ modules: [{ type: 'artist', outline: 2.5 }] });
    const rule = /\.artist-wrapper \{([\s\S]*?)\}/.exec(store.generateCss(model))[1];

    assert.match(rule, /padding: 3px;/);
    assert.match(rule, /margin: -3px;/);
});

test('a theme with no outline is padded nowhere at all', () => {
    const css = store.generateCss(store.normalizeModel(store.defaultModel()));

    for (const selector of ['.title-wrapper', '.artist-wrapper', '.elapsed-wrapper', '.duration-wrapper']) {
        const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
        assert.ok(!/padding|margin/.test(rule), selector + ' should not be padded');
    }
});

test('the box inside the title does not clip either', () => {
    // It is only as tall as one line, so it shaved the top and bottom off an
    // outline before the box around it ever saw the text.
    const css = store.generateCss(store.normalizeModel(store.defaultModel()));
    const rule = /\.title-container \{([\s\S]*?)\}/.exec(css)[1];

    assert.ok(!rule.includes('overflow'), 'the wrapper already clips, in the right place');
});

test('the fade at each end is measured from the box, not from the stroke', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        modules: [{ type: 'title', outline: 4 }, { type: 'artist', outline: 0 }]
    });

    const css = store.generateCss(model);

    // The title's element is 4px wider each side, so its fade starts 4px
    // further in - which puts both fades on the same line down the panel.
    assert.match(css, /\.title-wrapper\.scrolling \{[\s\S]*?#000 26px/);
    assert.match(css, /\.artist-wrapper\.scrolling \{[\s\S]*?#000 22px/);
});
