const assert = require('assert');
const test = require('node:test');

const store = require('../services/themeStore');

/**
 * Text alignment, for every text part.
 *
 * The title used to ignore it: its wrapper was aligned, but the only thing
 * inside the wrapper is a full-width container, so there was nothing to move.
 * And a centred or right-aligned line long enough to scroll spilled off both
 * sides, starting with its first word cut off.
 *
 * What it looks like is checked in a browser; this pins the rules that do it.
 */

const ruleFor = (css, selector) => {
    const at = css.indexOf(selector + ' {');
    return at === -1 ? null : css.slice(at).split('}')[0];
};

const cssWith = (align) => {
    const model = store.normalizeModel(store.defaultModel());
    for (const module of model.modules) {
        if (store.TEXT_TYPES.includes(module.type) || store.TIME_TYPES.includes(module.type)) {
            module.align = align;
        }
    }
    return store.generateCss(model);
};

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

for (const [align, value] of Object.entries(JUSTIFY)) {
    test(`the title is aligned inside its full-width container: ${align}`, () => {
        const rule = ruleFor(cssWith(align), '.title-container');

        assert.match(rule, /width: 100%;/);
        assert.match(rule, /display: flex;/);
        assert.match(rule, new RegExp(`justify-content: ${value};`));
    });

    test(`every text part gets the same alignment: ${align}`, () => {
        const css = cssWith(align);

        for (const selector of ['.title-wrapper', '.artist-wrapper', '.elapsed-wrapper', '.duration-wrapper']) {
            assert.match(ruleFor(css, selector), new RegExp(`justify-content: ${value};`), selector);
        }
    });
}

test('centred and right-aligned text falls back to the start when it overflows', () => {
    for (const align of ['center', 'right']) {
        const css = cssWith(align);
        const value = JUSTIFY[align];

        for (const selector of ['.title-container', '.artist-wrapper', '.title-wrapper']) {
            const rule = ruleFor(css, selector);
            // The plain value first, for browsers that drop the `safe` line.
            assert.ok(
                rule.indexOf(`justify-content: ${value};`) < rule.indexOf(`justify-content: safe ${value};`),
                `${selector} ${align}`
            );
        }
    }
});

test('left-aligned text has no safe keyword to fall back from', () => {
    assert.doesNotMatch(cssWith('left'), /justify-content: safe/);
});

test('a scrolling line is put back at its start where safe is unsupported', () => {
    const css = cssWith('center');

    assert.match(css, /\.title-container\.overflowing,\s*\.artist-wrapper\.scrolling \{\s*justify-content: flex-start;/);
});
