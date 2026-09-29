const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * What model version 10 added for the premades: labels, the Up next row, a
 * squiggle bar with a gradient fill and a knob, and the art's ring, pixels
 * and spin, plus a bevel and gradient borders on cards.
 *
 * Every one of them is off unless a theme turns it on, and nothing is written
 * while it is off - which is what the first tests hold it to.
 */

const moduleOf = (model, type) => model.modules.find(module => module.type === type);

const withModule = (type, values) => store.normalizeModel({
    ...store.defaultModel(),
    modules: [{ ...store.defaultModel().modules.find(m => m.type === type), ...values }]
});

const rule = (css, selector) => {
    const at = css.indexOf(selector + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

/* ------------------------------------------------------------ old themes */

test('a theme saved before any of it writes none of it', () => {
    const model = store.normalizeModel({
        version: 9,
        canvas: { width: 680, height: 192 },
        modules: [{ type: 'art' }, { type: 'title' }, { type: 'progress' }]
    });
    const css = store.generateCss(model);
    const html = store.generateHtml('demo', model);

    for (const marker of ['/* Up next */', '/* Labels */', '/* Progress knob */', 'queueify-spin', 'queueify-pixelate', 'mask:']) {
        assert.ok(!css.includes(marker), `${marker} in the stylesheet`);
    }
    for (const marker of ['next-wrapper', 'qlabel', 'progress-knob', 'queueify-fx']) {
        assert.ok(!html.includes(marker), `${marker} in the page`);
    }
});

test('a theme saved before Up next gets it switched off, inside its own canvas', () => {
    const model = store.normalizeModel({ version: 9, canvas: { width: 303, height: 440 }, modules: [{ type: 'art' }] });
    const next = moduleOf(model, 'next');

    assert.strictEqual(next.hidden, true);
    assert.ok(next.x >= 0 && next.x + next.w <= 303, 'fits across');
    assert.ok(next.y >= 0 && next.y + next.h <= 440, 'fits down');
});

test('a theme that switched Up next on keeps it on', () => {
    assert.strictEqual(moduleOf(withModule('next', { hidden: false }), 'next').hidden, false);
});

/* ---------------------------------------------------------------- labels */

test('a label is text of your own, positioned and styled like any text part', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        labels: [{ text: 'Now playing', x: 20, y: 10, w: 140, h: 22, font: 'inter', fontWeight: 700, color: '#ff8800' }]
    });
    const css = rule(store.generateCss(model), '.qlabel-l0');

    assert.match(css, /left: 20px;/);
    assert.match(css, /top: 10px;/);
    assert.match(store.generateCss(model), /\.qlabel-l0 > \* \{[^}]*color: #ff8800;/);
    assert.match(store.generateHtml('demo', model), /<span class="qlabel-text">Now playing<\/span>/);
});

test('label text is escaped wherever it is written into the page', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        labels: [{ text: '<img src=x onerror=alert(1)> "quoted" & {requester}' }]
    });
    const html = store.generateHtml('demo', model);

    assert.ok(!html.includes('<img src=x'), 'no markup gets through');
    assert.ok(html.includes('data-text="&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &amp; {requester}"'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &amp; {requester}</span>'));
});

test('label text is one short line, and empty text is kept', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        labels: [{ text: 'a\u0000b\nc\t d   e' }, { text: 'x'.repeat(200) }, { text: '' }, { text: 42 }]
    });

    assert.deepStrictEqual(model.labels.map(label => label.text), ['a b c d e', 'x'.repeat(60), '', '']);
    assert.deepStrictEqual(model.labels.map(label => label.id), ['l0', 'l1', 'l2', 'l3']);
});

