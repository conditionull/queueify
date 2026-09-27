const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Lucide icons on a theme.
 *
 * They live in their own list rather than in `modules`: there can be any
 * number of them and they can be deleted, neither of which is true of the six
 * parts the widget runtime queries by name.
 *
 * The name is the only field in the whole model whose value ends up as markup
 * rather than as a CSS value, so most of what follows is about a theme.json
 * that has been tampered with.
 */

const withIcons = (icons) => store.normalizeModel({ ...store.defaultModel(), icons });

const iconRule = (css, id) => {
    const at = css.indexOf('.icon-' + id + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

test('a new theme has no icons, and the stylesheet does not mention them', () => {
    const model = store.normalizeModel(store.defaultModel());

    assert.deepStrictEqual(model.icons, []);
    assert.ok(!store.generateCss(model).includes('/* Icons */'));
    assert.ok(!store.generateHtml('demo', model).includes('class="icon'));
});

test('a theme saved before they existed keeps the widget it had', () => {
    // Version 4 is every theme written between the drop shadow and this.
    const model = store.normalizeModel({
        version: 4,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'title' }, { type: 'artist' }, { type: 'art' }, { type: 'progress' }]
    });

    assert.deepStrictEqual(model.icons, []);
    assert.ok(!store.generateCss(model).includes('/* Icons */'));
});

