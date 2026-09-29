const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Cards: plain shapes that sit behind the parts, and the album art border.
 *
 * Between them they are what a detached layout is made of - hide the canvas,
 * give each part a tile of its own, and the widget comes apart into separate
 * pieces with the scene showing between them.
 */

const withCards = (cards) => store.normalizeModel({ ...store.defaultModel(), cards });

const rule = (css, selector) => {
    const at = css.indexOf(selector + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

const cardRule = (model, id = 'c0') => rule(store.generateCss(model), '.card-' + id);
const fillRule = (model, id = 'c0') => rule(store.generateCss(model), '.card-' + id + '::before');
const borderRule = (model, id = 'c0') => rule(store.generateCss(model), '.card-' + id + '::after');

test('a new theme has no cards, and neither the stylesheet nor the page mentions them', () => {
    const model = store.normalizeModel(store.defaultModel());

    assert.deepStrictEqual(model.cards, []);
    assert.ok(!store.generateCss(model).includes('/* Cards */'));
    assert.ok(!store.generateHtml('demo', model).includes('class="card'));
});

test('a theme saved before cards draws the stylesheet it always did', () => {
    // Version 8 is every theme written between icon shadows and this.
    const model = store.normalizeModel({
        version: 8,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'art', radius: 12, shadow: 20 }, { type: 'title' }]
    });

    assert.deepStrictEqual(model.cards, []);
    assert.strictEqual(model.modules.find(m => m.type === 'art').borderWidth, 0);

    const art = rule(store.generateCss(model), '.cover,\n.canvas');
    assert.ok(!art.includes('border:'), 'no border on art that never had one');
    assert.ok(!art.includes('box-sizing'), 'and nothing that changes its box');
});

test('a card is a box with a faded fill, behind the art by default', () => {
    const model = withCards([{ x: 10, y: 300, w: 280, h: 78 }]);
    const css = cardRule(model);

    assert.match(css, /left: 10px;/);
    assert.match(css, /top: 300px;/);
    assert.match(css, /width: 280px;/);
    assert.match(css, /height: 78px;/);
    assert.match(css, /z-index: 0;/);
    assert.match(css, /pointer-events: none;/);

    assert.match(fillRule(model), /inset: 0;/);
    assert.match(fillRule(model), /background: var\(--album-dark\);/);
    assert.match(fillRule(model), /opacity: 0.85;/);

    assert.match(borderRule(model), /box-sizing: border-box;/);
    assert.match(borderRule(model), /border: 1px solid rgba\(255,255,255,0.18\);/);
});

/**
 * The fill fades on a layer of its own. `opacity` on the card would fade the
 * frost behind it too, and `color-mix()` is missing from the Chromium in older
 * OBS builds - where an album color would then drop the fill entirely.
 */
test('fading the fill touches neither the card, the frost, nor the border', () => {
    const model = withCards([{ fillOpacity: 0.3, blur: 10 }]);

    assert.ok(!/\n {4}opacity/.test(cardRule(model)), 'the card itself stays opaque');
    assert.ok(!borderRule(model).includes('opacity'));
    assert.ok(!store.generateCss(model).includes('color-mix'));
});

/**
 * Every card is in the page ahead of the album art. A back card shares the
 * art's z-index, so the art - later in the page - covers it. A front card
 * shares the text's, so it lands over the art and under the words.
 */
test('the layer decides whether the art or the card is on top', () => {
    const model = withCards([{ layer: 'back' }, { layer: 'front' }]);
    const html = store.generateHtml('demo', model);

    assert.match(cardRule(model, 'c0'), /z-index: 0;/);
    assert.match(cardRule(model, 'c1'), /z-index: 2;/);

    assert.ok(html.indexOf('card-c0') < html.indexOf('class="cover"'));
    assert.ok(html.indexOf('card-c1') < html.indexOf('class="cover"'));
    assert.ok(html.indexOf('class="cover"') < html.indexOf('class="title-wrapper"'));
});

