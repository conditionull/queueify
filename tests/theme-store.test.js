const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const storePath = path.join(__dirname, '..', 'services', 'themeStore.js');

function freshStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-themes-'));
    process.env.QUEUEIFY_THEMES_DIR = dir;
    delete require.cache[require.resolve(storePath)];
    return { store: require(storePath), dir };
}

function cleanup(dir) {
    delete process.env.QUEUEIFY_THEMES_DIR;
    delete require.cache[require.resolve(storePath)];
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

/** A hand-written theme: three files, no theme.json. */
function writeBuiltIn(dir, name) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'index.html'), '<div class="widget"></div>');
    fs.writeFileSync(path.join(dir, name, 'style.css'), '.widget { color: red; }');
    fs.writeFileSync(path.join(dir, name, 'properties.json'), '{}');
}

test('a saved theme carries every element the widget runtime queries', async () => {
    const { store, dir } = freshStore();

    try {
        await store.saveTheme('my-theme', store.defaultModel('My theme'));

        const html = fs.readFileSync(path.join(dir, 'my-theme', 'index.html'), 'utf8');

        // app.js reads these unguarded - a theme missing one would throw at runtime.
        for (const hook of [
            'class="widget"', 'class="title-wrapper"', 'class="title-container"',
            'class="title"', 'class="artist"', 'class="progress-container"',
            'class="progress"', 'class="cover"', 'class="canvas"'
        ]) {
            assert.ok(html.includes(hook), `generated markup is missing ${hook}`);
        }

        assert.ok(html.includes('/themes/my-theme/style.css'), 'stylesheet must be linked by theme name');
        assert.ok(html.includes('src="/app.js"'), 'the widget runtime must be loaded');
    } finally {
        cleanup(dir);
    }
});

test('saving writes the model plus everything generated from it', async () => {
    const { store, dir } = freshStore();

    try {
        await store.saveTheme('neon', { ...store.defaultModel('Neon'), label: 'Neon' });

        for (const file of ['theme.json', 'style.css', 'index.html', 'properties.json']) {
            assert.ok(fs.existsSync(path.join(dir, 'neon', file)), `${file} should have been written`);
        }

        const properties = JSON.parse(fs.readFileSync(path.join(dir, 'neon', 'properties.json'), 'utf8'));
        assert.strictEqual(properties.media.mode, 'canvas');
        assert.strictEqual(properties.showProgress, true);

        const reopened = await store.readModel('neon');
        assert.strictEqual(reopened.label, 'Neon');
        assert.strictEqual(reopened.modules.length, store.MODULE_TYPES.length);
    } finally {
        cleanup(dir);
    }
});

test('a design survives the round trip through disk', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel('Round trip');
        const title = model.modules.find(m => m.type === 'title');
        title.x = 240;
        title.fontSize = 31;
        title.color = '#ff00aa';
        model.canvas.radius = 8;

        await store.saveTheme('round-trip', model);
        const reopened = await store.readModel('round-trip');
        const reopenedTitle = reopened.modules.find(m => m.type === 'title');

        assert.strictEqual(reopenedTitle.x, 240);
        assert.strictEqual(reopenedTitle.fontSize, 31);
        assert.strictEqual(reopenedTitle.color, '#ff00aa');
        assert.strictEqual(reopened.canvas.radius, 8);

        const css = fs.readFileSync(path.join(dir, 'round-trip', 'style.css'), 'utf8');
        assert.ok(css.includes('left: 240px;'));
        assert.ok(css.includes('font-size: 31px;'));
        assert.ok(css.includes('border-radius: 8px;'));
    } finally {
        cleanup(dir);
    }
});

test('built-in themes are read-only, so there is always a working fallback', async () => {
    const { store, dir } = freshStore();
    writeBuiltIn(dir, 'default');

    try {
        await assert.rejects(
            () => store.saveTheme('default', store.defaultModel()),
            err => err.code === 'not_editable'
        );
        await assert.rejects(
            () => store.deleteTheme('default'),
            err => err.code === 'not_editable'
        );
        await assert.rejects(
            () => store.readModel('default'),
            err => err.code === 'not_editable'
        );

        // Untouched by all of that.
        assert.strictEqual(
            fs.readFileSync(path.join(dir, 'default', 'style.css'), 'utf8'),
            '.widget { color: red; }'
        );
    } finally {
        cleanup(dir);
    }
});

