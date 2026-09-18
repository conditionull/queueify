const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * The drop shadow behind title and artist text.
 *
 * It is a `drop-shadow` filter on the box rather than a `text-shadow` on the
 * text, for the reason the glow already is: the box clips its overflow so a
 * long title can scroll, and a text-shadow lives inside that clip - an offset
 * shadow would be sliced off against the edge of the box.
 */

const TEXT_SELECTORS = {
    title: '.title-wrapper',
    artist: '.artist-wrapper',
    elapsed: '.elapsed-wrapper',
    duration: '.duration-wrapper'
};

/** A model whose named text module carries the given settings. */
const textOf = (type, overrides) => store.normalizeModel({
    ...store.defaultModel(),
    modules: [{ type, ...overrides }]
});

const ruleFor = (css, selector) => css.slice(css.indexOf(selector + ' {')).split('}')[0];

/** The one `filter:` line a text box gets, or null if it was given none. */
const filterOf = (model, type = 'title') => {
    const rule = ruleFor(store.generateCss(model), TEXT_SELECTORS[type]);
    const found = /\n {4}filter: (.+);/.exec(rule);
    return found ? found[1] : null;
};

const moduleOf = (model, type) => model.modules.find(module => module.type === type);

test('a new theme has no shadow, and no filter is emitted for one', () => {
    const model = store.normalizeModel(store.defaultModel());

    for (const type of Object.keys(TEXT_SELECTORS)) {
        assert.strictEqual(moduleOf(model, type).shadow, 0);
        assert.strictEqual(filterOf(model, type), null, type + ' asked for nothing');
    }
});

test('a theme saved before it existed draws the stylesheet it always did', () => {
    // Version 3 is every theme written between canvas blur/dim and this.
    const model = store.normalizeModel({
        version: 3,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'title' }, { type: 'artist' }, { type: 'art' }, { type: 'progress' }]
    });

    assert.strictEqual(moduleOf(model, 'title').shadow, 0);
    assert.strictEqual(moduleOf(model, 'artist').shadow, 0);
    assert.ok(!store.generateCss(model).includes('drop-shadow'), 'nothing new in the CSS');
});

/**
 * The guard on the byte-for-byte promise above: a glow on its own still writes
 * the exact filter it wrote before the shadow shared the property with it.
 */
test('a glow on its own is untouched by the shadow sharing its filter', () => {
    const model = textOf('title', { glow: 10, glowColor: '#ff0000' });

    assert.strictEqual(
        filterOf(model),
        'drop-shadow(0 0 10px #ff0000) drop-shadow(0 0 5px #ff0000)'
    );
});

