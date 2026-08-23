const assert = require('assert');
const test = require('node:test');

const { isThemeTakeoverTheme } = require('../services/themeTakeoverThemes');

test('allows only layout-compatible themes for Theme Takeover', () => {
    assert.strictEqual(isThemeTakeoverTheme('default'), true);
    assert.strictEqual(isThemeTakeoverTheme('swag'), true);
    assert.strictEqual(isThemeTakeoverTheme('minimal'), false);
    assert.strictEqual(isThemeTakeoverTheme('unknown'), false);
});