test('listing separates editor themes from the built-in ones', async () => {
    const { store, dir } = freshStore();
    writeBuiltIn(dir, 'minimal');

    try {
        await store.saveTheme('mine', { ...store.defaultModel(), label: 'Mine' });

        const themes = await store.listThemes();
        const byName = Object.fromEntries(themes.map(theme => [theme.name, theme]));

        assert.strictEqual(byName.minimal.builtIn, true);
        assert.strictEqual(byName.minimal.editable, false);
        assert.strictEqual(byName.mine.editable, true);
        assert.strictEqual(byName.mine.label, 'Mine');
    } finally {
        cleanup(dir);
    }
});

test('deleting removes only the theme asked for', async () => {
    const { store, dir } = freshStore();

    try {
        await store.saveTheme('keep', store.defaultModel());
        await store.saveTheme('bin', store.defaultModel());

        await store.deleteTheme('bin');

        assert.ok(!fs.existsSync(path.join(dir, 'bin')));
        assert.ok(fs.existsSync(path.join(dir, 'keep')));
        await assert.rejects(() => store.deleteTheme('bin'), err => err.code === 'not_found');
    } finally {
        cleanup(dir);
    }
});

test('a name that could escape the themes folder is refused', async () => {
    const { store, dir } = freshStore();

    try {
        for (const name of ['../evil', 'a/b', 'C:\\evil', '.', '..', '', 'Uppercase', 'has space']) {
            await assert.rejects(
                () => store.saveTheme(name, store.defaultModel()),
                err => err.code === 'invalid_name',
                `"${name}" should not be accepted`
            );
        }

        assert.deepStrictEqual(fs.readdirSync(dir), []);
    } finally {
        cleanup(dir);
    }
});

test('hostile values cannot reach the generated stylesheet', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        const title = model.modules.find(m => m.type === 'title');

        title.color = 'red; } body { display: none; } .x {';
        title.font = '"; behaviour: url(evil)';
        title.fontSize = 99999;
        model.canvas.background = 'url(http://example.com/track.png)';

        await store.saveTheme('hostile', model);
        const css = fs.readFileSync(path.join(dir, 'hostile', 'style.css'), 'utf8');

        assert.ok(!css.includes('display: none; } .x'), 'a color must not break out of its rule');
        assert.ok(!css.includes('behaviour'), 'a font must come from the known list');
        assert.ok(!css.includes('url('), 'no external references');
        // Clamped, not echoed.
        assert.ok(css.includes('font-size: 200px;'), 'an absurd size is clamped to the limit');
    } finally {
        cleanup(dir);
    }
});

test('a half-filled model is completed rather than rejected', () => {
    const { store, dir } = freshStore();

    try {
        const model = store.normalizeModel({ modules: [{ type: 'title', x: 10 }] });

        assert.strictEqual(model.modules.length, store.MODULE_TYPES.length);
        assert.deepStrictEqual(model.modules.map(m => m.type).sort(), [...store.MODULE_TYPES].sort());
        assert.strictEqual(model.modules.find(m => m.type === 'title').x, 10);
        assert.strictEqual(model.properties.showProgress, true);
    } finally {
        cleanup(dir);
    }
});

test('hiding a module keeps its element in the markup', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        model.modules.find(m => m.type === 'progress').hidden = true;

        await store.saveTheme('no-bar', model);

        const html = fs.readFileSync(path.join(dir, 'no-bar', 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(dir, 'no-bar', 'style.css'), 'utf8');

        // app.js touches .progress-container unguarded, so it must still exist.
        assert.ok(html.includes('class="progress-container"'));
        assert.ok(/\.progress-container \{[^}]*display: none;/s.test(css));
    } finally {
        cleanup(dir);
    }
});