test('it is a filter on the box, not a text-shadow the clip would slice', () => {
    const model = textOf('title', { shadow: 6, shadowBlur: 4 });

    assert.match(filterOf(model), /^drop-shadow\(/);
    assert.ok(!store.generateCss(model).includes('text-shadow'),
        'a text-shadow would be cut off by overflow: hidden');
});

/**
 * Read the way the canvas gradient angle is - 0 up, 90 right, growing
 * clockwise - because that is the one angle convention the editor has already
 * taught its user. CSS measures y downwards, so "up" has to come out negative.
 */
test('the angle points the shadow where it says it does', () => {
    const thrown = (shadowAngle) =>
        filterOf(textOf('title', { shadow: 5, shadowAngle, shadowColor: '#000000' }));

    assert.strictEqual(thrown(0), 'drop-shadow(0px -5px 0px #000000)', '0 throws it up');
    assert.strictEqual(thrown(90), 'drop-shadow(5px 0px 0px #000000)', '90 throws it right');
    assert.strictEqual(thrown(180), 'drop-shadow(0px 5px 0px #000000)', '180 throws it down');
    assert.strictEqual(thrown(270), 'drop-shadow(-5px 0px 0px #000000)', '270 throws it left');
});

test('the default angle throws it down and to the right', () => {
    const model = textOf('title', { shadow: 6, shadowColor: '#000000' });

    assert.strictEqual(moduleOf(model, 'title').shadowAngle, 135);
    assert.strictEqual(filterOf(model), 'drop-shadow(4.24px 4.24px 0px #000000)');
});

test('the offset is kept to two decimals, so the CSS stays readable', () => {
    const offsets = /drop-shadow\((-?[\d.]+)px (-?[\d.]+)px/
        .exec(filterOf(textOf('title', { shadow: 7, shadowAngle: 35 })));

    for (const offset of offsets.slice(1)) {
        assert.ok(/^-?\d+(\.\d{1,2})?$/.test(offset),
            offset + ' is more precision than a pixel has');
    }
});

/**
 * Distance is the switch. A blur and an angle with nothing being thrown
 * describe a shadow that is not there, and a centred soft shadow is what the
 * glow already does.
 */
test('distance 0 emits nothing, whatever the rest of the settings say', () => {
    const model = textOf('title', { shadow: 0, shadowBlur: 30, shadowAngle: 90 });

    assert.strictEqual(filterOf(model), null);
    // The settings survive, so turning it back on restores what was set up.
    assert.strictEqual(moduleOf(model, 'title').shadowBlur, 30);
    assert.strictEqual(moduleOf(model, 'title').shadowAngle, 90);
});

test('a blur of 0 is a hard offset copy, not a shadow that was turned off', () => {
    assert.match(filterOf(textOf('title', { shadow: 3, shadowBlur: 0 })),
        /drop-shadow\([^)]*0px rgba/);
});

/**
 * Chained filters feed into each other. Shadow-then-glow haloes the letters
 * and their shadow; glow-then-shadow casts the shadow of the halo, which is a
 * soft dark blob the size of the glow.
 */
test('the shadow is applied before the glow, so the glow is not what casts it', () => {
    const filter = filterOf(textOf('title', { shadow: 5, shadowAngle: 90, glow: 8 }));

    assert.ok(filter.indexOf('rgba(0,0,0,0.55)') < filter.indexOf('var(--album-vibrant)'),
        'the shadow has to be the first step in the chain');
});

test('every text module can have one, and nothing else can', () => {
    for (const type of Object.keys(TEXT_SELECTORS)) {
        assert.ok(filterOf(textOf(type, { shadow: 4 }), type), type + ' should take a shadow');
    }

    const model = store.normalizeModel(store.defaultModel());

    // `art.shadow` is the artwork's own soft shadow, and predates this one.
    assert.strictEqual(moduleOf(model, 'art').shadowAngle, undefined,
        'the artwork has no angle to aim');
    assert.strictEqual(moduleOf(model, 'progress').shadow, undefined);
});

test('the shadow does not widen the box the way an outline does', () => {
    // An outline pads its box so the clip falls outside the stroke. A filter
    // paints past the box already, so a shadow must not move anything - and
    // widget/public/app.js subtracts that padding when it measures.
    const strip = (rule) => rule.replace(/\n {4}filter: .+;/, '');

    const plain = ruleFor(store.generateCss(textOf('title', {})), '.title-wrapper');
    const shadowed = ruleFor(
        store.generateCss(textOf('title', { shadow: 20, shadowBlur: 20 })), '.title-wrapper');

    assert.ok(!shadowed.includes('padding:'), 'no padding, so nothing to subtract when measuring');
    assert.strictEqual(strip(plain), strip(shadowed), 'the filter is the only difference');
});

test('every value is clamped like the rest of the model', () => {
    const wild = moduleOf(
        textOf('title', { shadow: 9000, shadowAngle: 999, shadowBlur: 9000 }), 'title');

    assert.strictEqual(wild.shadow, 40);
    assert.strictEqual(wild.shadowAngle, 360);
    assert.strictEqual(wild.shadowBlur, 40);

    const negative = moduleOf(
        textOf('title', { shadow: -5, shadowAngle: -90, shadowBlur: -1 }), 'title');

    assert.strictEqual(negative.shadow, 0);
    assert.strictEqual(negative.shadowAngle, 0);
    assert.strictEqual(negative.shadowBlur, 0);
});

test('a colour that is not one falls back rather than reaching the CSS', () => {
    const model = textOf('title', {
        shadow: 4,
        shadowColor: 'red; } body { display: none } .x { color: red'
    });

    assert.strictEqual(moduleOf(model, 'title').shadowColor, 'rgba(0,0,0,0.55)');
    assert.ok(!store.generateCss(model).includes('display: none'));
});

test('a distance that is not a number falls back rather than reaching the CSS', () => {
    const model = textOf('title', { shadow: '4px) drop-shadow(0 0 0 red' });

    assert.strictEqual(moduleOf(model, 'title').shadow, 0);
    assert.strictEqual(filterOf(model), null);
});

test('a theme that uses it survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(
        textOf('artist', { shadow: 9, shadowAngle: 45, shadowBlur: 6, shadowColor: '#112233' })
    ));

    const artist = moduleOf(store.normalizeModel(saved), 'artist');

    assert.strictEqual(artist.shadow, 9);
    assert.strictEqual(artist.shadowAngle, 45);
    assert.strictEqual(artist.shadowBlur, 6);
    assert.strictEqual(artist.shadowColor, '#112233');
});