test('labels are capped, and a doctored one is checked like everything else', () => {
    const many = store.normalizeModel({ ...store.defaultModel(), labels: Array.from({ length: 12 }, () => ({ text: 'hi' })) });
    assert.strictEqual(many.labels.length, store.LABEL_LIMIT);

    const [label] = store.normalizeModel({
        ...store.defaultModel(),
        labels: [{ id: 'x { } body', text: 'hi', color: 'red; } body { display: none', font: 'nope', fontSize: 9000 }]
    }).labels;
    assert.strictEqual(label.id, 'l0');
    assert.strictEqual(label.color, '#ffffff');
    assert.strictEqual(label.font, 'system');
    assert.strictEqual(label.fontSize, 200);
});

test('a label\'s font is fetched, and a hidden one\'s is not', () => {
    const fonts = hidden => store.googleFonts(store.normalizeModel({
        ...store.defaultModel(),
        labels: [{ text: 'hi', font: 'vt323', fontWeight: 400, hidden }]
    }));

    assert.deepStrictEqual(fonts(false), [{ family: 'VT323', weights: [400] }]);
    assert.deepStrictEqual(fonts(true), []);
});

/* --------------------------------------------------------------- up next */

test('Up next writes nothing while it is switched off', () => {
    const model = withModule('next', { hidden: true });

    assert.ok(!store.generateCss(model).includes('/* Up next */'));
    assert.ok(!store.generateHtml('demo', model).includes('next-wrapper'));
});

test('switched on, Up next carries its settings for app.js and fades in and out', () => {
    const model = withModule('next', { hidden: false, label: 'Next <up>', count: 3, thumbs: false, requester: true });
    const html = store.generateHtml('demo', model);
    const css = store.generateCss(model);

    assert.match(html, /<div class="next-wrapper" data-source="queue" data-count="3" data-thumbs="0" data-requester="1">/);
    assert.match(html, /<span class="next-label">Next &lt;up&gt;<\/span>/);
    assert.match(rule(css, '.widget.has-next .next-wrapper'), /opacity: 1;/);
    assert.match(css, /\.next-wrapper \{\s+gap: 8px;\s+opacity: 0;/);
});

test('an empty caption leaves the caption out', () => {
    const html = store.generateHtml('demo', withModule('next', { hidden: false, label: '' }));
    assert.ok(!html.includes('next-label'));
});

test('Up next settings are clamped', () => {
    const next = moduleOf(withModule('next', { count: 40, chipRadius: 9000, labelColor: 'nope' }), 'next');

    assert.strictEqual(next.count, store.NEXT_LIMIT);
    assert.strictEqual(next.chipRadius, 40);
    assert.strictEqual(next.labelColor, 'var(--album-light)');
});

/* ---------------------------------------------------------- progress bar */

test('a squiggle masks the played part with one wave, and draws a plain line after it', () => {
    const model = withModule('progress', { style: 'squiggle', w: 400, h: 16, waveLength: 24, lineWidth: 4 });
    const css = store.generateCss(model);

    const mask = /-webkit-mask: url\("data:image\/svg\+xml,([^"]+)"\) 0 50% \/ 24px 16px repeat-x;/.exec(css);
    assert.ok(mask, 'masked with a repeating wave');
    const svg = decodeURIComponent(mask[1]);
    assert.match(svg, /viewBox="0 0 24 16"/);
    assert.match(svg, /<path d="M0 8 Q 6 -4 12 8 T 24 8"/);
    assert.match(svg, /stroke-width="4"/);

    assert.match(rule(css, '.progress-container::before'), /left: calc\(var\(--progress, 0\) \* 100%\);/);
    assert.match(css, /@keyframes queueify-squiggle/);
});

