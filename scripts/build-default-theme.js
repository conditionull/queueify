/*
   Writes the built-in themes made in the editor from their premades:
   widget/themes/default from services/presets/default.json, and
   widget/themes/minimal from services/presets/minimal.json.
   Usage: node scripts/build-default-theme.js

   These are built-in, so they stay read-only: no theme.json, which keeps them
   out of saveTheme's reach and opens them in the editor as a starting point
   rather than something to save over. But they are generated rather than
   hand-written, from the same models "Premade themes" hands out, so what
   somebody gets from the gallery is exactly what `!theme default` or
   `!theme minimal` shows.

   Change a premade, run this, commit both. tests/default-theme.test.js fails
   when the two disagree.
*/

const fs = require('fs');
const path = require('path');

const store = require('../services/themeStore');

// Swag is still hand-written; its premade is a copy of it, not its source.
const GENERATED = ['default', 'minimal'];

function buildBuiltInTheme(name) {
    const model = store.presetModel(name);

    return {
        'index.html': store.generateHtml(name, model),
        'style.css': store.generateCss(model),
        'properties.json': JSON.stringify(model.properties, null, 4)
    };
}

function buildDefaultTheme() {
    return buildBuiltInTheme('default');
}

/** Rewrites one built-in theme's folder, leaving nothing of the old one behind. */
function writeBuiltInTheme(name, themesDir = path.join(__dirname, '..', 'widget', 'themes')) {
    const dir = path.join(themesDir, name);
    fs.mkdirSync(dir, { recursive: true });

    const files = buildBuiltInTheme(name);
    for (const [file, contents] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, file), contents);
    }

    return dir;
}

if (require.main === module) {
    for (const name of GENERATED) {
        const dir = writeBuiltInTheme(name);
        console.log(`Wrote ${path.relative(process.cwd(), dir)} from the ${name} premade.`);
    }
}

module.exports = { buildDefaultTheme, buildBuiltInTheme, writeBuiltInTheme, GENERATED };