test('an icon is positioned and colored like everything else on the canvas', () => {
    const model = withIcons([{ name: 'play', x: 600, y: 20, w: 28, h: 28, color: '#ff8800' }]);
    const rule = iconRule(store.generateCss(model), 'i0');

    assert.match(rule, /left: 600px;/);
    assert.match(rule, /top: 20px;/);
    assert.match(rule, /width: 28px;/);
    assert.match(rule, /height: 28px;/);
    assert.match(rule, /color: #ff8800;/);
});

/**
 * Lucide draws every shape with `stroke="currentColor"`, so one `color` on the
 * wrapper reaches the whole icon - which is what lets an icon follow the
 * artwork the way the text colors already do.
 */
test('an icon can take an album color, and it reaches the drawing', () => {
    const model = withIcons([{ name: 'heart', color: 'var(--album-vibrant)' }]);
    const css = store.generateCss(model);

    assert.match(iconRule(css, 'i0'), /color: var\(--album-vibrant\);/);
    assert.match(store.generateHtml('demo', model), /stroke="currentColor"/);
});

test('the shapes are inlined, so a shared theme fetches nothing to draw them', () => {
    const html = store.generateHtml('demo', withIcons([{ name: 'play' }]));

    assert.match(html, /<div class="icon icon-i0">/);
    assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/);
    assert.match(html, /<path d="M5 5a2/, 'the real Lucide path, not a reference to one');
});

test('stroke width is an attribute, so the browser scales it with the icon', () => {
    const html = store.generateHtml('demo', withIcons([{ name: 'play', strokeWidth: 2.5 }]));
    assert.match(html, /stroke-width="2\.5"/);
});

test('rotation is only emitted when there is any', () => {
    assert.match(iconRule(store.generateCss(withIcons([{ name: 'star', rotate: 45 }])), 'i0'),
        /transform: rotate\(45deg\);/);
    assert.ok(!iconRule(store.generateCss(withIcons([{ name: 'star' }])), 'i0').includes('transform'));
});

test('a hidden icon keeps its settings and stops being drawn', () => {
    const model = withIcons([{ name: 'star', hidden: true, color: '#abcdef' }]);

    assert.match(iconRule(store.generateCss(model), 'i0'), /display: none;/);
    assert.strictEqual(model.icons[0].color, '#abcdef', 'hiding is not deleting');
});

test('icons sit above the artwork and the veil, with the text', () => {
    const css = store.generateCss(withIcons([{ name: 'star' }]));

    const zOf = (selector) => {
        const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
        return Number(/z-index: (-?\d+);/.exec(rule)[1]);
    };

    assert.ok(zOf('.icon-i0') > zOf('.canvas'), 'an icon must not be behind the artwork');
    assert.strictEqual(zOf('.icon-i0'), zOf('.title-wrapper'));
});

/* ------------------------------------------------- untrusted theme.json */

test('an icon that is not a real Lucide icon is dropped, not swapped', () => {
    const model = withIcons([{ name: 'definitely-not-an-icon' }, { name: 'play' }]);

    assert.strictEqual(model.icons.length, 1);
    assert.strictEqual(model.icons[0].name, 'play',
        'a missing icon must not quietly become a different picture');
});

test('a name cannot walk out of the icon directory', () => {
    const model = withIcons([
        { name: '../../../etc/passwd' },
        { name: '../package' },
        { name: 'play/../../secret' },
        { name: 'PLAY' },
        { name: 'play.svg' }
    ]);

    assert.deepStrictEqual(model.icons, [], 'none of those are icon names');
});

test('the id is rebuilt from position, so a theme cannot choose its own selector', () => {
    const model = withIcons([
        { name: 'play', id: 'x { } body { display: none } .y' },
        { name: 'heart', id: 'i0' }
    ]);

    assert.deepStrictEqual(model.icons.map(icon => icon.id), ['i0', 'i1']);

    const css = store.generateCss(model);
    assert.ok(!css.includes('display: none } .y'));
});

test('a color that is not one falls back rather than reaching the CSS', () => {
    const model = withIcons([{ name: 'play', color: 'red; } body { display: none } .x { color: red' }]);

    assert.strictEqual(model.icons[0].color, 'var(--album-light)');
    assert.ok(!store.generateCss(model).includes('display: none'));
});

test('no icon in the set carries a script or an event handler', () => {
    // The set is inlined into a page unescaped, so this is the assumption that
    // makes that safe. It is checked against the installed package rather than
    // assumed, because the package is updated by npm and not by this repo.
    const dangerous = [];

    for (const { name } of store.iconCatalog()) {
        const body = store.iconBody(name) || '';
        if (/<script|\son[a-z]+\s*=|javascript:|<foreignObject/i.test(body)) dangerous.push(name);
    }

    assert.deepStrictEqual(dangerous, []);
});

test('every number is clamped like the rest of the model', () => {
    const wild = withIcons([{ name: 'play', strokeWidth: 400, rotate: 9000, opacity: 42, w: -9 }]);

    assert.strictEqual(wild.icons[0].strokeWidth, 4);
    assert.strictEqual(wild.icons[0].rotate, 360);
    assert.strictEqual(wild.icons[0].opacity, 1);
    assert.strictEqual(wild.icons[0].w, 4);
});

test('a theme cannot ask the generator to inline a thousand icons', () => {
    const model = withIcons(Array.from({ length: 200 }, () => ({ name: 'play' })));

    assert.strictEqual(model.icons.length, 12);
    assert.deepStrictEqual(model.icons.map(icon => icon.id).slice(0, 3), ['i0', 'i1', 'i2']);
});

test('icons that are not a list, or not objects, are ignored', () => {
    assert.deepStrictEqual(store.normalizeModel({ ...store.defaultModel(), icons: 'play' }).icons, []);
    assert.deepStrictEqual(withIcons([null, 7, 'play', []]).icons, []);
});

test('a theme that uses icons survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(withIcons([
        { name: 'music', x: 12, y: 14, w: 40, h: 40, color: '#112233', strokeWidth: 1.5, rotate: 90, opacity: 0.6 }
    ])));

    const [icon] = store.normalizeModel(saved).icons;

    assert.strictEqual(icon.name, 'music');
    assert.strictEqual(icon.x, 12);
    assert.strictEqual(icon.w, 40);
    assert.strictEqual(icon.color, '#112233');
    assert.strictEqual(icon.strokeWidth, 1.5);
    assert.strictEqual(icon.rotate, 90);
    assert.strictEqual(icon.opacity, 0.6);
});

test('the catalog the picker searches has names and keywords', () => {
    const catalog = store.iconCatalog();

    assert.ok(catalog.length > 1000, 'the whole set, not a handful');

    const play = catalog.find(icon => icon.name === 'play');
    assert.ok(play, 'play is table stakes for a music overlay');
    assert.ok(play.tags.includes('music'), 'searching "music" has to find it');

    // Sorted, so the picker does not have to sort 2,000 entries itself.
    const names = catalog.map(icon => icon.name);
    assert.deepStrictEqual(names, [...names].sort());
});