test('a gradient fill is sized to the whole bar, so its colors belong to positions along it', () => {
    const css = rule(store.generateCss(withModule('progress', {
        w: 300, fillMode: 'gradient', fillColor: '#111111', fillTo: 'var(--album-light)'
    })), '.progress');

    assert.match(css, /background: linear-gradient\(90deg, #111111, var\(--album-light\)\);/);
    assert.match(css, /background-size: 300px 100%;/);
});

test('a gradient waveform gives every bar its own slice of the gradient', () => {
    const css = store.generateCss(withModule('progress', {
        style: 'waveform', w: 100, bars: 10, barGap: 0, fillMode: 'gradient'
    }));

    assert.match(css, /\.wave\.fill > i:nth-child\(1\) \{ background-position: -0px 0; \}/);
    assert.match(css, /\.wave\.fill > i:nth-child\(10\) \{ background-position: -90px 0; \}/);
});

test('the knob is only there when it has a size, and rides --progress along the bar', () => {
    const off = withModule('progress', { knob: 0 });
    assert.ok(!store.generateHtml('demo', off).includes('progress-knob'));
    assert.ok(!store.generateCss(off).includes('.progress-knob'));

    const on = withModule('progress', { x: 100, y: 50, w: 400, h: 6, knob: 16, knobShape: 'square', knobColor: '#00ff00' });
    const css = rule(store.generateCss(on), '.progress-knob');

    assert.ok(store.generateHtml('demo', on).includes('<div class="progress-knob"></div>'));
    assert.match(css, /left: calc\(92px \+ 400px \* var\(--progress, 0\)\);/);
    assert.match(css, /top: 45px;/);
    assert.match(css, /background: #00ff00;/);
    assert.match(css, /border-radius: 3px;/);
});

/* ---------------------------------------------------------------- the art */

test('a gradient ring is a transparent border over a gradient', () => {
    const css = rule(store.generateCss(withModule('art', {
        borderWidth: 4, borderMode: 'gradient', borderColor: '#111111', borderTo: '#222222'
    })), '.cover,\n.canvas');

    assert.match(css, /border: 4px solid transparent;/);
    assert.match(css, /background: linear-gradient\(135deg, #111111, #222222\) border-box;/);
});

test('pixelation fits a whole number of blocks to the art, so no edge is left bare', () => {
    const model = withModule('art', { w: 640, h: 264, pixelate: 16 });
    const html = store.generateHtml('demo', model);

    assert.match(rule(store.generateCss(model), '.cover,\n.canvas'), /filter: url\(#queueify-pixelate\);/);
    // 640 / 16 is 40 blocks exactly; 264 / 16 is 16.5, so 17 blocks of 15.53.
    assert.match(html, /<feComposite width="16" height="15.53"\/>/);
    assert.match(html, /<feMorphology operator="dilate" radius="8 7.76"\/>/);
});

test('the art can spin, and stops when the music does', () => {
    const css = store.generateCss(withModule('art', { spin: 8 }));

    assert.match(rule(css, '.cover,\n.canvas'), /animation: queueify-spin 8s linear infinite;/);
    assert.match(css, /\.widget\.paused \.cover,\s+\.widget\.paused \.canvas \{\s+animation-play-state: paused;/);
});

test('unblurred art writes no blur layer, in the page or the stylesheet', () => {
    const model = withModule('art', {});

    assert.strictEqual(moduleOf(model, 'art').blur, 0);
    assert.ok(!store.generateHtml('demo', model).includes('art-blur'));
    assert.ok(!store.generateCss(model).includes('.art-blur'));
});

test('blurred art gets a layer over it, set in by its border so the border stays sharp', () => {
    const model = withModule('art', { x: 16, y: 20, w: 160, h: 160, radius: 24, borderWidth: 4, blur: 12 });
    const css = rule(store.generateCss(model), '.art-blur');

    assert.match(store.generateHtml('demo', model), /<div class="art-blur"><\/div>/);
    assert.match(css, /left: 20px;/);
    assert.match(css, /top: 24px;/);
    assert.match(css, /width: 152px;/);
    assert.match(css, /height: 152px;/);
    assert.match(css, /border-radius: 20px;/);
    assert.match(css, /backdrop-filter: blur\(12px\);/);
    assert.match(css, /z-index: 0;/);
});

test('hidden art has no blur layer, and a doctored blur is clamped', () => {
    const hidden = withModule('art', { hidden: true, blur: 12 });
    assert.ok(!store.generateHtml('demo', hidden).includes('art-blur'));
    assert.ok(!store.generateCss(hidden).includes('.art-blur'));

    assert.strictEqual(moduleOf(withModule('art', { blur: 900 }), 'art').blur, 40);
    assert.strictEqual(moduleOf(withModule('art', { blur: 'lots' }), 'art').blur, 0);
});

test('in a rearranged stack the blur layer stays just over the art', () => {
    const model = withModule('art', { blur: 8 });
    moduleOf(model, 'art').z = 99;
    const css = store.generateCss(store.normalizeModel(model));
    const z = selector => Number(css.match(new RegExp(selector + ' \\{ z-index: (\\d+); \\}'))[1]);

    assert.strictEqual(z('\\.art-blur'), z('\\.cover, \\.canvas') + 1);
});

/* ---------------------------------------------------------------- cards */

test('a bevel raises a card, on its fill layer', () => {
    const model = store.normalizeModel({ ...store.defaultModel(), cards: [{ bevel: 3 }] });

    assert.match(rule(store.generateCss(model), '.card-c0::before'),
        /box-shadow: inset 3px 3px 0 rgba\(255, 255, 255, .35\), inset -3px -3px 0 rgba\(0, 0, 0, .35\);/);
});

test('a gradient card border is a ring with its middle masked away', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        cards: [{ borderWidth: 2, borderMode: 'gradient', borderColor: '#111111', borderTo: '#222222', gradientAngle: 90 }]
    });
    const css = rule(store.generateCss(model), '.card-c0::after');

    assert.match(css, /padding: 2px;/);
    assert.match(css, /background: linear-gradient\(90deg, #111111, #222222\);/);
    assert.match(css, /-webkit-mask-composite: xor;/);
    assert.match(css, /mask: linear-gradient\(#000 0 0\) content-box exclude, linear-gradient\(#000 0 0\);/);
});

/* ---------------------------------------------------------------- fonts */

test('the pixel fonts are on offer, with the weights they really have', () => {
    for (const key of ['press-start-2p', 'vt323', 'silkscreen', 'pixelify-sans']) {
        assert.strictEqual(store.FONTS[key].category, 'Pixel', key);
    }
    assert.deepStrictEqual(store.FONTS.silkscreen.weights, [400, 700]);
});

test('the dot matrix fonts and the designer fonts are on offer, with the weights they really have', () => {
    // Every weight here was requested from the Google Fonts API and came back.
    const expected = {
        'doto': ['Dot', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
        'dotgothic16': ['Dot', [400]],
        'geist': ['Sans', [300, 400, 500, 600, 700, 800, 900]],
        'instrument-sans': ['Sans', [400, 500, 600, 700]],
        'dm-sans': ['Sans', [300, 400, 500, 600, 700, 800, 900]],
        'bricolage-grotesque': ['Sans', [300, 400, 500, 600, 700, 800]],
        'unbounded': ['Display', [300, 400, 500, 600, 700, 800, 900]],
        'syne': ['Display', [400, 500, 600, 700, 800]],
        'instrument-serif': ['Serif', [400]],
        'dm-serif-display': ['Serif', [400]],
        'young-serif': ['Serif', [400]],
        'geist-mono': ['Mono', [300, 400, 500, 600, 700, 800, 900]]
    };

    for (const [key, [category, weights]] of Object.entries(expected)) {
        assert.strictEqual(store.FONTS[key].category, category, key);
        assert.deepStrictEqual(store.FONTS[key].weights, weights, key);
        assert.ok(store.FONTS[key].google, key + ' comes from Google Fonts');
    }
    assert.strictEqual(store.FONT_CATEGORIES.Dot, 'Dot matrix');
});

test('a theme set in Doto asks Google Fonts for just the weights it uses', () => {
    const model = withModule('title', { font: 'doto', fontWeight: 200 });

    assert.match(store.generateHtml('demo', model), /family=Doto:wght@200&/);
});
