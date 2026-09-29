const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Song-change animations: the art, title, and artist go out, the next song
 * comes in. app.js drives them with classes on the widget; the stylesheet
 * holds the animations themselves.
 */

const withTransition = (transition, art = {}) => store.normalizeModel({
    ...store.defaultModel(),
    modules: store.defaultModel().modules.map(module => (module.type === 'art' ? { ...module, ...art } : module)),
    properties: { ...store.defaultModel().properties, transition }
});

test('a theme saved before the animations changes songs the way it always did', () => {
    const model = store.normalizeModel({ version: 9, canvas: { width: 600, height: 200 }, modules: [{ type: 'art' }] });

    assert.strictEqual(model.properties.transition, 'none');
    assert.ok(!store.generateCss(model).includes('song-out'));
});

test('a new theme starts with one', () => {
    assert.strictEqual(store.normalizeModel(store.defaultModel()).properties.transition, 'slide');
});

test('every style writes its way out, its way in, and the text a beat behind the art', () => {
    for (const style of store.TRANSITIONS.filter(name => name !== 'none')) {
        const css = store.generateCss(withTransition(style));

        assert.match(css, /@keyframes qf-art-out \{/, style);
        assert.match(css, /@keyframes qf-text-in \{/, style);
        assert.match(css, /\.widget\.song-out \.title-wrapper \{ animation: qf-text-out [^;]+ \.02s both; \}/, style);
        assert.match(css, /\.widget\.song-in \.artist-wrapper \{ animation: qf-text-in [^;]+ \.1s both; \}/, style);
        assert.match(css, /\.widget\.dir-prev \{ --qf-dir: -1; \}/, style);
    }
});

test('only transforms, opacity, and clip-path move - never a filter', () => {
    for (const style of store.TRANSITIONS.filter(name => name !== 'none')) {
        const css = store.generateCss(withTransition(style));
        const frames = css.slice(css.indexOf('/* Changing songs'));

        assert.ok(!/@keyframes qf-[^{]+\{[^}]*filter/.test(frames), style + ' animates a filter');
    }
});

test('a wipe runs the other way on a skip back, and a flip gets its depth', () => {
    assert.match(store.generateCss(withTransition('wipe')), /\.widget\.dir-prev\.song-in \.cover,\n\.widget\.dir-prev\.song-in \.canvas \{ animation: qf-art-in-back /);
    assert.match(store.generateCss(withTransition('flip')), /\.widget\.song-out,\n\.widget\.song-in \{ perspective: 900px; \}/);
});

test('spinning art keeps spinning through a song change', () => {
    const css = store.generateCss(withTransition('slide', { spin: 8 }));

    assert.match(css, /\.widget\.song-out \.canvas \{ animation: queueify-spin 8s linear infinite, qf-art-out /);
    assert.match(css, /\.widget\.song-in \.canvas \{ animation: queueify-spin 8s linear infinite, qf-art-in /);
});

test('an unknown animation from a doctored file is none', () => {
    assert.strictEqual(withTransition('explode').properties.transition, 'none');
});