test('the font list only offers weights the family actually ships', () => {
    const { store, dir } = freshStore();

    try {
        for (const [key, font] of Object.entries(store.FONTS)) {
            assert.ok(font.label, `${key} needs a label`);
            assert.ok(font.stack.includes(','), `${key} needs a fallback stack`);
            assert.ok(Array.isArray(font.weights) && font.weights.length, `${key} needs weights`);
            if (font.google) assert.ok(font.family, `${key} needs a family name`);
        }

        // Bebas Neue is 400-only: asking for bold must land on what exists.
        const model = store.normalizeModel({
            modules: [{ type: 'title', font: 'bebas-neue', fontWeight: 800 }]
        });

        assert.strictEqual(model.modules.find(m => m.type === 'title').fontWeight, 400);
    } finally {
        cleanup(dir);
    }
});

test('a theme pulls in only the web fonts it uses', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        model.modules.find(m => m.type === 'title').font = 'bebas-neue';
        model.modules.find(m => m.type === 'artist').font = 'orbitron';
        model.modules.find(m => m.type === 'artist').fontWeight = 600;

        await store.saveTheme('fonts', model);
        const html = fs.readFileSync(path.join(dir, 'fonts', 'index.html'), 'utf8');

        assert.match(html, /family=Bebas\+Neue:wght@400/);
        assert.match(html, /family=Orbitron:wght@600/);
        assert.ok(!html.includes('Poppins'), 'unused families must not be requested');
        assert.ok(html.includes('rel="preconnect"'));

        const css = fs.readFileSync(path.join(dir, 'fonts', 'style.css'), 'utf8');
        assert.ok(css.includes('"Bebas Neue", Impact'), 'the stylesheet keeps a local fallback');
    } finally {
        cleanup(dir);
    }
});

test('a theme using only local fonts asks the network for nothing', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        for (const module of model.modules) {
            if (module.type === 'title' || module.type === 'artist') module.font = 'system';
        }

        await store.saveTheme('offline', model);
        const html = fs.readFileSync(path.join(dir, 'offline', 'index.html'), 'utf8');

        assert.ok(!html.includes('fonts.googleapis.com'), 'no font request for system fonts');
        assert.ok(!html.includes('preconnect'));
    } finally {
        cleanup(dir);
    }
});

test('a hidden text module does not drag its font onto the page', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        const artist = model.modules.find(m => m.type === 'artist');
        artist.font = 'monoton';
        artist.hidden = true;

        await store.saveTheme('hidden-font', model);
        const html = fs.readFileSync(path.join(dir, 'hidden-font', 'index.html'), 'utf8');

        assert.ok(!html.includes('Monoton'));
    } finally {
        cleanup(dir);
    }
});

test('the starting presets are all usable designs', () => {
    const { store, dir } = freshStore();

    try {
        const presets = store.listPresets();
        assert.ok(presets.length >= 4, 'there should be a few ways to start');

        for (const preset of presets) {
            assert.ok(preset.id && preset.label && preset.description, `${preset.id} is missing its blurb`);

            // A preset is just a model, so it has to survive the same rules.
            const model = store.normalizeModel(preset.model);
            assert.deepStrictEqual(
                model.modules.map(module => module.type).sort(),
                [...store.MODULE_TYPES].sort(),
                `${preset.id} is missing a module`
            );

            const css = store.generateCss(model);
            assert.ok(css.includes('.widget {'), `${preset.id} produced no widget rule`);
            assert.ok(!css.includes('undefined'), `${preset.id} left an undefined value in the css`);

            // Nothing should start off the edge of its own canvas.
            for (const module of model.modules) {
                assert.ok(module.x >= 0 && module.y >= 0, `${preset.id}: ${module.type} starts off-canvas`);
                assert.ok(
                    module.x + module.w <= model.canvas.width + 1,
                    `${preset.id}: ${module.type} hangs off the right edge`
                );
            }
        }
    } finally {
        cleanup(dir);
    }
});

