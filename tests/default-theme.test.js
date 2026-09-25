const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Read at load time, so it has to point somewhere harmless before the require.
process.env.QUEUEIFY_THEMES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-default-theme-'));
delete require.cache[require.resolve('../services/themeStore')];

const store = require('../services/themeStore');
const { buildDefaultTheme } = require('../scripts/build-default-theme');

/**
 * The built-in default theme is generated from the Default layout, so
 * "Start from a layout -> Default" and `!theme default` are the same design.
 * These fail when one is changed without the other.
 */

const SHIPPED = path.join(__dirname, '..', 'widget', 'themes', 'default');

test('the shipped default theme is what the Default layout generates', () => {
    for (const [file, contents] of Object.entries(buildDefaultTheme())) {
        const shipped = fs.readFileSync(path.join(SHIPPED, file), 'utf8').replace(/\r\n/g, '\n');

        assert.strictEqual(
            shipped, contents,
            `widget/themes/default/${file} is out of date - run node scripts/build-default-theme.js`
        );
    }
});

test('the default theme stays built-in, out of the editor\'s reach', () => {
    assert.ok(!fs.existsSync(path.join(SHIPPED, 'theme.json')), 'a theme.json would make it editable');
});

test('the Default layout is offered first', () => {
    const [first] = store.listPresets();

    assert.strictEqual(first.id, 'default');
    assert.strictEqual(first.label, 'Default');
});
