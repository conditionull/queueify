/*
   Writes widget/themes/default from the Default layout in services/themeStore.js.
   Usage: node scripts/build-default-theme.js

   The default theme is the fallback every install starts on, so it stays
   built-in: no theme.json, which keeps it out of the editor's reach and out of
   saveTheme's. But it is generated rather than hand-written, from the same
   model "Start from a layout -> Default" hands out, so what somebody gets from
   the layout picker is exactly what `!theme default` shows.

   Change the layout, run this, commit both. tests/default-theme.test.js fails
   when the two disagree.
*/

const fs = require('fs');
const path = require('path');

const store = require('../services/themeStore');

const NAME = 'default';

function buildDefaultTheme() {
    const model = store.normalizeModel(store.PRESETS.default.build());

    return {
        'index.html': store.generateHtml(NAME, model),
        'style.css': store.generateCss(model),
        'properties.json': JSON.stringify(model.properties, null, 4)
    };
}

if (require.main === module) {
    const dir = path.join(__dirname, '..', 'widget', 'themes', NAME);

    for (const [file, contents] of Object.entries(buildDefaultTheme())) {
        fs.writeFileSync(path.join(dir, file), contents);
    }

    console.log(`Wrote ${path.relative(process.cwd(), dir)} from the Default layout.`);
}

module.exports = { buildDefaultTheme };