test('a card at full opacity writes no opacity at all', () => {
    const solid = fillRule(withCards([{ background: '#112233', fillOpacity: 1 }]));

    assert.match(solid, /background: #112233;/);
    assert.ok(!solid.includes('opacity'));
});

test('a gradient card fades as one', () => {
    const css = fillRule(withCards([{
        backgroundMode: 'gradient', background: '#000000', backgroundTo: 'var(--album-vibrant)',
        gradientAngle: 90, fillOpacity: 0.4
    }]));

    assert.match(css, /background: linear-gradient\(90deg, #000000, var\(--album-vibrant\)\);/);
    assert.match(css, /opacity: 0.4;/);
});

test('border, shadow, and frost are only written when they are there', () => {
    const bare = withCards([{ borderWidth: 0 }]);
    assert.strictEqual(borderRule(bare), null, 'no border layer');
    assert.ok(!cardRule(bare).includes('box-shadow'));
    assert.ok(!cardRule(bare).includes('backdrop-filter'));

    const model = withCards([{ borderWidth: 3, borderColor: '#ffffff', shadow: 20, blur: 12 }]);
    const dressed = cardRule(model);
    assert.match(borderRule(model), /border: 3px solid #ffffff;/);
    assert.match(dressed, /box-shadow: 0 10px 20px rgba\(0, 0, 0, .38\);/);
    assert.match(dressed, /-webkit-backdrop-filter: blur\(12px\);/);
    assert.match(dressed, /\n {4}backdrop-filter: blur\(12px\);/);
});

test('a card can round each corner on its own, and its layers follow', () => {
    const model = withCards([{ corners: [20, 20, 4, 4] }]);

    assert.match(cardRule(model), /border-radius: 20px 20px 4px 4px;/);
    assert.match(fillRule(model), /border-radius: inherit;/);
    assert.match(borderRule(model), /border-radius: inherit;/);
});

test('a hidden card keeps its settings and draws nothing', () => {
    const model = withCards([{ hidden: true, background: '#abcdef' }]);

    assert.strictEqual(model.cards[0].background, '#abcdef');
    assert.match(cardRule(model), /display: none;/);
});

test('a card from a doctored file is clamped and checked like everything else', () => {
    const model = withCards([{
        id: 'x { } body { display: none } .y',
        layer: 'sideways',
        background: 'red; } body { display: none } .x { color: red',
        fillOpacity: 7, borderWidth: 900, shadow: -4, blur: 900, w: 1
    }]);
    const [card] = model.cards;

    assert.strictEqual(card.id, 'c0', 'the id is positional, never read from the file');
    assert.strictEqual(card.layer, 'back');
    assert.strictEqual(card.background, 'var(--album-dark)');
    assert.strictEqual(card.fillOpacity, 1);
    assert.strictEqual(card.borderWidth, 12);
    assert.strictEqual(card.shadow, 0);
    assert.strictEqual(card.blur, 40);
    assert.strictEqual(card.w, 4);
    assert.ok(!store.generateCss(model).includes('display: none }'));
});

test('cards are capped, numbered by position, and junk entries are dropped', () => {
    const many = withCards(Array.from({ length: store.CARD_LIMIT + 4 }, () => ({})));
    assert.strictEqual(many.cards.length, store.CARD_LIMIT);
    assert.deepStrictEqual(many.cards.slice(0, 3).map(card => card.id), ['c0', 'c1', 'c2']);

    assert.deepStrictEqual(withCards([null, 7, 'card']).cards, []);
    assert.deepStrictEqual(store.normalizeModel({ ...store.defaultModel(), cards: 'card' }).cards, []);
});

test('a card survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(withCards([{
        x: 12, y: 34, w: 200, h: 50, layer: 'front', background: '#112233', backgroundMode: 'gradient',
        backgroundTo: 'var(--album-muted)', gradientAngle: 45, fillOpacity: 0.35, radius: 9,
        borderWidth: 2, borderColor: '#445566', shadow: 16, blur: 8
    }])));

    const [card] = store.normalizeModel(saved).cards;

    assert.deepStrictEqual(card, { ...saved.cards[0] });
});

test('the album art can have a border, drawn inside its box', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        modules: [{ type: 'art', borderWidth: 2, borderColor: '#ffffff' }]
    });
    const art = rule(store.generateCss(model), '.cover,\n.canvas');

    assert.match(art, /box-sizing: border-box;/);
    assert.match(art, /border: 2px solid #ffffff;/);
});

/* ---------------------------------------------------------- the layout */

const detached = () => store.listPresets().find(preset => preset.id === 'detached');

const inside = (part, box) =>
    part.x >= box.x && part.y >= box.y && part.x + part.w <= box.x + box.w && part.y + part.h <= box.y + box.h;

test('Detached is offered among the premade themes', () => {
    const preset = detached();

    assert.ok(preset);
    assert.strictEqual(preset.label, 'Detached');
    assert.strictEqual(preset.model.canvas.hidden, true, 'the scene shows between the tiles');
});

test('Detached puts every part on a tile of its own, inside the canvas', () => {
    const { model } = detached();
    const part = type => model.modules.find(module => module.type === type);
    const canvas = { x: 0, y: 0, w: model.canvas.width, h: model.canvas.height };
    const [textCard, barCard] = model.cards;

    for (const piece of [part('art'), ...model.cards]) {
        assert.ok(inside(piece, canvas), 'nothing hangs off the canvas');
    }

    assert.ok(part('art').y + part('art').h < textCard.y, 'a gap under the art');
    assert.ok(textCard.y + textCard.h < barCard.y, 'a gap under the text');

    assert.ok(inside(part('title'), textCard));
    assert.ok(inside(part('artist'), textCard));
    assert.ok(inside(part('elapsed'), barCard));
    assert.ok(inside(part('progress'), barCard));
    assert.ok(inside(part('duration'), barCard));

    // Up next is the one part every premade starts with off - it is optional.
    assert.ok(model.modules.every(module => !module.hidden || module.type === 'next'), 'nothing starts switched off');
});

test('Detached draws solid, borderless tiles', () => {
    const { model } = detached();
    const css = store.generateCss(model);

    for (const id of ['c0', 'c1']) {
        assert.ok(cardRule(model, id));
        assert.ok(!fillRule(model, id).includes('opacity'), 'solid');
        assert.strictEqual(borderRule(model, id), null, 'no border');
    }
    assert.ok(!rule(css, '.cover,\n.canvas').includes('border:'));
});