test('a gradient background survives the round trip', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        Object.assign(model.canvas, {
            backgroundMode: 'gradient',
            background: '#101014',
            backgroundTo: 'var(--album-vibrant)',
            gradientAngle: 45
        });

        await store.saveTheme('gradient', model);
        const css = fs.readFileSync(path.join(dir, 'gradient', 'style.css'), 'utf8');

        assert.match(css, /background: linear-gradient\(45deg, #101014, var\(--album-vibrant\)\);/);
        assert.strictEqual((await store.readModel('gradient')).canvas.gradientAngle, 45);

        // Switching back to a flat color must not leave the gradient behind.
        // Only the widget's own rule is checked: the fades at the edges of a
        // scrolling line are gradients too, and they are meant to be there.
        model.canvas.backgroundMode = 'solid';
        await store.saveTheme('gradient', model);

        const solid = fs.readFileSync(path.join(dir, 'gradient', 'style.css'), 'utf8');
        const widgetRule = /\.widget \{[^}]*\}/s.exec(solid)[0];

        assert.ok(!widgetRule.includes('linear-gradient'), widgetRule);
    } finally {
        cleanup(dir);
    }
});

test('text effects reach the stylesheet, and a hostile glow color does not', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel();
        Object.assign(model.modules.find(m => m.type === 'title'), {
            uppercase: true,
            italic: true,
            glow: 14,
            glowColor: 'red; } body { display: none } .x {'
        });

        await store.saveTheme('effects', model);
        const css = fs.readFileSync(path.join(dir, 'effects', 'style.css'), 'utf8');

        assert.match(css, /text-transform: uppercase;/);
        assert.match(css, /font-style: italic;/);
        // A drop-shadow filter, not a text-shadow: the text box clips its
        // overflow for scrolling, which would slice a shadow into a rectangle.
        assert.match(css, /filter: drop-shadow\(0 0 14px/);
        assert.ok(!css.includes('display: none } .x'), 'a glow color must not break out of its rule');
    } finally {
        cleanup(dir);
    }
});

test('an imported file is clamped like anything else', () => {
    const { store, dir } = freshStore();

    try {
        // The shape a shared export has, with some hostile values in it.
        const model = store.normalizeModel({
            queueifyTheme: 1,
            label: 'x'.repeat(200),
            canvas: { width: 99999, height: -40, backgroundMode: 'rainbow', gradientAngle: 900 },
            modules: [{ type: 'title', glow: 999, fontSize: 0 }],
            properties: { hideAfter: -50, scroll: { speed: 99999 } }
        });

        assert.ok(model.label.length <= 60);
        assert.strictEqual(model.canvas.width, 1920);
        assert.strictEqual(model.canvas.height, 40);
        assert.strictEqual(model.canvas.backgroundMode, 'solid');
        assert.strictEqual(model.canvas.gradientAngle, 360);

        const title = model.modules.find(m => m.type === 'title');
        assert.strictEqual(title.glow, 40);
        assert.strictEqual(title.fontSize, 6);
        assert.strictEqual(model.properties.hideAfter, -1);
        assert.strictEqual(model.properties.scroll.speed, 600);
    } finally {
        cleanup(dir);
    }
});

/**
 * The widget runtime swaps the theme stylesheet when the theme changes. It
 * used to pick "the first stylesheet on the page", which after web fonts
 * arrived was the Google Fonts link - so switching theme deleted the
 * @font-face rules and the font silently fell back. The generated markup names
 * its own stylesheet so there is nothing to guess at.
 */
test('the theme stylesheet is named, so web font links are never mistaken for it', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel('Fonted');
        model.modules.find(module => module.type === 'title').font = 'bitter';

        await store.saveTheme('fonted', model);
        const html = fs.readFileSync(path.join(dir, 'fonted', 'index.html'), 'utf8');

        assert.match(html, /<link id="theme" rel="stylesheet" href="\/themes\/fonted\/style\.css">/);

        // The font link is a different element, and must not carry that id.
        const fontLink = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/.exec(html);
        assert.ok(fontLink, 'the web font should still be requested');
        assert.ok(!fontLink[0].includes('id="theme"'), 'only the theme stylesheet is the theme stylesheet');

        // And the runtime targets it by id, or by path - never "the first one".
        const runtime = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'app.js'), 'utf8');
        assert.match(runtime, /getElementById\("theme"\)/);
        assert.match(runtime, /link\[rel="stylesheet"\]\[href\*="\/themes\/"\]/);
    } finally {
        cleanup(dir);
    }
});