/* ---------------------------------------------------------- drop shadow */

/** The one `filter:` line an icon gets, or null if it was given none. */
const iconFilter = (model, id = 'i0') => {
    const found = /\n {4}filter: (.+);/.exec(iconRule(store.generateCss(model), id));
    return found ? found[1] : null;
};

test('a new icon has no shadow, and no filter is emitted for one', () => {
    const model = withIcons([{ name: 'play' }]);

    assert.strictEqual(model.icons[0].shadow, 0);
    assert.strictEqual(iconFilter(model), null);
});

test('an icon saved before shadows existed draws the stylesheet it always did', () => {
    // Version 7 is every theme written between independent corners and this.
    const icon = { name: 'star', x: 40, y: 20, w: 28, h: 28, color: '#ff8800', rotate: 30, opacity: 0.8 };
    const model = store.normalizeModel({ ...store.defaultModel(), version: 7, icons: [icon] });

    assert.strictEqual(iconRule(store.generateCss(model), 'i0'), `.icon-i0 {
    position: absolute;
    left: 40px;
    top: 20px;
    width: 28px;
    height: 28px;
    z-index: 2;
    color: #ff8800;
    opacity: 0.8;
    transform: rotate(30deg);
    
`);
});

test('an icon takes the same shadow a text module does', () => {
    const model = withIcons([{ name: 'play', shadow: 6, shadowColor: '#000000' }]);

    // The same default angle, and the same numbers, as a shadowed title.
    assert.strictEqual(iconFilter(model), 'drop-shadow(4.24px 4.24px 0px #000000)');
});

/**
 * A filter is drawn before the transform on the same element, so on a rotated
 * icon the shadow would turn with it. The rotation is taken back off the angle,
 * so the shadow falls where it says whatever the icon is doing.
 */
test('rotating an icon does not swing its shadow round', () => {
    const thrown = (rotate) => iconFilter(withIcons([
        { name: 'play', rotate, shadow: 5, shadowAngle: 180, shadowColor: '#000000' }
    ]));

    assert.strictEqual(thrown(0), 'drop-shadow(0px 5px 0px #000000)', 'straight down');
    // Rotated 90 clockwise, the icon's own "down" is screen left, so the
    // shadow has to be thrown along the icon's +x to land below it.
    assert.strictEqual(thrown(90), 'drop-shadow(5px 0px 0px #000000)');
    assert.strictEqual(thrown(180), 'drop-shadow(0px -5px 0px #000000)');
});

test('distance 0 emits nothing, and the rest of the shadow survives', () => {
    const model = withIcons([{ name: 'play', shadow: 0, shadowBlur: 12, shadowAngle: 90 }]);

    assert.strictEqual(iconFilter(model), null);
    assert.strictEqual(model.icons[0].shadowBlur, 12);
    assert.strictEqual(model.icons[0].shadowAngle, 90);
});

test('an icon shadow is clamped and checked like a text one', () => {
    const [wild] = withIcons([{ name: 'play', shadow: 9000, shadowAngle: -5, shadowBlur: 9000 }]).icons;

    assert.strictEqual(wild.shadow, 40);
    assert.strictEqual(wild.shadowAngle, 0);
    assert.strictEqual(wild.shadowBlur, 40);

    const hostile = withIcons([{
        name: 'play', shadow: 4, shadowColor: 'red; } body { display: none } .x { color: red'
    }]);

    assert.strictEqual(hostile.icons[0].shadowColor, 'rgba(0,0,0,0.55)');
    assert.ok(!store.generateCss(hostile).includes('display: none }'));
});

test('an icon shadow survives a round trip through the model', () => {
    const saved = JSON.parse(JSON.stringify(withIcons([
        { name: 'heart', shadow: 9, shadowAngle: 45, shadowBlur: 6, shadowColor: '#112233' }
    ])));

    const [icon] = store.normalizeModel(saved).icons;

    assert.strictEqual(icon.shadow, 9);
    assert.strictEqual(icon.shadowAngle, 45);
    assert.strictEqual(icon.shadowBlur, 6);
    assert.strictEqual(icon.shadowColor, '#112233');
});
