const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * The progress bar as a waveform: a row of lines of differing heights, with
 * the played part in the fill color.
 *
 * Both shapes keep the same contract with the widget runtime - `.progress` is
 * the played part and app.js sets its width as a percentage - so the waveform
 * is two identical rows of bars with the fill row clipped by that width.
 */

const progressOf = (over) => store.normalizeModel({
    ...store.defaultModel(),
    modules: [{ type: 'progress', ...over }]
});

const moduleOf = (model, type) => model.modules.find(m => m.type === type);
const ruleFor = (css, selector) => {
    const at = css.indexOf(selector + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

test('a new theme is still a plain bar', () => {
    const model = store.normalizeModel(store.defaultModel());

    assert.strictEqual(moduleOf(model, 'progress').style, 'bar');
    assert.ok(!store.generateCss(model).includes('.wave'));
    assert.ok(!store.generateHtml('demo', model).includes('wave'));
});

test('a theme saved before the waveform existed draws the bar it always did', () => {
    // Version 5 is every theme written between the icons and this.
    const model = store.normalizeModel({
        version: 5,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'progress', trackColor: '#222222', fillColor: '#00ff00' }]
    });

    assert.strictEqual(moduleOf(model, 'progress').style, 'bar');

    const rule = ruleFor(store.generateCss(model), '.progress');
    assert.match(rule, /background: #00ff00;/);
    assert.ok(!store.generateCss(model).includes('.wave'));
});

test('a waveform draws the lines twice, so the played part can be clipped', () => {
    const html = store.generateHtml('demo', progressOf({ style: 'waveform', bars: 12 }));

    assert.match(html, /<div class="wave track">(<i><\/i>){12}<\/div>/);
    assert.match(html, /<div class="progress"><div class="wave fill">(<i><\/i>){12}<\/div><\/div>/);
});

/**
 * The fill row is pinned to the width of the whole box in pixels. A
 * percentage would be a percentage of the clip, so the bars would squash
 * together as the song played instead of staying under the track's.
 */
test('the two rows stay lined up however far along the song is', () => {
    const css = store.generateCss(progressOf({ style: 'waveform', w: 420 }));

    assert.match(ruleFor(css, '.wave.fill'), /width: 420px;/);
    // And the clip needs a containing block, or the fill escapes it entirely.
    assert.match(ruleFor(css, '.progress'), /position: relative;/);
    assert.match(ruleFor(css, '.progress'), /overflow: hidden;/);
});

test('the track shows through, so the container is not painted over it', () => {
    const css = store.generateCss(progressOf({
        style: 'waveform', trackColor: '#333333', fillColor: '#ff0000'
    }));

    assert.match(ruleFor(css, '.progress-container'), /background: transparent;/);
    assert.match(ruleFor(css, '.wave.track > i'), /background: #333333;/);
    assert.match(ruleFor(css, '.wave.fill > i'), /background: #ff0000;/);
});

test('the lines differ in height, which is the whole point of it', () => {
    const css = store.generateCss(progressOf({ style: 'waveform', bars: 40 }));
    const heights = [...css.matchAll(/\.wave > i:nth-child\(\d+\) \{ height: (\d+)%; \}/g)]
        .map(match => Number(match[1]));

    assert.strictEqual(heights.length, 40, 'one height per line');
    assert.ok(new Set(heights).size > 12, 'a waveform, not a row of equal ticks');
    assert.ok(Math.min(...heights) >= 18, 'short lines, never gaps');
    assert.ok(Math.max(...heights) <= 100);
});

/**
 * The seed is stored and the heights are worked out from it. Storing the
 * heights would be storing a derived value - and a list that silently stops
 * matching the moment the line count changes.
 */
test('the same seed always gives the same waveform', () => {
    const once = store.generateCss(progressOf({ style: 'waveform', seed: 42 }));
    const again = store.generateCss(progressOf({ style: 'waveform', seed: 42 }));

    assert.strictEqual(once, again, 'a theme must not reshape itself when it is saved');
});

test('a different seed gives a different waveform', () => {
    const heights = (seed) => [...store.generateCss(progressOf({ style: 'waveform', seed }))
        .matchAll(/height: (\d+)%/g)].map(m => m[1]).join(',');

    assert.notStrictEqual(heights(1), heights(2));
});

test('changing the line count reshapes rather than truncating', () => {
    const model = progressOf({ style: 'waveform', bars: 24, seed: 9 });
    const css = store.generateCss(model);

    assert.strictEqual(moduleOf(model, 'bars'), undefined);
    assert.strictEqual([...css.matchAll(/nth-child\(\d+\) \{ height:/g)].length, 24);
});

/**
 * Still, deliberately. A browser source cannot hear what Spotify is playing,
 * so any movement here would be a loop pretending to be the audio - and it is
 * 48 elements animating forever in OBS, on the machine that is encoding.
 */
test('the waveform does not move', () => {
    const css = store.generateCss(progressOf({ style: 'waveform', animate: true }));

    // The title marquee has keyframes of its own; the waveform must not.
    assert.ok(!css.includes('wave-bounce'), 'no keyframes of its own');
    assert.ok(!/\.wave[^{]*\{[^}]*animation/.test(css), 'and nothing animating the lines');
});

test('a hidden progress bar is hidden whichever shape it is', () => {
    for (const style of ['bar', 'waveform']) {
        assert.match(ruleFor(store.generateCss(progressOf({ style, hidden: true })),
            '.progress-container'), /display: none;/);
    }
});

/* ------------------------------------------------- untrusted theme.json */

test('an unknown shape falls back to the bar rather than generating nothing', () => {
    const model = progressOf({ style: 'wave-form-deluxe' });

    assert.strictEqual(moduleOf(model, 'progress').style, 'bar');
    assert.ok(!store.generateCss(model).includes('.wave'));
});

test('the line count is clamped, so a theme cannot ask for ten thousand rules', () => {
    assert.strictEqual(moduleOf(progressOf({ style: 'waveform', bars: 99999 }), 'progress').bars, 96);
    assert.strictEqual(moduleOf(progressOf({ style: 'waveform', bars: -5 }), 'progress').bars, 8);
});

test('the seed is a number, not something that reaches the stylesheet', () => {
    const model = progressOf({ style: 'waveform', seed: '1; } body { display: none } .x {' });

    assert.strictEqual(moduleOf(model, 'progress').seed, 1);
    assert.ok(!store.generateCss(model).includes('display: none'));
});

test('the gap is clamped like every other number', () => {
    assert.strictEqual(moduleOf(progressOf({ style: 'waveform', barGap: 900 }), 'progress').barGap, 12);
    assert.strictEqual(moduleOf(progressOf({ style: 'waveform', barGap: -3 }), 'progress').barGap, 0);
});

test('a waveform theme survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(progressOf({
        style: 'waveform', bars: 64, barGap: 3, seed: 1234
    })));

    const progress = moduleOf(store.normalizeModel(saved), 'progress');

    assert.strictEqual(progress.style, 'waveform');
    assert.strictEqual(progress.bars, 64);
    assert.strictEqual(progress.barGap, 3);
    assert.strictEqual(progress.seed, 1234);
});