test('the background panel can be taken away without losing its colors', async () => {
    const { store, dir } = freshStore();

    try {
        const model = store.defaultModel('Floating');
        model.canvas.background = '#101014';
        model.canvas.borderWidth = 2;
        model.canvas.hidden = true;

        await store.saveTheme('floating', model);
        const css = fs.readFileSync(path.join(dir, 'floating', 'style.css'), 'utf8');
        const widget = /\.widget \{[^}]*\}/s.exec(css)[0];

        assert.match(widget, /background: transparent;/);
        assert.match(widget, /border: 0px solid/);

        // The colors are kept, so showing the panel again restores the design.
        const reopened = await store.readModel('floating');
        assert.strictEqual(reopened.canvas.background, '#101014');
        assert.strictEqual(reopened.canvas.borderWidth, 2);
        assert.strictEqual(reopened.canvas.hidden, true);
    } finally {
        cleanup(dir);
    }
});

/**
 * Long text scrolls, short text does not. app.js measures each line and sets
 * a separate distance for each, so the generated CSS has to read the right
 * one - the artist used to be animated by the title's distance, which sent it
 * sliding off the side even when it fitted.
 */
test('each line scrolls by its own measured distance', async () => {
    const { store, dir } = freshStore();

    try {
        await store.saveTheme('scrolls', store.defaultModel());
        const css = fs.readFileSync(path.join(dir, 'scrolls', 'style.css'), 'utf8');

        const titleFrames = /@keyframes queueify-scroll-title \{[^}]*\}[^}]*\}/s.exec(css)[0];
        const artistFrames = /@keyframes queueify-scroll-artist \{[^}]*\}[^}]*\}/s.exec(css)[0];

        assert.match(titleFrames, /--scroll-distance/);
        assert.ok(!titleFrames.includes('--artist-distance'));
        assert.match(artistFrames, /--artist-distance/);
        assert.ok(!artistFrames.includes('--scroll-distance'));

        // The animations hang off the class app.js only adds when a line
        // overflows, so a line that fits stays still.
        assert.match(css, /\.title\.scroll \{\s*animation: queueify-scroll-title/);
        assert.match(css, /\.artist\.scroll \{\s*animation: queueify-scroll-artist/);
    } finally {
        cleanup(dir);
    }
});

test('the soft edges only exist while a line is scrolling', async () => {
    const { store, dir } = freshStore();

    try {
        await store.saveTheme('fades', store.defaultModel());
        const css = fs.readFileSync(path.join(dir, 'fades', 'style.css'), 'utf8');

        // The mask hangs off the class app.js adds to a line that overflows,
        // so text that fits stays sharp to its edges.
        assert.match(css, /\.title-wrapper\.scrolling,\s*\.artist-wrapper\.scrolling \{/);
        assert.match(css, /mask-image: linear-gradient\(to right, transparent 0, #000 22px/);
        assert.match(css, /-webkit-mask-image:/, 'older CEF builds need the prefixed property');

        // Nothing is masked when it is not scrolling.
        assert.ok(!/\.title-wrapper \{[^}]*mask-image/s.test(css));
    } finally {
        cleanup(dir);
    }
});

/**
 * The fade used to be a colored strip laid over each end, which meant
 * guessing what was behind it. Over a gradient that guess is visibly wrong.
 * Masking the text itself is right over anything.
 */
test('the fade works the same over a flat color, a gradient, or no panel at all', async () => {
    const { store, dir } = freshStore();

    try {
        const variants = {
            flat: model => { model.canvas.background = '#101014'; },
            gradient: model => { model.canvas.backgroundMode = 'gradient'; },
            bare: model => { model.canvas.hidden = true; }
        };

        for (const [name, tweak] of Object.entries(variants)) {
            const model = store.defaultModel();
            tweak(model);
            await store.saveTheme(name, model);

            const css = fs.readFileSync(path.join(dir, name, 'style.css'), 'utf8');

            assert.match(css, /mask-image: linear-gradient/, `${name} should still fade`);
            // No colored overlay to disagree with the background.
            assert.ok(!css.includes('.title-wrapper::before'), `${name} should not paint over the panel`);
        }
    } finally {
        cleanup(dir);
    }
});
