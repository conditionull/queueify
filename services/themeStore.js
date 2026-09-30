const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

/**
 * Themes made in the visual editor.
 *
 * A theme is a folder of three files the widget runtime already understands -
 * index.html, style.css and properties.json - plus theme.json, which is the
 * editor's own model of the design. Nothing parses the generated CSS back:
 * theme.json is the source of truth, the other three are build output.
 *
 * A folder without theme.json is a hand-written theme (default, minimal,
 * swag). Those are left strictly alone - they are the fallbacks - so the editor
 * can read them for reference but never overwrite or delete them.
 */

const THEMES_DIR = process.env.QUEUEIFY_THEMES_DIR || path.join(__dirname, '..', 'widget', 'themes');

// 2 added the two time labels either side of the progress bar, and an outline
// on every piece of text. A model still saved as 1 predates both, so its time
// labels start hidden - an old theme must not suddenly grow two numbers.
//
// 3 added canvas blur and dim. Both fall back to 0, which is the same widget a
// version 2 theme already draws, so there is nothing to key on the saved
// version here - a theme written before they existed simply has neither.
//
// 4 added a drop shadow on every text module. Its distance falls back to 0 and
// nothing is emitted at 0, so the same applies - a version 3 theme generates
// the stylesheet it always did, byte for byte.
//
// 5 added Lucide icons. They live in their own list rather than in `modules`,
// because there can be any number of them and they can be deleted - neither
// of which is true of the six parts the widget runtime queries by name. A
// theme written before them simply has an empty list.
//
// 6 gave the progress bar a shape: the plain bar it has always been, or a
// waveform of lines at differing heights. The style falls back to 'bar', which
// generates exactly the rules a version 5 theme generated, so nothing keys on
// the saved version here.
//
// 7 let the canvas, the art and the progress bar round each corner on its
// own, the way Figma's independent corners do. `corners` falls back to null -
// one radius for all four, the only thing a version 6 theme could say - so the
// stylesheet it generates is the same byte for byte.
//
// 8 gave icons the drop shadow text already had. As with text, distance is the
// switch and falls back to 0, so an icon saved before it gets no filter and a
// version 7 theme generates the same stylesheet it always did.
//
// 9 added cards - plain shapes to put behind or between the parts, which is
// what a detached layout is built from - and a border on the album art. A
// theme written before them has no cards and a 0px art border, and nothing is
// emitted for either, so a version 8 theme generates the same stylesheet.
//
// 10 added what the premade themes are built from: labels (text of your own,
// which can say who requested the song), the Up next row, a squiggle-shaped
// progress bar with a gradient fill and a knob, a gradient ring, pixelation
// and a slow spin on the art, and gradient borders and a bevel on cards.
// Every one of them falls back to off - Up next arrives hidden, a theme with
// no labels has none - and nothing is emitted while they are off, so a
// version 9 theme generates the same page and stylesheet byte for byte.
// It also added a lock on every part and on the canvas. That is the editor's
// alone - it stops a drag, and the widget never reads it - and it falls back
// to unlocked, which is how every earlier theme behaved.
//
// And it let the parts be stacked in any order, the panel be drawn smaller
// than the canvas so parts can stick out over its edge, the album art be
// blurred, the song change with an animation, a viewer's song start with
// their reward (services/perks.js), and a quiet ambience drift across it. A
// theme saved before the animations has none - see transitionRules() - one
// saved before rewards plays none, and none has an ambience, so it changes
// songs the way it always did. A theme saved before
// either gets the order the widget always drew - see defaultStack() - and no
// inset, and nothing is emitted for either until they change, so it generates
// the same stylesheet byte for byte.
const MODEL_VERSION = 10;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

// The modules the widget runtime knows how to fill. They are always present in
// a generated theme - hiding one is a flag, not a deletion, so the elements
// app.js queries never go missing.
const MODULE_TYPES = ['art', 'title', 'artist', 'progress', 'elapsed', 'duration', 'next'];

// The two clocks either side of the bar: how far into the song you are, and
// how long it runs for. app.js writes the text; they are otherwise ordinary
// text modules, so they get the same fonts, colors and outline as the title.
const TIME_TYPES = ['elapsed', 'duration'];

// Everything that is text, and so takes the text settings below. The Up next
// row is text too - its chips are written in the font it is given.
const TEXT_TYPES = ['title', 'artist', ...TIME_TYPES, 'next'];

// How many queued songs the Up next row can show, and how many labels a theme
// can hold. Labels are the one place a theme carries free text, so it is kept
// short: it is a caption, not a paragraph.
const NEXT_LIMIT = 5;
const LABEL_LIMIT = 8;
const LABEL_LENGTH = 60;

/* ------------------------------------------------------------- icons */

/**
 * Lucide, read straight out of the installed package.
 *
 * Only the shapes inside <svg> are kept. The wrapper is written fresh by the
 * generator so the size, color and stroke width come from the theme rather
 * than from whatever the file happened to ship with - Lucide draws every icon
 * with `stroke="currentColor"`, which is exactly what lets a theme point one
 * at `var(--album-vibrant)` and have it re-tint with the artwork.
 *
 * ISC, with a subset inherited from Feather under MIT. Both notices ship in
 * node_modules/lucide-static/LICENSE, which is what either license asks for.
 */
const LUCIDE_DIR = process.env.QUEUEIFY_LUCIDE_DIR
    || path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');

// At most this many on one theme. A widget is 680x192; past a dozen the
// theme is not a widget any more, and the cap keeps a hand-written
// theme.json from asking the generator to inline a megabyte of paths.
const ICON_LIMIT = 12;

// Enough to give every part a card of its own, twice over.
const CARD_LIMIT = 8;

// Words a label can hold that are filled in while the song plays. Only one so
// far, and it is the one a Twitch bot can say that a music app cannot.
const LABEL_TOKENS = ['{requester}'];

// Lucide's own naming. It has to exclude "." and "/" before the name is put
// anywhere near a file path - see iconBody().
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

let iconNamesCache = null;
const iconBodyCache = new Map();

/** Every icon the installed Lucide offers, as a Set of names. */
function iconNames() {
    if (iconNamesCache) return iconNamesCache;

    try {
        iconNamesCache = new Set(
            fs.readdirSync(LUCIDE_DIR)
                .filter(file => file.endsWith('.svg'))
                .map(file => file.slice(0, -4))
                .filter(name => ICON_NAME.test(name))
        );
    } catch (err) {
        // No package installed: the feature switches itself off rather than
        // taking the whole theme store down with it.
        iconNamesCache = new Set();
    }

    return iconNamesCache;
}

/**
 * The drawing instructions for one icon, with Lucide's own <svg> wrapper
 * stripped off.
 *
 * The name is checked against the index first. That is the security boundary,
 * not the regex: theme.json can be imported from anyone, and this is the only
 * field whose value ends up as markup rather than as a CSS value. A name that
 * is not a real icon returns nothing and the icon is dropped, so the worst a
 * doctored file can do is ask for an icon that does not exist.
 */
function iconBody(name) {
    if (!iconNames().has(name)) return null;
    if (iconBodyCache.has(name)) return iconBodyCache.get(name);

    let body = null;
    try {
        const file = fs.readFileSync(path.join(LUCIDE_DIR, name + '.svg'), 'utf8');
        const open = file.indexOf('>', file.indexOf('<svg'));
        const close = file.lastIndexOf('</svg>');

        if (open !== -1 && close > open) {
            body = file.slice(open + 1, close).replace(/\s+/g, ' ').trim();
        }
    } catch (err) {
        body = null;
    }

    iconBodyCache.set(name, body);
    return body;
}

/** The names and keywords the editor's picker searches over. */
function iconCatalog() {
    let tags = {};
    try {
        tags = require(path.join(LUCIDE_DIR, '..', 'tags.json'));
    } catch (err) {
        tags = {};
    }

    return [...iconNames()].sort().map(name => ({ name, tags: tags[name] || [] }));
}

const CANVAS_LIMITS = { width: [120, 1920], height: [30, 1080] };

// The song-change animations a theme can pick from. See transitionRules().
const TRANSITIONS = ['none', 'slide', 'fade', 'flip', 'pop', 'wipe'];

// A theme's ambience, and the colors it can be in: the same names as
// widget/public/effects.js and services/perks.js.
const AMBIENCES = ['none', 'embers', 'snow', 'petals', 'bokeh', 'fireflies', 'motes', 'fog', 'twinkle'];
const AMBIENCE_COLORS = ['album', 'rainbow', 'gold', 'silver', 'ice', 'fire', 'candy', 'neon', 'sunset'];

const ALBUM_COLORS = new Set([
    'var(--album-vibrant)',
    'var(--album-dark)',
    'var(--album-light)',
    'var(--album-muted)',
    'transparent'
]);

// Fonts the editor offers. Weights are the ones each family actually ships
// (checked against the Google Fonts API), so the editor never offers a weight
// the browser would have to fake.
//
// "Local" fonts need nothing downloaded. The rest are pulled from Google Fonts by
// the generated theme, which is the same network the widget already uses for
// album art and Canvas videos - with a real fallback stack if it is unreachable.
const FONTS = {
    'system': { label: 'System UI', category: 'Local', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'mono': { label: 'System mono', category: 'Local', stack: 'ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700, 800, 900] },
    'serif': { label: 'System serif', category: 'Local', stack: 'Georgia, "Times New Roman", serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'rounded': { label: 'System rounded', category: 'Local', stack: '"Segoe UI Rounded", "SF Pro Rounded", system-ui, sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'condensed': { label: 'System condensed', category: 'Local', stack: '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'bebas-neue': { label: 'Bebas Neue', category: 'Display', family: 'Bebas Neue', google: true, stack: '"Bebas Neue", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'anton': { label: 'Anton', category: 'Display', family: 'Anton', google: true, stack: '"Anton", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'archivo-black': { label: 'Archivo Black', category: 'Display', family: 'Archivo Black', google: true, stack: '"Archivo Black", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'righteous': { label: 'Righteous', category: 'Display', family: 'Righteous', google: true, stack: '"Righteous", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'bungee': { label: 'Bungee', category: 'Display', family: 'Bungee', google: true, stack: '"Bungee", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'russo-one': { label: 'Russo One', category: 'Display', family: 'Russo One', google: true, stack: '"Russo One", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'teko': { label: 'Teko', category: 'Display', family: 'Teko', google: true, stack: '"Teko", Impact, "Arial Narrow Bold", sans-serif', weights: [300, 400, 500, 600, 700] },
    'oswald': { label: 'Oswald', category: 'Display', family: 'Oswald', google: true, stack: '"Oswald", Impact, "Arial Narrow Bold", sans-serif', weights: [300, 400, 500, 600, 700] },
    'staatliches': { label: 'Staatliches', category: 'Display', family: 'Staatliches', google: true, stack: '"Staatliches", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'titan-one': { label: 'Titan One', category: 'Display', family: 'Titan One', google: true, stack: '"Titan One", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'monoton': { label: 'Monoton', category: 'Display', family: 'Monoton', google: true, stack: '"Monoton", Impact, "Arial Narrow Bold", sans-serif', weights: [400] },
    'unbounded': { label: 'Unbounded', category: 'Display', family: 'Unbounded', google: true, stack: '"Unbounded", "Arial Black", system-ui, sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'syne': { label: 'Syne', category: 'Display', family: 'Syne', google: true, stack: '"Syne", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [400, 500, 600, 700, 800] },
    'orbitron': { label: 'Orbitron', category: 'Techno', family: 'Orbitron', google: true, stack: '"Orbitron", "Segoe UI", system-ui, sans-serif', weights: [400, 500, 600, 700, 800, 900] },
    'audiowide': { label: 'Audiowide', category: 'Techno', family: 'Audiowide', google: true, stack: '"Audiowide", "Segoe UI", system-ui, sans-serif', weights: [400] },
    'chakra-petch': { label: 'Chakra Petch', category: 'Techno', family: 'Chakra Petch', google: true, stack: '"Chakra Petch", "Segoe UI", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
    'rajdhani': { label: 'Rajdhani', category: 'Techno', family: 'Rajdhani', google: true, stack: '"Rajdhani", "Segoe UI", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
    'michroma': { label: 'Michroma', category: 'Techno', family: 'Michroma', google: true, stack: '"Michroma", "Segoe UI", system-ui, sans-serif', weights: [400] },
    'inter': { label: 'Inter', category: 'Sans', family: 'Inter', google: true, stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'poppins': { label: 'Poppins', category: 'Sans', family: 'Poppins', google: true, stack: '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'montserrat': { label: 'Montserrat', category: 'Sans', family: 'Montserrat', google: true, stack: '"Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'nunito': { label: 'Nunito', category: 'Sans', family: 'Nunito', google: true, stack: '"Nunito", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'quicksand': { label: 'Quicksand', category: 'Sans', family: 'Quicksand', google: true, stack: '"Quicksand", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700] },
    'work-sans': { label: 'Work Sans', category: 'Sans', family: 'Work Sans', google: true, stack: '"Work Sans", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'manrope': { label: 'Manrope', category: 'Sans', family: 'Manrope', google: true, stack: '"Manrope", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800] },
    'outfit': { label: 'Outfit', category: 'Sans', family: 'Outfit', google: true, stack: '"Outfit", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'sora': { label: 'Sora', category: 'Sans', family: 'Sora', google: true, stack: '"Sora", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800] },
    'space-grotesk': { label: 'Space Grotesk', category: 'Sans', family: 'Space Grotesk', google: true, stack: '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700] },
    'figtree': { label: 'Figtree', category: 'Sans', family: 'Figtree', google: true, stack: '"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'plus-jakarta-sans': { label: 'Plus Jakarta Sans', category: 'Sans', family: 'Plus Jakarta Sans', google: true, stack: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800] },
    'geist': { label: 'Geist', category: 'Sans', family: 'Geist', google: true, stack: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'instrument-sans': { label: 'Instrument Sans', category: 'Sans', family: 'Instrument Sans', google: true, stack: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [400, 500, 600, 700] },
    'dm-sans': { label: 'DM Sans', category: 'Sans', family: 'DM Sans', google: true, stack: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'bricolage-grotesque': { label: 'Bricolage Grotesque', category: 'Sans', family: 'Bricolage Grotesque', google: true, stack: '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif', weights: [300, 400, 500, 600, 700, 800] },
    'playfair-display': { label: 'Playfair Display', category: 'Serif', family: 'Playfair Display', google: true, stack: '"Playfair Display", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700, 800, 900] },
    'lora': { label: 'Lora', category: 'Serif', family: 'Lora', google: true, stack: '"Lora", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700] },
    'bitter': { label: 'Bitter', category: 'Serif', family: 'Bitter', google: true, stack: '"Bitter", Georgia, "Times New Roman", serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'fraunces': { label: 'Fraunces', category: 'Serif', family: 'Fraunces', google: true, stack: '"Fraunces", Georgia, "Times New Roman", serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'bodoni-moda': { label: 'Bodoni Moda', category: 'Serif', family: 'Bodoni Moda', google: true, stack: '"Bodoni Moda", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700, 800, 900] },
    'instrument-serif': { label: 'Instrument Serif', category: 'Serif', family: 'Instrument Serif', google: true, stack: '"Instrument Serif", Georgia, "Times New Roman", serif', weights: [400] },
    'dm-serif-display': { label: 'DM Serif Display', category: 'Serif', family: 'DM Serif Display', google: true, stack: '"DM Serif Display", Georgia, "Times New Roman", serif', weights: [400] },
    'young-serif': { label: 'Young Serif', category: 'Serif', family: 'Young Serif', google: true, stack: '"Young Serif", Georgia, "Times New Roman", serif', weights: [400] },
    'jetbrains-mono': { label: 'JetBrains Mono', category: 'Mono', family: 'JetBrains Mono', google: true, stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700, 800] },
    'space-mono': { label: 'Space Mono', category: 'Mono', family: 'Space Mono', google: true, stack: '"Space Mono", ui-monospace, Menlo, Consolas, monospace', weights: [400, 700] },
    'ibm-plex-mono': { label: 'IBM Plex Mono', category: 'Mono', family: 'IBM Plex Mono', google: true, stack: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700] },
    'share-tech-mono': { label: 'Share Tech Mono', category: 'Mono', family: 'Share Tech Mono', google: true, stack: '"Share Tech Mono", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'geist-mono': { label: 'Geist Mono', category: 'Mono', family: 'Geist Mono', google: true, stack: '"Geist Mono", ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700, 800, 900] },
    'vt323': { label: 'VT323', category: 'Mono', family: 'VT323', google: true, stack: '"VT323", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'press-start-2p': { label: 'Press Start 2P', category: 'Mono', family: 'Press Start 2P', google: true, stack: '"Press Start 2P", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'pacifico': { label: 'Pacifico', category: 'Hand', family: 'Pacifico', google: true, stack: '"Pacifico", "Segoe Script", cursive', weights: [400] },
    'lobster': { label: 'Lobster', category: 'Hand', family: 'Lobster', google: true, stack: '"Lobster", "Segoe Script", cursive', weights: [400] },
    'caveat': { label: 'Caveat', category: 'Hand', family: 'Caveat', google: true, stack: '"Caveat", "Segoe Script", cursive', weights: [400, 500, 600, 700] },
    'permanent-marker': { label: 'Permanent Marker', category: 'Hand', family: 'Permanent Marker', google: true, stack: '"Permanent Marker", "Segoe Script", cursive', weights: [400] },
    'shadows-into-light': { label: 'Shadows Into Light', category: 'Hand', family: 'Shadows Into Light', google: true, stack: '"Shadows Into Light", "Segoe Script", cursive', weights: [400] },
    'satisfy': { label: 'Satisfy', category: 'Hand', family: 'Satisfy', google: true, stack: '"Satisfy", "Segoe Script", cursive', weights: [400] },
    'press-start-2p': { label: 'Press Start 2P', category: 'Pixel', family: 'Press Start 2P', google: true, stack: '"Press Start 2P", "Courier New", monospace', weights: [400] },
    'vt323': { label: 'VT323', category: 'Pixel', family: 'VT323', google: true, stack: '"VT323", "Courier New", monospace', weights: [400] },
    'silkscreen': { label: 'Silkscreen', category: 'Pixel', family: 'Silkscreen', google: true, stack: '"Silkscreen", "Courier New", monospace', weights: [400, 700] },
    'pixelify-sans': { label: 'Pixelify Sans', category: 'Pixel', family: 'Pixelify Sans', google: true, stack: '"Pixelify Sans", "Courier New", monospace', weights: [400, 500, 600, 700] },
    // Lights on a grid, like a phone's glyph display. Doto has every weight, from
    // single pin-pricks at 100 to solid dots at 900.
    'doto': { label: 'Doto', category: 'Dot', family: 'Doto', google: true, stack: '"Doto", "Courier New", monospace', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
    'dotgothic16': { label: 'DotGothic16', category: 'Dot', family: 'DotGothic16', google: true, stack: '"DotGothic16", "Courier New", monospace', weights: [400] },
};

const FONT_CATEGORIES = {
    'Local': 'On your computer',
    'Display': 'Display',
    'Techno': 'Techno',
    'Sans': 'Sans serif',
    'Serif': 'Serif',
    'Mono': 'Monospace',
    'Pixel': 'Pixel & arcade',
    'Dot': 'Dot matrix',
    'Hand': 'Handwriting'
};

class ThemeError extends Error {
    constructor(message, code = 'invalid_theme') {
        super(message);
        this.code = code;
    }
}

/* ------------------------------------------------------------------ paths */

function assertName(name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
        throw new ThemeError(
            'Theme names use lowercase letters, numbers and dashes, and start with a letter or number.',
            'invalid_name'
        );
    }
    return name;
}

function themeDir(name) {
    return path.join(THEMES_DIR, assertName(name));
}

/* ------------------------------------------------- value sanitizing */

/** A color the generated CSS is allowed to contain, and nothing else. */
function color(value, fallback) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (ALBUM_COLORS.has(trimmed)) return trimmed;
        if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
        if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(trimmed)) return trimmed;
    }
    return fallback;
}

function number(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

/**
 * Four radii, clockwise from the top left as CSS reads them, or null for "all
 * the same as `radius`".
 *
 * Null rather than four copies of the radius, so there is only ever one
 * number saying how round a uniform shape is. Anything that is not four
 * usable numbers is treated as no opinion rather than half-trusted.
 */
function corners(value, max) {
    if (!Array.isArray(value) || value.length !== 4) return null;

    const parsed = value.map(corner => Number(corner));
    if (!parsed.every(Number.isFinite)) return null;

    return parsed.map(corner => Math.round(Math.min(Math.max(corner, 0), max)));
}

/** The `border-radius` value for anything with a radius and optional corners. */
function radiusCss(part) {
    return part.corners
        ? part.corners.map(corner => corner + 'px').join(' ')
        : part.radius + 'px';
}

function pick(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function fontKey(value) {
    return FONTS[value] ? value : 'system';
}

/** The nearest weight the chosen family actually ships, so nothing is faked. */
function fontWeight(value, fontName, fallback) {
    const weights = FONTS[fontName].weights;
    const wanted = Number(value);

    if (weights.includes(wanted)) return wanted;

    const from = weights.includes(fallback) ? fallback : weights[0];
    if (!Number.isFinite(wanted)) return from;

    return weights.reduce((best, weight) =>
        Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best, weights[0]);
}

/** The families a design needs, with only the weights it uses. */
function googleFonts(model) {
    const used = new Map();

    const texts = [...model.modules.filter(module => TEXT_TYPES.includes(module.type)), ...(model.labels || [])];

    for (const module of texts) {
        if (module.hidden) continue;

        const font = FONTS[module.font];
        if (!font || !font.google) continue;

        if (!used.has(font.family)) used.set(font.family, new Set());
        used.get(font.family).add(module.fontWeight);
    }

    return [...used.entries()].map(([family, weights]) => ({
        family,
        weights: [...weights].sort((a, b) => a - b)
    }));
}

function googleFontsHref(fonts) {
    if (!fonts.length) return null;

    const families = fonts.map(font =>
        'family=' + encodeURIComponent(font.family).replace(/%20/g, '+') + ':wght@' + font.weights.join(';')
    );

    return 'https://fonts.googleapis.com/css2?' + families.join('&') + '&display=swap';
}

/* ------------------------------------------------------------- the model */

function defaultModule(type) {
    switch (type) {
        case 'art':
            return {
                type, hidden: false, x: 16, y: 16, w: 160, h: 160, radius: 24, corners: null, shadow: 18, fit: 'cover',
                borderWidth: 0, borderColor: 'rgba(255,255,255,0.35)',
                borderMode: 'solid', borderTo: 'var(--album-vibrant)',
                pixelate: 0, spin: 0, blur: 0
            };
        case 'title':
            return {
                type, hidden: false, x: 200, y: 46, w: 456, h: 36,
                font: 'system', fontSize: 26, fontWeight: 700, color: '#ffffff',
                letterSpacing: 0, align: 'left', opacity: 1,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000',
                shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
            };
        case 'artist':
            return {
                type, hidden: false, x: 200, y: 88, w: 456, h: 26,
                font: 'system', fontSize: 17, fontWeight: 500, color: 'var(--album-light)',
                letterSpacing: 0, align: 'left', opacity: 0.85,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000',
                shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
            };
        case 'progress':
            return {
                type, hidden: false, x: 246, y: 132, w: 364, h: 6,
                radius: 999, corners: null, trackColor: 'rgba(255,255,255,0.18)', fillColor: 'var(--album-vibrant)',
                // A plain bar, as it always was. The waveform is something you
                // go and choose, and it wants a taller box than 6px.
                style: 'bar', bars: 48, barGap: 2, seed: 1,
                fillMode: 'solid', fillTo: 'var(--album-light)',
                // The squiggle: how long one wave is, and how thick its line.
                waveLength: 22, lineWidth: 3,
                // A dot at the playhead. 0 is none.
                knob: 0, knobColor: '#ffffff', knobShape: 'circle'
            };
        // The clocks sit level with the middle of the bar rather than under
        // it: 0:04 [========] 3:07 is the shape people already know.
        case 'elapsed':
            return {
                type, hidden: false, x: 200, y: 124, w: 40, h: 22,
                font: 'system', fontSize: 12, fontWeight: 600, color: 'var(--album-light)',
                letterSpacing: 0, align: 'right', opacity: 0.75,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000',
                shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
            };
        case 'duration':
            return {
                type, hidden: false, x: 616, y: 124, w: 40, h: 22,
                font: 'system', fontSize: 12, fontWeight: 600, color: 'var(--album-light)',
                letterSpacing: 0, align: 'left', opacity: 0.75,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000',
                shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
            };
        // Optional, so it starts hidden: a new theme does not suddenly grow a
        // row, and neither does one saved before it existed. Shown, it still
        // only appears while something is queued - see app.js.
        case 'next':
            return {
                type, hidden: true, x: 200, y: 150, w: 456, h: 28,
                font: 'system', fontSize: 13, fontWeight: 600, color: '#ffffff',
                letterSpacing: 0, align: 'left', opacity: 1,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000',
                shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)',
                label: 'Up next', labelColor: 'var(--album-light)',
                count: 2, thumbs: true, requester: false,
                // Everything queued in Spotify, or only what chat requested.
                source: 'queue',
                chipColor: 'rgba(255,255,255,0.12)', chipRadius: 14
            };
        default:
            throw new ThemeError(`Unknown module type "${type}"`);
    }
}

function defaultModel(label = 'New theme') {
    return {
        version: MODEL_VERSION,
        label,
        canvas: {
            width: 680,
            height: 192,
            hidden: false,
            background: 'var(--album-dark)',
            backgroundMode: 'solid',
            backgroundTo: 'var(--album-vibrant)',
            gradientAngle: 135,
            radius: 32,
            // Null is one radius for all four corners. See corners().
            corners: null,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            padding: 0,
            // Off by default: a new theme looks exactly as it always did, and
            // these are something you reach for once there is a Canvas video
            // or a full-bleed cover behind the text.
            blur: 0,
            dim: 0
        },
        modules: MODULE_TYPES.map(defaultModule),
        // Nothing by default: a new theme is the widget it always was, and an
        // icon is something you go and add.
        icons: [],
        cards: [],
        labels: [],
        properties: {
            media: { mode: 'canvas' },
            showProgress: true,
            updateInterval: 5000,
            hideAfter: 5,
            scroll: { enabled: true, speed: 70, pauseDuration: 7 },
            // A new theme starts with one. An old one without the setting
            // gets none - normalizeModel keys that on the setting, not on this.
            transition: 'slide',
            // The same: new themes play perks, older ones stay as they were.
            perks: true,
            milestone: { enabled: true, seconds: 4 },
            ambience: { style: 'none', amount: 1, speed: 1, colors: 'album' }
        }
    };
}

/** The settings a freshly added icon starts with. */
function defaultIcon(name) {
    return {
        id: '', name, x: 24, y: 24, w: 32, h: 32,
        color: 'var(--album-light)', strokeWidth: 2, rotate: 0, opacity: 1, hidden: false,
        shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
    };
}

/**
 * The icon list, cleaned up.
 *
 * Unlike the six fixed parts, these are free-form: any number, any order, and
 * an id the generated CSS builds a class name from. So the id is regenerated
 * here from its position rather than trusted - a stored id is the one thing
 * that would otherwise let a doctored theme.json choose a CSS selector.
 *
 * An icon whose name is not in the installed Lucide is dropped rather than
 * replaced with something else. Silently swapping in a different picture is
 * worse than the icon not being there.
 */
function normalizeIcons(raw, canvas) {
    if (!Array.isArray(raw)) return [];

    const icons = [];

    for (const item of raw) {
        if (icons.length >= ICON_LIMIT) break;
        if (!item || typeof item !== 'object') continue;

        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!ICON_NAME.test(name) || !iconNames().has(name)) continue;

        const fallback = defaultIcon(name);

        icons.push({
            id: 'i' + icons.length,
            name,
            hidden: Boolean(item.hidden),
            locked: Boolean(item.locked),
            // Settled across every part once they are all read - see stackParts().
            z: Number(item.z),
            x: Math.round(number(item.x, fallback.x, -canvas.width, canvas.width * 2)),
            y: Math.round(number(item.y, fallback.y, -canvas.height, canvas.height * 2)),
            w: Math.round(number(item.w, fallback.w, 4, canvas.width * 2)),
            h: Math.round(number(item.h, fallback.h, 4, canvas.height * 2)),
            color: color(item.color, fallback.color),
            // Lucide draws at stroke-width 2 in a 24 unit box. Scaling the icon
            // scales the stroke with it, so this is the weight before that -
            // which is why a big icon at 1 still looks finer than a small one
            // at 3.
            strokeWidth: Math.round(number(item.strokeWidth, fallback.strokeWidth, 0.5, 4) * 10) / 10,
            rotate: Math.round(number(item.rotate, fallback.rotate, 0, 360)),
            opacity: number(item.opacity, fallback.opacity, 0, 1),
            // The same four as a text module's shadow, read the same way.
            shadow: Math.round(number(item.shadow, fallback.shadow, 0, 40)),
            shadowAngle: Math.round(number(item.shadowAngle, fallback.shadowAngle, 0, 360)),
            shadowBlur: Math.round(number(item.shadowBlur, fallback.shadowBlur, 0, 40)),
            shadowColor: color(item.shadowColor, fallback.shadowColor)
        });
    }

    return icons;
}

/** The settings a freshly added card starts with. */
function defaultCard() {
    return {
        id: '', hidden: false, x: 16, y: 16, w: 160, h: 64,
        layer: 'back',
        background: 'var(--album-dark)', backgroundMode: 'solid',
        backgroundTo: 'var(--album-vibrant)', gradientAngle: 135,
        fillOpacity: 0.85,
        radius: 16, corners: null,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
        shadow: 0, blur: 0,
        borderMode: 'solid', borderTo: 'var(--album-vibrant)',
        bevel: 0
    };
}

/**
 * The card list, cleaned up.
 *
 * A card is a shape and nothing else: a background, a border and a shadow in a
 * box. That is all a detached layout needs - the art, the text and the bar each
 * get a card of their own and the canvas is hidden, so the widget reads as
 * separate tiles floating over the scene.
 *
 * As with icons, the id is positional rather than trusted, because the
 * generated CSS builds a class name from it.
 */
function normalizeCards(raw, canvas) {
    if (!Array.isArray(raw)) return [];

    const cards = [];

    for (const item of raw) {
        if (cards.length >= CARD_LIMIT) break;
        if (!item || typeof item !== 'object') continue;

        const fallback = defaultCard();

        cards.push({
            id: 'c' + cards.length,
            hidden: Boolean(item.hidden),
            locked: Boolean(item.locked),
            z: Number(item.z),
            x: Math.round(number(item.x, fallback.x, -canvas.width, canvas.width * 2)),
            y: Math.round(number(item.y, fallback.y, -canvas.height, canvas.height * 2)),
            w: Math.round(number(item.w, fallback.w, 4, canvas.width * 2)),
            h: Math.round(number(item.h, fallback.h, 4, canvas.height * 2)),
            // Behind the art, or over it and under the text. See cardRules().
            layer: pick(item.layer, ['back', 'front'], fallback.layer),
            background: color(item.background, fallback.background),
            backgroundMode: pick(item.backgroundMode, ['solid', 'gradient'], fallback.backgroundMode),
            backgroundTo: color(item.backgroundTo, fallback.backgroundTo),
            gradientAngle: Math.round(number(item.gradientAngle, fallback.gradientAngle, 0, 360)),
            // Two decimals, for the same reason as the canvas dim.
            fillOpacity: Math.round(number(item.fillOpacity, fallback.fillOpacity, 0, 1) * 100) / 100,
            radius: Math.round(number(item.radius, fallback.radius, 0, 400)),
            corners: corners(item.corners, 400),
            borderWidth: Math.round(number(item.borderWidth, fallback.borderWidth, 0, 12)),
            borderColor: color(item.borderColor, fallback.borderColor),
            shadow: Math.round(number(item.shadow, fallback.shadow, 0, 80)),
            blur: Math.round(number(item.blur, fallback.blur, 0, 40)),
            borderMode: pick(item.borderMode, ['solid', 'gradient'], fallback.borderMode),
            borderTo: color(item.borderTo, fallback.borderTo),
            // A raised edge - light along the top and left, shade along the
            // bottom and right - for buttons that look pressable.
            bevel: Math.round(number(item.bevel, fallback.bevel, 0, 8))
        });
    }

    return cards;
}

/**
 * The settings every piece of text shares - the fixed text parts, the Up next
 * row and labels alike.
 */
function textSettings(module, fallback) {
    const font = fontKey(module.font);

    return {
        font,
        fontSize: Math.round(number(module.fontSize, fallback.fontSize, 6, 200)),
        fontWeight: fontWeight(module.fontWeight, font, fallback.fontWeight),
        color: color(module.color, fallback.color),
        letterSpacing: number(module.letterSpacing, fallback.letterSpacing, -5, 20),
        align: pick(module.align, ['left', 'center', 'right'], fallback.align),
        opacity: number(module.opacity, fallback.opacity, 0, 1),
        uppercase: Boolean(module.uppercase),
        italic: Boolean(module.italic),
        glow: Math.round(number(module.glow, fallback.glow, 0, 40)),
        glowColor: color(module.glowColor, fallback.glowColor),
        // An outline is what keeps white text readable over a bright
        // game. Half of it is painted outside the glyph, so the width the
        // user picks is doubled when the CSS is written.
        outline: number(module.outline, fallback.outline, 0, 12),
        outlineColor: color(module.outlineColor, fallback.outlineColor),
        // How far the shadow is thrown, and which way. Distance is the
        // switch: at 0 there is nothing to cast, so the other three are
        // kept but never reach the CSS. That is also what makes this
        // invisible to a theme saved before it existed.
        shadow: Math.round(number(module.shadow, fallback.shadow, 0, 40)),
        // Degrees, read the same way as the canvas gradient angle - 0 is
        // up, 90 is right - because that is the one angle convention the
        // editor already taught its user.
        shadowAngle: Math.round(number(module.shadowAngle, fallback.shadowAngle, 0, 360)),
        shadowBlur: Math.round(number(module.shadowBlur, fallback.shadowBlur, 0, 40)),
        shadowColor: color(module.shadowColor, fallback.shadowColor)
    };
}

/**
 * Free text from a theme file, made safe to keep: one line, no control
 * characters, and short. It is escaped again wherever it is written into a
 * page - this only decides what is worth storing.
 */
function plainText(value, fallback, max) {
    if (typeof value !== 'string') return fallback;
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The settings a freshly added label starts with. */
function defaultLabel(text = 'Your text') {
    return {
        id: '', text, hidden: false, x: 24, y: 24, w: 160, h: 24,
        font: 'system', fontSize: 14, fontWeight: 600, color: '#ffffff',
        letterSpacing: 0, align: 'left', opacity: 0.9,
        uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
        outline: 0, outlineColor: '#000000',
        shadow: 0, shadowAngle: 135, shadowBlur: 0, shadowColor: 'rgba(0,0,0,0.55)'
    };
}

/**
 * The label list, cleaned up.
 *
 * A label is a line of text of your own - "Now playing", "Live on stream",
 * or "Requested by {requester}", which the widget fills in. The text is the
 * only thing in a label that is not a number or a checked color, so it is
 * trimmed to one short line here and escaped when the page is written. The id
 * is positional, as with icons and cards, because it becomes a class name.
 */
function normalizeLabels(raw, canvas) {
    if (!Array.isArray(raw)) return [];

    const labels = [];

    for (const item of raw) {
        if (labels.length >= LABEL_LIMIT) break;
        if (!item || typeof item !== 'object') continue;

        const fallback = defaultLabel();

        labels.push({
            id: 'l' + labels.length,
            // Kept even when empty: a label mid-edit is still a label, and
            // dropping it on save would lose where it was and how it looked.
            text: plainText(item.text, '', LABEL_LENGTH),
            hidden: Boolean(item.hidden),
            locked: Boolean(item.locked),
            z: Number(item.z),
            x: Math.round(number(item.x, fallback.x, -canvas.width, canvas.width * 2)),
            y: Math.round(number(item.y, fallback.y, -canvas.height, canvas.height * 2)),
            w: Math.round(number(item.w, fallback.w, 4, canvas.width * 2)),
            h: Math.round(number(item.h, fallback.h, 2, canvas.height * 2)),
            ...textSettings(item, fallback)
        });
    }

    return labels;
}

/**
 * Normalizes whatever the editor sent into a model the generator can trust:
 * every value clamped, every color checked, every mandatory module present.
 */
function normalizeModel(input, { label } = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const base = defaultModel(label || raw.label || 'New theme');

    const canvasIn = raw.canvas || {};
    const canvas = {
        width: Math.round(number(canvasIn.width, base.canvas.width, ...CANVAS_LIMITS.width)),
        height: Math.round(number(canvasIn.height, base.canvas.height, ...CANVAS_LIMITS.height)),
        // Hiding the panel keeps its colors, so turning it back on restores
        // the design rather than a blank default.
        hidden: Boolean(canvasIn.hidden),
        locked: Boolean(canvasIn.locked),
        background: color(canvasIn.background, base.canvas.background),
        backgroundMode: pick(canvasIn.backgroundMode, ['solid', 'gradient'], base.canvas.backgroundMode),
        backgroundTo: color(canvasIn.backgroundTo, base.canvas.backgroundTo),
        gradientAngle: Math.round(number(canvasIn.gradientAngle, base.canvas.gradientAngle, 0, 360)),
        radius: Math.round(number(canvasIn.radius, base.canvas.radius, 0, 400)),
        corners: corners(canvasIn.corners, 400),
        borderWidth: Math.round(number(canvasIn.borderWidth, base.canvas.borderWidth, 0, 12)),
        borderColor: color(canvasIn.borderColor, base.canvas.borderColor),
        padding: Math.round(number(canvasIn.padding, base.canvas.padding, 0, 200)),
        // How hard the panel's own contents - its background, and the album
        // art or Canvas video - are blurred and darkened before the text is
        // drawn over them. Nothing outside the widget is touched; see
        // veilRules() for why that is not a choice.
        blur: Math.round(number(canvasIn.blur, base.canvas.blur, 0, 40)),
        // Two decimals, because the generator turns this into a brightness
        // multiplier and 1 - 0.3333333 is not something to put in a stylesheet.
        dim: Math.round(number(canvasIn.dim, base.canvas.dim, 0, 1) * 100) / 100
    };

    // How far the panel is drawn in from each edge of the canvas, top, right,
    // bottom, left - the order CSS reads them in. See panelRules().
    const insetIn = Array.isArray(canvasIn.inset) ? canvasIn.inset : [];
    canvas.inset = [canvas.height, canvas.width, canvas.height, canvas.width]
        .map((across, side) => Math.round(number(insetIn[side], 0, 0, across)));

    const byType = new Map();
    for (const module of Array.isArray(raw.modules) ? raw.modules : []) {
        if (module && MODULE_TYPES.includes(module.type) && !byType.has(module.type)) {
            byType.set(module.type, module);
        }
    }

    // A theme saved before the time labels existed has no opinion about them,
    // and quietly adding two numbers to somebody's finished design would be a
    // change they never asked for. So they arrive hidden, ready to be turned
    // on, and only for models that predate them.
    const savedVersion = Number(raw.version);
    const predatesTimes = Number.isFinite(savedVersion) && savedVersion < 2;

    const modules = MODULE_TYPES.map(type => {
        const fallback = defaultModule(type);
        const module = byType.get(type) || {};
        const missing = !byType.has(type);

        // A theme saved before Up next existed gets it along the bottom of its
        // own canvas, where switching it on shows it somewhere sensible - the
        // default box is sized for the 680px default and would hang off the
        // side of anything narrower.
        if (missing && type === 'next') {
            Object.assign(fallback, {
                x: 16,
                y: Math.max(0, canvas.height - fallback.h - 10),
                w: Math.max(4, canvas.width - 32)
            });
        }

        const common = {
            type,
            // A part the theme never mentioned takes its default, which for
            // the time labels on a very old theme is hidden - and for Up next
            // is hidden on every theme, because it is something you switch on.
            hidden: missing
                ? fallback.hidden || (predatesTimes && TIME_TYPES.includes(type))
                : Boolean(module.hidden),
            locked: Boolean(module.locked),
            z: Number(module.z),
            x: Math.round(number(module.x, fallback.x, -canvas.width, canvas.width * 2)),
            y: Math.round(number(module.y, fallback.y, -canvas.height, canvas.height * 2)),
            w: Math.round(number(module.w, fallback.w, 4, canvas.width * 2)),
            h: Math.round(number(module.h, fallback.h, 2, canvas.height * 2))
        };

        if (type === 'art') {
            return {
                ...common,
                radius: Math.round(number(module.radius, fallback.radius, 0, 400)),
                corners: corners(module.corners, 400),
                shadow: Math.round(number(module.shadow, fallback.shadow, 0, 80)),
                fit: pick(module.fit, ['cover', 'contain'], fallback.fit),
                borderWidth: Math.round(number(module.borderWidth, fallback.borderWidth, 0, 12)),
                borderColor: color(module.borderColor, fallback.borderColor),
                // A gradient ring runs from the border color to this one.
                borderMode: pick(module.borderMode, ['solid', 'gradient'], fallback.borderMode),
                borderTo: color(module.borderTo, fallback.borderTo),
                // The size of a pixel block. 0 leaves the art alone.
                pixelate: Math.round(number(module.pixelate, fallback.pixelate, 0, 32)),
                // Seconds per turn, like a record. 0 keeps it still.
                spin: Math.round(number(module.spin, fallback.spin, 0, 60)),
                // How far the art or Canvas video is blurred. See artBlurRules().
                blur: Math.round(number(module.blur, fallback.blur, 0, 40))
            };
        }

        if (type === 'progress') {
            return {
                ...common,
                radius: Math.round(number(module.radius, fallback.radius, 0, 999)),
                corners: corners(module.corners, 999),
                trackColor: color(module.trackColor, fallback.trackColor),
                fillColor: color(module.fillColor, fallback.fillColor),
                style: pick(module.style, ['bar', 'waveform', 'squiggle'], fallback.style),
                // Enough bars to read as a waveform, few enough that the
                // generator is not writing hundreds of nth-child rules.
                bars: Math.round(number(module.bars, fallback.bars, 8, 96)),
                barGap: Math.round(number(module.barGap, fallback.barGap, 0, 12)),
                // The shape of the waveform, not the waveform itself. Heights
                // are worked out from this every time the theme is generated -
                // storing them instead would be storing a derived value, and
                // one that changes length the moment the bar count does.
                seed: Math.round(number(module.seed, fallback.seed, 1, 9999)),
                fillMode: pick(module.fillMode, ['solid', 'gradient'], fallback.fillMode),
                fillTo: color(module.fillTo, fallback.fillTo),
                waveLength: Math.round(number(module.waveLength, fallback.waveLength, 8, 80)),
                lineWidth: Math.round(number(module.lineWidth, fallback.lineWidth, 1, 12)),
                knob: Math.round(number(module.knob, fallback.knob, 0, 40)),
                knobColor: color(module.knobColor, fallback.knobColor),
                knobShape: pick(module.knobShape, ['circle', 'square'], fallback.knobShape)
            };
        }

        if (type === 'next') {
            return {
                ...common,
                ...textSettings(module, fallback),
                // What the row says before the songs. Empty is allowed: the
                // chips can stand on their own.
                label: plainText(module.label, fallback.label, 24),
                labelColor: color(module.labelColor, fallback.labelColor),
                count: Math.round(number(module.count, fallback.count, 1, NEXT_LIMIT)),
                thumbs: module.thumbs === undefined ? fallback.thumbs : Boolean(module.thumbs),
                requester: Boolean(module.requester),
                source: pick(module.source, ['queue', 'requests'], fallback.source),
                chipColor: color(module.chipColor, fallback.chipColor),
                chipRadius: Math.round(number(module.chipRadius, fallback.chipRadius, 0, 40))
            };
        }

        return { ...common, ...textSettings(module, fallback) };
    });

    const propsIn = raw.properties || {};
    const scrollIn = propsIn.scroll || {};
    const milestoneIn = propsIn.milestone && typeof propsIn.milestone === 'object' ? propsIn.milestone : {};
    const ambienceIn = propsIn.ambience && typeof propsIn.ambience === 'object' ? propsIn.ambience : {};

    const properties = {
        media: { mode: pick(propsIn.media?.mode, ['canvas', 'cover'], 'canvas') },
        showProgress: propsIn.showProgress !== false,
        updateInterval: Math.round(number(propsIn.updateInterval, 5000, 1000, 60000)),
        // -1 means "never hide", which is why the floor is not 0.
        hideAfter: Math.round(number(propsIn.hideAfter, 5, -1, 3600)),
        scroll: {
            enabled: scrollIn.enabled !== false,
            speed: Math.round(number(scrollIn.speed, 70, 10, 600)),
            pauseDuration: Math.round(number(scrollIn.pauseDuration, 7, 0, 60))
        },
        // How the art and text change over to the next song. See transitionRules().
        transition: pick(propsIn.transition, TRANSITIONS, 'none'),
        // Whether the theme celebrates viewers' requests: their tier's
        // effect, a sub's own pick, and the milestone takeover. Drawn by
        // widget/public/effects.js, over the theme, so none of this - nor the
        // ambience below - adds anything to the stylesheet.
        perks: propsIn.perks === true,
        // Whether a milestone takes the widget over, and for how long. A
        // theme from before milestones had a switch of their own followed
        // `perks`, the one switch there was.
        milestone: {
            enabled: milestoneIn.enabled !== undefined ? milestoneIn.enabled === true : propsIn.perks === true,
            seconds: Math.round(number(milestoneIn.seconds, 4, 1.5, 15) * 2) / 2
        },
        // A quiet drift across the widget while music plays. Never a burst:
        // those are viewers' rewards, and would mean nothing if they played
        // all the time.
        ambience: {
            style: pick(ambienceIn.style, AMBIENCES, 'none'),
            amount: Math.round(number(ambienceIn.amount, 1, 0.25, 3) * 100) / 100,
            speed: Math.round(number(ambienceIn.speed, 1, 0.25, 3) * 100) / 100,
            colors: pick(ambienceIn.colors, AMBIENCE_COLORS, 'album')
        }
    };

    const model = {
        version: MODEL_VERSION,
        label: String(raw.label || base.label).slice(0, 60),
        canvas,
        modules,
        icons: normalizeIcons(raw.icons, canvas),
        cards: normalizeCards(raw.cards, canvas),
        labels: normalizeLabels(raw.labels, canvas),
        properties
    };

    stackParts(model);
    return model;
}

/**
 * Every part's key, back to front, in the order the widget has always drawn
 * them: cards behind the art, the art, cards over it, the text, the bar and
 * its clocks, icons, labels, and Up next last.
 *
 * Nothing ever wrote that down. Each rule gives its part a z-index - 0 for the
 * art and the cards behind it, 1 for the canvas blur, 2 for everything else -
 * and the page order breaks the ties. This is that order spelled out, so a
 * theme saved before parts could be rearranged keeps it.
 */
function defaultStack(model) {
    const cards = model.cards || [];
    return [
        ...cards.filter(card => card.layer !== 'front').map(card => 'card:' + card.id),
        'art',
        ...cards.filter(card => card.layer === 'front').map(card => 'card:' + card.id),
        'title', 'artist', 'progress', 'elapsed', 'duration',
        ...(model.icons || []).map(icon => 'icon:' + icon.id),
        ...(model.labels || []).map(label => 'label:' + label.id),
        'next'
    ];
}

/** Every part by the key defaultStack() lists it under. */
function partsByKey(model) {
    return new Map([
        ...model.modules.map(module => [module.type, module]),
        ...(model.cards || []).map(card => ['card:' + card.id, card]),
        ...(model.icons || []).map(icon => ['icon:' + icon.id, icon]),
        ...(model.labels || []).map(label => ['label:' + label.id, label])
    ]);
}

/**
 * The parts' keys back to front, by their `z`. A part without one - a theme
 * from before stacking, or a model that has not been through normalizeModel
 * yet - takes its place in defaultStack(), which also settles any tie.
 */
function stackOf(model) {
    const parts = partsByKey(model);
    return defaultStack(model)
        .filter(key => parts.has(key))
        .map((key, at) => ({ key, at, z: Number.isFinite(parts.get(key).z) ? parts.get(key).z : at }))
        .sort((a, b) => a.z - b.z || a.at - b.at)
        .map(entry => entry.key);
}

/**
 * Writes the stack back as plain ranks from 0, so a theme file reads in order
 * whatever it was given - gaps, ties, or a part with no rank at all.
 */
function stackParts(model) {
    const parts = partsByKey(model);
    stackOf(model).forEach((key, rank) => { parts.get(key).z = rank; });
}

/* ---------------------------------------------------------- generation */

function moduleOf(model, type) {
    return model.modules.find(module => module.type === type);
}

function box(module) {
    return [
        `    left: ${module.x}px;`,
        `    top: ${module.y}px;`,
        `    width: ${module.w}px;`,
        `    height: ${module.h}px;`
    ].join('\n');
}

/**
 * How far past its box a text module paints, in pixels.
 *
 * `-webkit-text-stroke` is centered on the glyph edge, so half of a stroke is
 * drawn outside the letter - and the width written into the CSS is doubled
 * (see below), which puts that outer half exactly `outline` pixels past the
 * glyph. The box clips its overflow, so without room for it that half is
 * simply sliced off.
 */
function bleedOf(module) {
    return Math.ceil(module.outline || 0);
}

/**
 * The drop shadow step for a text module or an icon, or nothing if it has none.
 *
 * A `drop-shadow` filter rather than a `text-shadow`, for the reason the glow
 * gives below: the box clips its overflow so a long title can scroll, and a
 * text-shadow lives inside that clip - an offset shadow would be sliced off
 * against the edge of the box, hardest exactly where it is thrown furthest.
 *
 * It also means the shadow is cast by the silhouette of the *painted* text,
 * so an outlined title throws the shadow of its outline rather than a second
 * copy of the letters peeking out from behind the stroke.
 *
 * The angle is read the way the canvas gradient angle is: 0 is up, 90 is
 * right, growing clockwise. Hence the sin/-cos rather than the other way
 * round - CSS measures y downwards, so a shadow thrown upwards is negative.
 * Two decimals, because nothing useful comes of 4.242640687119285px.
 */
function shadowStep(module) {
    if (!module.shadow) return '';

    const radians = module.shadowAngle * Math.PI / 180;
    const round = value => Math.round(value * 100) / 100;

    const x = round(Math.sin(radians) * module.shadow);
    const y = round(-Math.cos(radians) * module.shadow);

    return `drop-shadow(${x}px ${y}px ${module.shadowBlur}px ${module.shadowColor})`;
}

/**
 * Lines a text part up inside its box, for a flex container.
 *
 * `safe` is what keeps a centered or right-aligned line that is too long to fit
 * readable: without it the overflow spills off *both* sides, so a scrolling
 * artist started with its first word already cut off and stopped short of its
 * last. `safe` falls back to the start edge the moment the text overflows,
 * which is where the scroll animation expects it to begin.
 *
 * The plain value goes first for OBS builds whose browser predates `safe`
 * (Chromium 115): they drop the second line and keep the first, and the
 * `.scrolling` rules in generateCss put a long line back at the start there.
 */
function justifyRules(module) {
    const value = module.align === 'center' ? 'center' : module.align === 'right' ? 'flex-end' : 'flex-start';
    return value === 'flex-start'
        ? `justify-content: flex-start;`
        : `justify-content: ${value};
    justify-content: safe ${value};`;
}

function textRules(selector, module) {
    // The glow is a filter on the box, not a text-shadow on the text: the box
    // clips its overflow so long titles can scroll, and a shadow inside it gets
    // sliced into a hard-edged rectangle. A filter paints outside the box.
    //
    // `overflow` is also the only clip that happens *before* the filter -
    // `clip-path` and `mask` are applied after it and would cut the halo back
    // off - which is why the outline is given its room below by growing the
    // box rather than by clipping somewhere else.
    //
    // The shadow goes first. Chained filters feed into each other, so the
    // second one sees the first one's output: shadow-then-glow haloes the
    // letters and their shadow, which still reads as text with a shadow,
    // while glow-then-shadow casts the shadow of the halo - a soft dark blob
    // the size of the glow. Only one of those is worth looking at.
    const steps = [
        shadowStep(module),
        ...(module.glow
            ? [`drop-shadow(0 0 ${module.glow}px ${module.glowColor})`,
               `drop-shadow(0 0 ${Math.round(module.glow / 2)}px ${module.glowColor})`]
            : [])
    ].filter(Boolean);

    const filter = steps.length ? `\n    filter: ${steps.join(' ')};` : '';

    // -webkit-text-stroke centers the stroke on the glyph edge, so half of it
    // eats into the letter. `paint-order` puts the stroke down first and the
    // fill over the top, which is what an outline is meant to look like -
    // otherwise a 3px outline visibly thins the text it is protecting.
    //
    // Padding moves the clip out past the stroke; the matching negative margin
    // pulls the box back by the same amount, so the *content* box - the
    // rectangle the editor draws, the user drags, and every width measurement
    // works from - is still exactly x/y/w/h. Nothing moves on screen; the clip
    // just stops cutting.
    //
    // `box-sizing` is spelled out because the theme editor renders this same
    // stylesheet inside a page with a `* { box-sizing: border-box }` reset.
    // Under that reset the padding is taken *out* of the width instead of
    // added to it, so the clip stays where it was and the line loses room -
    // the preview would drift from what OBS draws.
    const bleed = bleedOf(module);
    const room = bleed
        ? `
    box-sizing: content-box;
    padding: ${bleed}px;
    margin: -${bleed}px;`
        : '';

    const outline = module.outline
        ? `
    paint-order: stroke fill;
    -webkit-text-stroke: ${module.outline * 2}px ${module.outlineColor};`
        : '';

    return `${selector} {
    position: absolute;
${box(module)}
    display: flex;
    align-items: center;
    white-space: nowrap;
    ${justifyRules(module)}
    overflow: hidden;${room}
    z-index: 2;${filter}
    ${module.hidden ? 'display: none;' : ''}
}

${selector} > * {
    font-family: ${FONTS[module.font].stack};
    font-size: ${module.fontSize}px;
    font-weight: ${module.fontWeight};
    font-style: ${module.italic ? 'italic' : 'normal'};
    color: ${module.color};
    letter-spacing: ${module.letterSpacing}px;
    text-transform: ${module.uppercase ? 'uppercase' : 'none'};
    opacity: ${module.opacity};
    white-space: nowrap;${outline}
}`;
}

/** The stylesheet the widget actually renders. Regenerated on every save. */
/**
 * The soft edges either side of a line that is scrolling.
 *
 * These fade the text itself out with a mask rather than laying a colored
 * strip over it. A colored strip has to guess what is behind it, which is
 * fine over a flat panel and obviously wrong over a gradient - a band of the
 * wrong color down each side. A mask makes the letters themselves go
 * transparent, so it is right over a gradient, a photo, or nothing at all.
 *
 * The mask only exists while a line is scrolling, so text that fits stays
 * sharp to its edges.
 *
 * The offsets are measured from the box the user drew, not from the element -
 * an outlined line has grown its element by the width of the stroke, and a
 * flat 22px would put its fade that much further out than the one beside it.
 */
function fadeRules(model) {
    const mask = (module) => {
        const edge = 22 + bleedOf(module);
        return `linear-gradient(to right, transparent 0, #000 ${edge}px, #000 calc(100% - ${edge}px), transparent 100%)`;
    };

    const rule = (selector, module) => `${selector}.scrolling {
    -webkit-mask-image: ${mask(module)};
    mask-image: ${mask(module)};
}`;

    return `

/* Soft edges, but only while a line is scrolling. */

${rule('.title-wrapper', moduleOf(model, 'title'))}

${rule('.artist-wrapper', moduleOf(model, 'artist'))}
`;
}

/** A flat color, or the two-stop gradient the editor offers. */
function canvasBackground(canvas) {
    if (canvas.backgroundMode !== 'gradient') return canvas.background;
    return `linear-gradient(${canvas.gradientAngle}deg, ${canvas.background}, ${canvas.backgroundTo})`;
}

/**
 * Blur and dim: the layer between what the panel is showing and the text.
 *
 * The blur is a `backdrop-filter` on this layer rather than a `filter` on the
 * artwork, because a filter samples past the element's own edges - a blurred
 * Canvas video fades away to nothing around the edge of the panel it is meant
 * to be filling. A backdrop-filter blurs what has already been painted
 * underneath instead, so the picture keeps its edges.
 *
 * What is underneath is the panel background and the album art or Canvas
 * video, and nothing else. OBS composites the scene behind the *page*, which
 * the page cannot see, so this can never blur or dim gameplay - the editor
 * says so, because it is the first thing people expect it to do.
 *
 * Dim is part of the same filter rather than black laid over the top, because
 * a theme can have its panel hidden - and a black rectangle over a panel that
 * is meant to be transparent is a black rectangle on the stream. `brightness`
 * only touches color, never alpha, so it darkens the artwork and leaves the
 * empty parts of the panel exactly as empty as they were.
 *
 * Nothing is emitted when both are off, so a theme that does not use them is
 * the same stylesheet it was before they existed.
 */
function veilRules(canvas) {
    if (!canvas.blur && !canvas.dim) return '';

    const steps = [
        canvas.blur ? `blur(${canvas.blur}px)` : '',
        canvas.dim ? `brightness(${Math.round((1 - canvas.dim) * 100) / 100})` : ''
    ].filter(Boolean).join(' ');

    return `
/* Over the artwork, under the text. */

.widget::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    -webkit-backdrop-filter: ${steps};
    backdrop-filter: ${steps};
}
`;
}

/**
 * The rules for the theme's icons.
 *
 * Color is set on the wrapper rather than on the SVG, because Lucide draws
 * every shape with `stroke="currentColor"` - so one `color` reaches the whole
 * icon, and `var(--album-vibrant)` re-tints it with the artwork exactly the
 * way the text colors already do.
 *
 * Stroke width stays an attribute on the SVG instead: it is in the 24-unit
 * space of the viewBox, so the browser scales it with the icon. That is why a
 * large icon at width 1 still looks finer than a small one at 3.
 *
 * The shadow is a filter on the same wrapper the rotation is on, and a filter
 * is drawn before the transform - so the rotation would swing the shadow round
 * with the icon, and a row of tilted icons would each throw theirs a different
 * way. Taking the rotation back off the angle keeps every shadow falling where
 * its angle says, the way the light in a scene does.
 */
function iconRules(icons) {
    if (!icons.length) return '';

    const rules = icons.map(icon => {
        const shadow = shadowStep({ ...icon, shadowAngle: icon.shadowAngle - icon.rotate });

        return `.icon-${icon.id} {
    position: absolute;
${box(icon)}
    z-index: 2;
    color: ${icon.color};
    opacity: ${icon.opacity};${icon.rotate ? `
    transform: rotate(${icon.rotate}deg);` : ''}${shadow ? `
    filter: ${shadow};` : ''}
    ${icon.hidden ? 'display: none;' : ''}
}`;
    }).join('\n\n');

    return `

/* Icons */

.icon svg {
    display: block;
    width: 100%;
    height: 100%;
}

${rules}
`;
}

/**
 * The rules for the theme's cards.
 *
 * Every card is in the markup ahead of the album art, and its layer is only a
 * z-index. A back card shares the art's z-index of 0, so the art - later in
 * the page - is drawn over it: that is a frame or a tile behind the artwork.
 * A front card sits at 2 with the text, and the text is later in the page, so
 * it lands over the art and under the words: a label across a full-size
 * cover. It is also over the canvas blur and dim, which a card is not part of.
 *
 * The card is three layers, because the fill has to fade on its own. The
 * frost and the shadow are on the card itself, the fill is ::before, and the
 * border is ::after, on top of it. The obvious ways to fade just the fill
 * are both wrong here. `opacity` on the card fades the frost behind it too,
 * so a frosted card turns clear as it is made lighter. `color-mix()` fades
 * only the color, but OBS builds on Chromium before 111 do not have it, and
 * with an album color - a variable - the whole background is then dropped
 * rather than falling back: every see-through card would draw no fill at all.
 *
 * The border gets its own layer so the fill cannot paint over it: a child is
 * always drawn after its parent's border. `box-sizing` is spelled out for the
 * reason textRules() gives, so the border sits inside the box in the editor
 * and on stream alike, and the rectangle you drag is the card.
 */
function cardRules(cards) {
    if (!cards.length) return '';

    const background = card => card.backgroundMode === 'gradient'
        ? `linear-gradient(${card.gradientAngle}deg, ${card.background}, ${card.backgroundTo})`
        : card.background;

    const rules = cards.map(card => `.card-${card.id} {
    position: absolute;
${box(card)}
    z-index: ${card.layer === 'front' ? 2 : 0};
    border-radius: ${radiusCss(card)};${card.shadow ? `
    box-shadow: 0 ${Math.round(card.shadow / 2)}px ${card.shadow}px rgba(0, 0, 0, .38);` : ''}${card.blur ? `
    -webkit-backdrop-filter: blur(${card.blur}px);
    backdrop-filter: blur(${card.blur}px);` : ''}
    pointer-events: none;
    ${card.hidden ? 'display: none;' : ''}
}

.card-${card.id}::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: ${background(card)};${card.fillOpacity < 1 ? `
    opacity: ${card.fillOpacity};` : ''}${card.bevel ? `
    box-shadow: inset ${card.bevel}px ${card.bevel}px 0 rgba(255, 255, 255, .35), inset -${card.bevel}px -${card.bevel}px 0 rgba(0, 0, 0, .35);` : ''}
}${card.borderWidth ? `

.card-${card.id}::after {
    content: '';
    position: absolute;
    inset: 0;
    box-sizing: border-box;
${cardBorder(card)}
    border-radius: inherit;
}` : ''}`).join('\n\n');

    return `

/* Cards */

${rules}
`;
}

/**
 * A card's border layer: a plain border, or a gradient ring.
 *
 * A border cannot take a gradient and keep rounded corners, so the ring is a
 * gradient filling the whole layer with its middle masked away - the padding
 * is the ring's width. The prefixed pair is for older OBS builds, whose
 * Chromium only knows the -webkit- mask and calls "exclude" "xor".
 */
function cardBorder(card) {
    if (card.borderMode !== 'gradient') return `    border: ${card.borderWidth}px solid ${card.borderColor};`;

    return `    padding: ${card.borderWidth}px;
    background: linear-gradient(${card.gradientAngle}deg, ${card.borderColor}, ${card.borderTo});
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);`;
}

/** The card elements. Empty, and first in the widget - see cardRules(). */
function cardMarkup(cards) {
    return cards.map(card => `
        <div class="card card-${card.id}"></div>`).join('');
}

/** For the one field in a theme that is free text. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * The pixelation filter the art points at.
 *
 * Keeps one pixel in every block and grows it to fill the block: a dot grid
 * the size of a block, the art kept only where the dots are, then each dot
 * dilated by half a block. It works on anything drawn, which is why the Canvas
 * video pixelates as well as the cover.
 */
function fxMarkup(art) {
    if (!art.pixelate) return '';

    // Stretched a little on each axis so a whole number of blocks fits the
    // art exactly. A block that only partly fits has its dot outside the art,
    // so it drew nothing - a strip along the right or bottom edge.
    const round = value => Math.round(value * 100) / 100;
    const across = art.w / Math.max(1, Math.round(art.w / art.pixelate));
    const down = art.h / Math.max(1, Math.round(art.h / art.pixelate));

    return `
        <svg class="queueify-fx" width="0" height="0" aria-hidden="true" style="position:absolute">
            <filter id="queueify-pixelate" x="0" y="0" width="1" height="1">
                <feFlood x="${round(across / 2)}" y="${round(down / 2)}" width="1" height="1"/>
                <feComposite width="${round(across)}" height="${round(down)}"/>
                <feTile result="dots"/>
                <feComposite in="SourceGraphic" in2="dots" operator="in"/>
                <feMorphology operator="dilate" radius="${round(across / 2)} ${round(down / 2)}"/>
            </filter>
        </svg>`;
}

/**
 * The label elements. The text as it was written goes in data-text too, so
 * app.js can fill in {requester} again for every song rather than only once.
 */
function labelMarkup(labels) {
    return labels.map(label => `
        <div class="qlabel qlabel-${label.id}" data-text="${escapeHtml(label.text)}">
            <span class="qlabel-text">${escapeHtml(label.text)}</span>
        </div>`).join('');
}

/** The Up next row, if the theme shows it. app.js fills in the songs. */
function nextMarkup(next) {
    if (!next || next.hidden) return '';

    const caption = next.label ? `
            <span class="next-label">${escapeHtml(next.label)}</span>` : '';

    return `
        <div class="next-wrapper" data-source="${next.source}" data-count="${next.count}" data-thumbs="${next.thumbs ? 1 : 0}" data-requester="${next.requester ? 1 : 0}">${caption}
            <div class="next-list"></div>
        </div>`;
}

/**
 * Everything a theme's page carries beyond the fixed parts, cards and icons -
 * and only what it uses, so a theme that uses none of it is the page it
 * always was. The editor puts the same markup in its preview.
 */
function extraMarkup(model) {
    const art = moduleOf(model, 'art');
    const progress = moduleOf(model, 'progress');

    return labelMarkup(model.labels || []) +
        (art.blur && !art.hidden ? `
        <div class="art-blur"></div>` : '') +
        nextMarkup(moduleOf(model, 'next')) +
        (progress.knob ? `
        <div class="progress-knob"></div>` : '') +
        fxMarkup(art);
}

/**
 * What goes inside the progress bar.
 *
 * A plain bar needs nothing: app.js widens `.progress` and that is the bar. A
 * waveform needs the bars themselves, twice - once for the track and once for
 * the played part that `.progress` clips.
 */
function progressMarkup(progress) {
    if (progress.style !== 'waveform') return '<div class="progress"></div>';

    const bars = '<i></i>'.repeat(progress.bars);

    return `<div class="wave track">${bars}</div>
            <div class="progress"><div class="wave fill">${bars}</div></div>`;
}

/** The icon elements, with Lucide's shapes inlined so nothing is fetched. */
function iconMarkup(icons) {
    return icons.map(icon => {
        const body = iconBody(icon.name);
        if (!body) return '';

        return `
        <div class="icon icon-${icon.id}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
            `stroke="currentColor" stroke-width="${icon.strokeWidth}" ` +
            `stroke-linecap="round" stroke-linejoin="round">${body}</svg>
        </div>`;
    }).join('');
}

/**
 * The bar heights of a waveform, as fractions of the box.
 *
 * Deterministic, and deliberately so: the same theme has to generate the same
 * waveform every time it is saved. `Math.random` would reshape somebody's
 * design every time they touched anything else in it.
 *
 * It is not flat noise either. Pure random heights read as a bar chart; a
 * waveform has loud passages and quiet ones. So a slow swell decides roughly
 * how tall this stretch is and the noise varies each bar within it, which is
 * what gives the clusters and the occasional spike.
 */
function waveHeights(count, seed) {
    // A small integer hash. Enough for a shape nobody can see the pattern in,
    // and short enough to read.
    let state = (seed * 2654435761) >>> 0;
    const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };

    // Two swells at unrelated speeds, so the loud stretches do not arrive on
    // a beat you can count.
    const phase = random() * Math.PI * 2;
    const slow = 2.1 + random() * 1.7;
    const fast = 6.3 + random() * 3.1;

    const heights = [];

    for (let i = 0; i < count; i += 1) {
        const at = i / Math.max(1, count - 1);
        const swell =
            0.5 + 0.32 * Math.sin(at * slow * Math.PI * 2 + phase)
                + 0.18 * Math.sin(at * fast * Math.PI * 2 + phase * 1.7);

        // Weighted towards the swell so neighbors stay related, with enough
        // per-bar noise that no two bars in a run are the same height.
        const unit = Math.min(1, Math.max(0, swell * 0.62 + random() * 0.38));

        // Never a bar with no height at all - the reference waveform has short
        // bars, not gaps.
        heights.push(Math.round((0.18 + unit * 0.82) * 100) / 100);
    }

    return heights;
}

/**
 * The progress bar, in whichever shape the theme asked for.
 *
 * Both shapes keep the same contract with the widget runtime: `.progress` is
 * the played part and app.js sets its width as a percentage. For the waveform
 * that means two identical rows of bars, one in the track color and one in
 * the fill color, with the fill row clipped by `.progress`. The fill row is
 * pinned to the full width of the box in pixels so its bars stay lined up
 * with the track's however far along the song is - a percentage would squash
 * them together as the clip narrowed.
 */
/**
 * What the played part of the bar is painted with.
 *
 * A gradient is sized to the whole bar rather than to the played part, so the
 * colors belong to positions along it: the far end only turns the second
 * color once the song gets there, instead of the whole gradient squeezing
 * into the first few seconds.
 */
function fillRules(progress) {
    if (progress.fillMode !== 'gradient') return `background: ${progress.fillColor};`;
    return `background: linear-gradient(90deg, ${progress.fillColor}, ${progress.fillTo});
    background-size: ${progress.w}px 100%;`;
}

/**
 * One wave of the squiggle, as an SVG to mask the played part with.
 *
 * A quadratic curve up and its mirror down, starting and ending on the
 * midline with the same slope, so the tiles join without a seam. The control
 * point sits past the edge of the box so the *stroke* - not the line through
 * its middle - just touches the top and bottom.
 */
function squiggleMask(progress) {
    const length = progress.waveLength;
    const height = Math.max(progress.h, progress.lineWidth);
    const line = progress.lineWidth;
    const middle = height / 2;
    const peak = line - middle;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${length}" height="${height}" ` +
        `viewBox="0 0 ${length} ${height}"><path d="M0 ${middle} Q ${length / 4} ${peak} ${length / 2} ${middle} ` +
        `T ${length} ${middle}" fill="none" stroke="#000" stroke-width="${line}"/></svg>`;

    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function progressRules(progress) {
    if (progress.style === 'squiggle') return squiggleRules(progress);

    const container = `.progress-container {
    position: absolute;
${box(progress)}
    z-index: 2;
    background: ${progress.style === 'waveform' ? 'transparent' : progress.trackColor};
    border-radius: ${radiusCss(progress)};
    overflow: hidden;
    ${progress.hidden ? 'display: none;' : ''}
}`;

    if (progress.style !== 'waveform') {
        return `${container}

.progress {
    width: 0%;
    height: 100%;
    ${fillRules(progress)}
    border-radius: inherit;
    transition: width .25s linear;
}`;
    }

    const heights = waveHeights(progress.bars, progress.seed);

    // One rule per bar, on both rows at once. The bars are centered on the
    // midline, the way a waveform is drawn.
    const bands = heights.map((height, at) =>
        `.wave > i:nth-child(${at + 1}) { height: ${Math.round(height * 100)}%; }`
    ).join('\n');

    // A gradient runs across the whole waveform, not down each bar: every bar
    // shows the slice of it that sits where the bar does.
    const width = (progress.w - progress.barGap * (progress.bars - 1)) / progress.bars;
    const slices = progress.fillMode === 'gradient'
        ? '\n\n' + heights.map((height, at) =>
            `.wave.fill > i:nth-child(${at + 1}) { background-position: -${Math.round(at * (width + progress.barGap) * 100) / 100}px 0; }`
        ).join('\n')
        : '';

    return `${container}

.progress {
    position: relative;
    width: 0%;
    height: 100%;
    overflow: hidden;
    transition: width .25s linear;
}

/* Two rows of the same bars: the track underneath, the played part clipped
   over the top of it. */

.wave {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${progress.barGap}px;
    pointer-events: none;
}

.wave.fill {
    width: ${progress.w}px;
}

.wave > i {
    flex: 1 1 0;
    min-width: 1px;
    border-radius: ${Math.min(progress.radius, 6)}px;
}

.wave.track > i { background: ${progress.trackColor}; }
.wave.fill > i { ${fillRules(progress)} }

${bands}${slices}`;
}

/**
 * The squiggle: a wavy line for the part already played, and a plain one for
 * the rest of the song.
 *
 * The wave is a mask on the played part, so it takes any fill - a gradient
 * included - and it drifts along while the song plays. The plain line starts
 * where the played part ends, read from the same --progress the knob uses, so
 * the two never overlap.
 */
function squiggleRules(progress) {
    const line = progress.lineWidth;
    const mask = squiggleMask(progress);
    const height = Math.max(progress.h, line);
    const seconds = Math.round(Math.max(0.6, progress.waveLength / 20) * 100) / 100;

    return `.progress-container {
    position: absolute;
${box(progress)}
    z-index: 2;
    ${progress.hidden ? 'display: none;' : ''}
}

.progress-container::before {
    content: '';
    position: absolute;
    top: 50%;
    right: 0;
    left: calc(var(--progress, 0) * 100%);
    height: ${line}px;
    margin-top: -${line / 2}px;
    border-radius: ${line}px;
    background: ${progress.trackColor};
    transition: left .25s linear;
}

.progress {
    position: relative;
    width: 0%;
    height: 100%;
    ${fillRules(progress)}
    -webkit-mask: ${mask} 0 50% / ${progress.waveLength}px ${height}px repeat-x;
    mask: ${mask} 0 50% / ${progress.waveLength}px ${height}px repeat-x;
    animation: queueify-squiggle ${seconds}s linear infinite;
    transition: width .25s linear;
}

.widget.paused .progress {
    animation-play-state: paused;
}

@keyframes queueify-squiggle {
    to {
        -webkit-mask-position: ${progress.waveLength}px 50%;
        mask-position: ${progress.waveLength}px 50%;
    }
}`;
}

/**
 * A dot riding the playhead.
 *
 * Its own element rather than part of the bar, because the bar clips what is
 * inside it and a knob is usually bigger than the bar is tall. app.js puts
 * how far through the song it is into --progress, 0 to 1, and this turns it
 * into a position along the bar.
 */
function knobRules(progress) {
    if (!progress.knob) return '';

    const size = progress.knob;

    return `

/* Progress knob */

.progress-knob {
    position: absolute;
    left: calc(${progress.x - size / 2}px + ${progress.w}px * var(--progress, 0));
    top: ${Math.round((progress.y + progress.h / 2 - size / 2) * 100) / 100}px;
    width: ${size}px;
    height: ${size}px;
    z-index: 3;
    border-radius: ${progress.knobShape === 'square' ? Math.round(size / 6) + 'px' : '50%'};
    background: ${progress.knobColor};
    box-shadow: 0 1px ${Math.max(2, Math.round(size / 3))}px rgba(0, 0, 0, .45);
    transition: left .25s linear;
    pointer-events: none;
    ${progress.hidden ? 'display: none;' : ''}
}
`;
}

/**
 * The Up next row: a caption, then a chip per queued song.
 *
 * The chips are written by app.js, and only while Queueify has something
 * queued - the widget carries `has-next` then, and the row fades and slides
 * in. With nothing queued it fades back out, so a design can leave room for
 * it without that room ever looking empty for long.
 */
function nextRules(next) {
    if (next.hidden) return '';

    const radius = next.chipRadius;
    const stagger = Array.from({ length: NEXT_LIMIT - 1 }, (_, at) =>
        `.next-item:nth-child(${at + 2}) { animation-delay: ${(at + 1) * 0.08}s; }`).join('\n');

    return `

/* Up next */

${textRules('.next-wrapper', next)}

.next-wrapper {
    gap: 8px;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .5s ease, transform .5s ease;
}

.widget.has-next .next-wrapper {
    opacity: 1;
    transform: none;
}

.next-label {
    flex: none;
    color: ${next.labelColor};
}

.next-list {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}

.next-item {
    display: inline-flex;
    align-items: center;
    gap: .45em;
    flex: none;
    padding: .25em .8em;
    border-radius: ${radius}px;
    background: ${next.chipColor};
    animation: queueify-next-in .45s ease both;
}

.next-item.has-thumb {
    padding-left: .25em;
}

.next-thumb {
    width: 1.6em;
    height: 1.6em;
    flex: none;
    border-radius: ${radius}px;
    object-fit: cover;
}

.next-by {
    opacity: .6;
}

${stagger}

@keyframes queueify-next-in {
    from { opacity: 0; transform: translateX(-10px); }
}
`;
}

/**
 * Labels: text of your own, styled like any other text part.
 *
 * One that asks for {requester} is emptied by app.js when nobody requested
 * the song, and fades out rather than leaving "Requested by" hanging.
 */
function labelRules(labels) {
    if (!labels.length) return '';

    return `

/* Labels */

.qlabel {
    transition: opacity .4s ease;
}

.qlabel.is-empty {
    opacity: 0;
}

${labels.map(label => textRules('.qlabel-' + label.id, label)).join('\n\n')}
`;
}

/**
 * The album art's extras: a gradient ring, pixel blocks and a slow spin.
 *
 * The ring is a transparent border with a gradient behind it. An <img> only
 * paints its picture inside the border, so the gradient shows exactly where
 * the border is and nowhere else - no second element needed.
 *
 * Pixelation is an SVG filter (see fxMarkup), because it has to work on the
 * Canvas video as well as the cover, and CSS has nothing that does that.
 */
function artExtras(art) {
    const lines = [];

    if (art.borderWidth && art.borderMode === 'gradient') {
        lines.push(`    background: linear-gradient(135deg, ${art.borderColor}, ${art.borderTo}) border-box;`);
    }
    if (art.pixelate) lines.push('    filter: url(#queueify-pixelate);');
    if (art.spin) lines.push(`    animation: queueify-spin ${art.spin}s linear infinite;`);

    return lines.length ? '\n' + lines.join('\n') : '';
}

/**
 * The art's blur: a layer over the art that blurs what is under it, rather
 * than a blur on the art itself.
 *
 * A blur on the art samples past its edges, where there is nothing, so a
 * blurred cover fades out into a soft-edged smudge. A backdrop-filter blurs
 * what is already painted inside its own box and keeps the edges - the same
 * reason the canvas blur is one (see veilRules()). The layer is set in by the
 * border, so a border or ring stays sharp around the blurred picture.
 *
 * It sits just over the art: in the page after it at the same z-index, and in
 * a rearranged stack one step up (see stackRules()). It is square to the page,
 * so on spinning art it only lines up when the art is round - which spinning
 * art nearly always is.
 */
function artBlurRules(art) {
    if (!art.blur || art.hidden) return '';

    const border = art.borderWidth;
    const inner = { x: art.x + border, y: art.y + border, w: Math.max(0, art.w - border * 2), h: Math.max(0, art.h - border * 2) };
    const radius = art.corners
        ? art.corners.map(corner => Math.max(0, corner - border) + 'px').join(' ')
        : Math.max(0, art.radius - border) + 'px';

    return `

/* Album art blur */

.art-blur {
    position: absolute;
${box(inner)}
    z-index: 0;
    border-radius: ${radius};
    -webkit-backdrop-filter: blur(${art.blur}px);
    backdrop-filter: blur(${art.blur}px);
    pointer-events: none;
}
`;
}

function spinRules(art) {
    if (!art.spin) return '';

    return `

/* A record going round. It stops when the music does. */

.widget.paused .cover,
.widget.paused .canvas {
    animation-play-state: paused;
}

@keyframes queueify-spin {
    to { transform: rotate(360deg); }
}
`;
}

function generateCss(model) {
    const { canvas } = model;
    const inset = (canvas.inset || []).some(Boolean);
    const art = moduleOf(model, 'art');
    const title = moduleOf(model, 'title');
    const artist = moduleOf(model, 'artist');
    const progress = moduleOf(model, 'progress');
    const elapsed = moduleOf(model, 'elapsed');
    const duration = moduleOf(model, 'duration');

    return `/* Generated by the Queueify theme editor - edit the theme there, not here.
   Hand edits are overwritten the next time the theme is saved. */

.widget {
    position: relative;
    box-sizing: border-box;
    width: ${canvas.width}px;
    height: ${canvas.height}px;
    padding: ${canvas.padding}px;

    background: ${canvas.hidden || inset ? 'transparent' : canvasBackground(canvas)};
    border: ${canvas.hidden || inset ? 0 : canvas.borderWidth}px solid ${canvas.borderColor};
    border-radius: ${inset ? '0px' : radiusCss(canvas)};

    overflow: hidden;
    font-family: ${FONTS.system.stack};
    color: #fff;

    opacity: 1;
    transform: translateY(0);
    transition: opacity .4s ease, transform .4s ease;
}

.widget.hidden {
    opacity: 0;
    transform: translateY(20px);
    pointer-events: none;
}
${panelRules(canvas)}
${veilRules(canvas)}
/* Album art / Canvas video */

.cover,
.canvas {
    position: absolute;
${box(art)}
    z-index: 0;
    object-fit: ${art.fit};
    border-radius: ${radiusCss(art)};
    box-shadow: 0 ${Math.round(art.shadow / 2)}px ${art.shadow}px rgba(0, 0, 0, .38);${art.borderWidth ? `
    box-sizing: border-box;
    border: ${art.borderWidth}px solid ${art.borderMode === 'gradient' ? 'transparent' : art.borderColor};` : ''}${artExtras(art)}
    ${art.hidden ? 'display: none !important;' : ''}
}

/* Title */

${textRules('.title-wrapper', title)}

/* No clip of its own: the wrapper above already cuts at the right place, and
   this box is only as tall as one line of text - tight enough to shave the top
   and bottom off an outline before the wrapper ever saw it. */

.title-container {
    width: 100%;
    /* Full width on purpose - app.js measures it to decide whether the title
       fits - which leaves the wrapper's alignment nothing to move. So the
       title is aligned in here instead, or it always sat on the left. */
    display: flex;
    ${justifyRules(title)}
}

/* A line that scrolls starts at its beginning whatever its alignment, for the
   browsers that ignore \`safe\` above. The title's own \`scrolling\` class
   arrives 250ms late for the fade, so app.js marks the container at once. */
.title-container.overflowing,
.artist-wrapper.scrolling {
    justify-content: flex-start;
}

.title {
    display: inline-block;
}

/* Artist */

${textRules('.artist-wrapper', artist)}

.artist {
    display: inline-block;
}

/* Progress */

${progressRules(progress)}

/* How far into the song, and how long it runs for. app.js writes both. */

${textRules('.elapsed-wrapper', elapsed)}

.elapsed {
    display: inline-block;
    /* Digits change every second; a proportional font would jiggle the label
       about as 1s and 4s swap places. */
    font-variant-numeric: tabular-nums;
}

${textRules('.duration-wrapper', duration)}

.duration {
    display: inline-block;
    font-variant-numeric: tabular-nums;
}

/* Long text scrolls instead of being cut off. app.js measures each line and
   sets --scroll-distance (title) and --artist-distance (artist) per song, and
   only marks the ones that actually overflow. */

.title,
.artist {
    will-change: transform;
}

.title.scroll {
    animation: queueify-scroll-title var(--scroll-duration, 8s) linear infinite;
}

.artist.scroll {
    animation: queueify-scroll-artist var(--scroll-duration, 8s) linear infinite;
}

@keyframes queueify-scroll-title {
    0%, 20% { transform: translateX(0); }
    50%, 80% { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
    100% { transform: translateX(0); }
}

@keyframes queueify-scroll-artist {
    0%, 20% { transform: translateX(0); }
    50%, 80% { transform: translateX(calc(-1 * var(--artist-distance, 0px))); }
    100% { transform: translateX(0); }
}
${fadeRules(model)}${iconRules(model.icons || [])}${cardRules(model.cards || [])}${labelRules(model.labels || [])}${nextRules(moduleOf(model, 'next') || defaultModule('next'))}${knobRules(progress)}${spinRules(art)}${artBlurRules(art)}${transitionRules(model)}${stackRules(model)}`;
}

/**
 * How the song changes over: the art, the title, and the artist go out, the
 * new song goes in.
 *
 * app.js drives it with three classes on the widget: `song-out`, then - once
 * that has played and the new song is in place - `song-in`, and `dir-prev`
 * throughout when the skip was back to the song before. Each style is a pair
 * of keyframes; `--qf-dir` turns the direction round, so a skip back runs the
 * other way without a second set.
 *
 * Out is short and speeds up, in is longer and settles: leaving should get
 * out of the way, arriving is the part worth watching. Only transforms,
 * opacity, and clip-path move, which the browser composites without redrawing
 * the page, so it stays smooth in an OBS source. Filters are left alone: a
 * glow or pixelation is a filter already, and a list of different filters
 * does not animate from one to the other - it jumps.
 *
 * The art keeps its spin, first in its list, so a record does not stop to
 * change songs. Timings here and in app.js move together: OUT is the longest
 * out plus its stagger, IN the same for the way in.
 */
function transitionRules(model) {
    const style = model.properties.transition;
    if (!style || style === 'none') return '';

    const art = moduleOf(model, 'art');
    const spin = art.spin ? `queueify-spin ${art.spin}s linear infinite, ` : '';
    const out = '.18s cubic-bezier(.4, 0, 1, 1)';
    const inn = style === 'pop' ? '.5s cubic-bezier(.34, 1.56, .64, 1)' : '.46s cubic-bezier(.16, 1, .3, 1)';

    // Each style's out and in, for the art and for the text.
    const frames = {
        slide: {
            art: ['to { opacity: 0; translate: calc(var(--qf-dir, 1) * -28px) 0; }',
                'from { opacity: 0; translate: calc(var(--qf-dir, 1) * 36px) 0; }'],
            text: ['to { opacity: 0; translate: calc(var(--qf-dir, 1) * -20px) 0; }',
                'from { opacity: 0; translate: calc(var(--qf-dir, 1) * 28px) 0; }']
        },
        fade: {
            art: ['to { opacity: 0; scale: .96; }', 'from { opacity: 0; scale: 1.04; }'],
            text: ['to { opacity: 0; }', 'from { opacity: 0; translate: 0 4px; }']
        },
        flip: {
            art: ['to { rotate: y calc(var(--qf-dir, 1) * 90deg); }',
                'from { rotate: y calc(var(--qf-dir, 1) * -90deg); }'],
            text: ['to { opacity: 0; translate: 0 -12px; }', 'from { opacity: 0; translate: 0 14px; }']
        },
        pop: {
            art: ['to { opacity: 0; scale: .86; }', 'from { opacity: 0; scale: .78; }'],
            text: ['to { opacity: 0; scale: .94; }', 'from { opacity: 0; scale: .9; }']
        },
        // Clipped a little outside the box, so a shadow is not cut off.
        wipe: {
            art: ['from { clip-path: inset(-40px); } to { clip-path: inset(-40px -40px -40px 100%); }',
                'from { clip-path: inset(-40px 100% -40px -40px); } to { clip-path: inset(-40px); }'],
            text: ['from { clip-path: inset(-40px); } to { clip-path: inset(-40px -40px -40px 100%); }',
                'from { clip-path: inset(-40px 100% -40px -40px); } to { clip-path: inset(-40px); }']
        }
    }[style];

    // A wipe cannot be turned round with a sign, so a skip back gets its own pair.
    const back = style === 'wipe' ? `
@keyframes qf-art-out-back { from { clip-path: inset(-40px); } to { clip-path: inset(-40px 100% -40px -40px); } }
@keyframes qf-art-in-back { from { clip-path: inset(-40px -40px -40px 100%); } to { clip-path: inset(-40px); } }
@keyframes qf-text-out-back { from { clip-path: inset(-40px); } to { clip-path: inset(-40px 100% -40px -40px); } }
@keyframes qf-text-in-back { from { clip-path: inset(-40px -40px -40px 100%); } to { clip-path: inset(-40px); } }

.widget.dir-prev.song-out .cover,
.widget.dir-prev.song-out .canvas { animation: ${spin}qf-art-out-back ${out} both; }
.widget.dir-prev.song-out .title-wrapper { animation: qf-text-out-back ${out} .02s both; }
.widget.dir-prev.song-out .artist-wrapper { animation: qf-text-out-back ${out} .04s both; }
.widget.dir-prev.song-in .cover,
.widget.dir-prev.song-in .canvas { animation: ${spin}qf-art-in-back ${inn} both; }
.widget.dir-prev.song-in .title-wrapper { animation: qf-text-in-back ${inn} .05s both; }
.widget.dir-prev.song-in .artist-wrapper { animation: qf-text-in-back ${inn} .1s both; }
` : '';

    // The album colors blend into the new song's instead of jumping: they
    // are registered as colors, which is what lets a custom property animate.
    // The widget's own fade is repeated here because this list replaces its.
    const album = [['vibrant', '#1DB954'], ['dark', '#141419'], ['light', '#ffffff'], ['muted', 'rgba(255, 255, 255, .7)']];
    const colors = album.map(([name, initial]) =>
        `@property --album-${name} { syntax: '<color>'; inherits: true; initial-value: ${initial}; }`).join('\n');
    const blend = album.map(([name]) => `--album-${name} .5s ease`).join(', ');

    return `

/* Changing songs: ${style} */

${colors}

.widget { transition: opacity .4s ease, transform .4s ease, ${blend}; }

.widget.dir-prev { --qf-dir: -1; }${style === 'flip' ? `
.widget.song-out,
.widget.song-in { perspective: 900px; }` : ''}

@keyframes qf-art-out { ${frames.art[0]} }
@keyframes qf-art-in { ${frames.art[1]} }
@keyframes qf-text-out { ${frames.text[0]} }
@keyframes qf-text-in { ${frames.text[1]} }

.widget.song-out .cover,
.widget.song-out .canvas { animation: ${spin}qf-art-out ${out} both; }
.widget.song-out .title-wrapper { animation: qf-text-out ${out} .02s both; }
.widget.song-out .artist-wrapper { animation: qf-text-out ${out} .04s both; }

.widget.song-in .cover,
.widget.song-in .canvas { animation: ${spin}qf-art-in ${inn} both; }
.widget.song-in .title-wrapper { animation: qf-text-in ${inn} .05s both; }
.widget.song-in .artist-wrapper { animation: qf-text-in ${inn} .1s both; }
${back}`;
}

/**
 * The panel, when it is drawn in from the edge of the canvas.
 *
 * Normally the panel is the widget's own box, and the widget clips to it, so
 * nothing can reach past its edge. Inset, the widget turns into a clear box
 * the size of the canvas - still clipping there, at the edge of the OBS source
 * - and the panel is a layer inside it. The space between the two is where a
 * part sticks out over the panel's edge, like a record out of its sleeve.
 *
 * The layer is ::before, so it is first in the widget and under every part:
 * the art and the cards behind it share its z-index of 0 and come later.
 */
function panelRules(canvas) {
    if (!(canvas.inset || []).some(Boolean) || canvas.hidden) return '';

    return `
/* The panel, drawn in from the edge so parts can stick out over it */

.widget::before {
    content: '';
    position: absolute;
    inset: ${canvas.inset.map(side => side + 'px').join(' ')};
    z-index: 0;
    box-sizing: border-box;
    background: ${canvasBackground(canvas)};
    border: ${canvas.borderWidth}px solid ${canvas.borderColor};
    border-radius: ${radiusCss(canvas)};
    pointer-events: none;
}
`;
}

// What each part is drawn as, for stackRules().
const STACK_SELECTORS = {
    art: '.cover, .canvas',
    title: '.title-wrapper',
    artist: '.artist-wrapper',
    progress: '.progress-container',
    elapsed: '.elapsed-wrapper',
    duration: '.duration-wrapper',
    next: '.next-wrapper'
};

function stackSelector(key) {
    if (key.startsWith('card:')) return '.card-' + key.slice(5);
    if (key.startsWith('icon:')) return '.icon-' + key.slice(5);
    if (key.startsWith('label:')) return '.qlabel-' + key.slice(6);
    return STACK_SELECTORS[key];
}

/**
 * The stacking, once the parts have been rearranged.
 *
 * Every rule above gives its part the z-index it has always had, which draws
 * defaultStack(). A theme still in that order gets nothing here. One that has
 * been rearranged gets a z-index for every part, last in the sheet so it wins,
 * in steps of two: the canvas blur and dim then sit just over the art wherever
 * it has gone, and the knob just over its bar.
 */
function stackRules(model) {
    const order = stackOf(model);
    if (order.join() === defaultStack(model).join()) return '';

    const z = new Map(order.map((key, at) => [key, (at + 1) * 2]));
    const rules = order.map(key => `${stackSelector(key)} { z-index: ${z.get(key)}; }`);

    if (model.canvas.blur || model.canvas.dim) rules.push(`.widget::after { z-index: ${z.get('art') + 1}; }`);
    if (moduleOf(model, 'progress').knob) rules.push(`.progress-knob { z-index: ${z.get('progress') + 1}; }`);
    const art = moduleOf(model, 'art');
    if (art.blur && !art.hidden) rules.push(`.art-blur { z-index: ${z.get('art') + 1}; }`);

    return `

/* Stacking, as arranged in the editor */

${rules.join('\n')}
`;
}

/**
 * The markup is fixed, not designed: these are the exact elements app.js
 * queries, so a generated theme can never break the runtime. Layout lives
 * entirely in the stylesheet.
 */
function generateHtml(name, model) {
    const href = googleFontsHref(model ? googleFonts(model) : []);

    // Only the families the design uses, and only at the weights it uses. The
    // stacks in the stylesheet still name a local fallback, so a theme keeps
    // working if the fonts cannot be fetched.
    const fontLinks = href
        ? `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="${href}">`
        : '';

    return `<!DOCTYPE html>
<html>

<head>${fontLinks}
    <link id="theme" rel="stylesheet" href="/themes/${name}/style.css">
</head>

<body>
    <div class="widget">${cardMarkup(model ? model.cards || [] : [])}
        <img class="cover">
        <video class="canvas" autoplay muted loop playsinline></video>

        <div class="title-wrapper">
            <div class="title-container">
                <div class="title"></div>
            </div>
        </div>

        <div class="artist-wrapper">
            <div class="artist"></div>
        </div>

        <div class="progress-container">
            ${progressMarkup(model ? moduleOf(model, 'progress') : defaultModule('progress'))}
        </div>

        <div class="elapsed-wrapper">
            <div class="elapsed"></div>
        </div>

        <div class="duration-wrapper">
            <div class="duration"></div>
        </div>${iconMarkup(model ? model.icons || [] : [])}${model ? extraMarkup(model) : ''}
    </div>

    <script src="/app.js"></script>
</body>

</html>
`;
}

/**
 * A theme's page with its stylesheet written in and no script: something to
 * draw a still preview of, as the premade gallery does. The song is filled in
 * by whoever shows it.
 */
function previewHtml(model) {
    const page = generateHtml('preview', model);
    return page
        .replace('<link id="theme" rel="stylesheet" href="/themes/preview/style.css">',
            '<style>html, body { margin: 0; background: transparent; overflow: hidden; }\n' + generateCss(model) + '</style>')
        .replace('\n    <script src="/app.js"></script>\n', '\n');
}

/* ----------------------------------------------------------- premades */

/**
 * The premade themes: finished designs to start from, because a blank canvas
 * is the least helpful thing to hand someone.
 *
 * Each is a JSON file - a label, a description, a few tags, where it sorts,
 * and a model - rather than code, so a premade is edited the same way a theme
 * is, in the editor. They are read on every call rather than once at start,
 * like everything else a person can change while Queueify runs.
 *
 * Every model goes through normalizeModel on the way out, so a premade can
 * never hand the editor something a saved theme could not be.
 */
const PRESETS_DIR = process.env.QUEUEIFY_PRESETS_DIR || path.join(__dirname, 'presets');

function readPreset(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, id + '.json'), 'utf8'));

    return {
        id,
        label: plainText(raw.label, id, 40) || id,
        description: plainText(raw.description, '', 200),
        tags: Array.isArray(raw.tags) ? raw.tags.map(tag => plainText(tag, '', 20)).filter(Boolean).slice(0, 4) : [],
        order: number(raw.order, 1000, -1e6, 1e6),
        model: normalizeModel(raw.model, { label: raw.label })
    };
}

function listPresets() {
    let files = [];
    try {
        files = fs.readdirSync(PRESETS_DIR);
    } catch {
        return [];
    }

    const presets = [];

    for (const file of files) {
        const id = file.replace(/\.json$/, '');
        if (id === file || !NAME_PATTERN.test(id)) continue;

        try {
            presets.push(readPreset(id));
        } catch (err) {
            // One broken file costs that premade, not the whole gallery.
            console.error(`Premade theme ${file} could not be read:`, err.message);
        }
    }

    return presets.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** One premade's model, or an error naming it. */
function presetModel(id) {
    if (typeof id !== 'string' || !NAME_PATTERN.test(id)) {
        throw new ThemeError(`There is no premade theme called "${id}".`, 'not_found');
    }

    try {
        return readPreset(id).model;
    } catch {
        throw new ThemeError(`There is no premade theme called "${id}".`, 'not_found');
    }
}

/* -------------------------------------------------------------- storage */

/**
 * The canvas an editor theme was designed at, read synchronously so status can
 * report the size the browser source actually needs. Null for hand-written
 * themes, whose size lives in their own CSS.
 */
function canvasSizeOf(name) {
    try {
        if (!NAME_PATTERN.test(name)) return null;

        if (isEditable(name)) {
            const model = JSON.parse(fs.readFileSync(path.join(themeDir(name), 'theme.json'), 'utf8'));
            const canvas = normalizeModel(model).canvas;
            return { width: canvas.width, height: canvas.height };
        }

        // A hand-written theme says its size in its own stylesheet, so the
        // built-in ones need no table kept in step by hand: minimal really is
        // 400x36, swag is 680x165, and guessing 680x192 for them would squash
        // or stretch the design.
        return sizeFromStylesheet(name);
    } catch {
        return null;
    }
}

/** Reads `.widget { width: ...; height: ... }` out of a theme's stylesheet. */
function sizeFromStylesheet(name) {
    const css = fs.readFileSync(path.join(themeDir(name), 'style.css'), 'utf8');
    const rule = /\.widget\s*\{([^}]*)\}/.exec(css);
    if (!rule) return null;

    const pixels = (property) => {
        // Built from a template, so the backslashes have to survive the string.
        const match = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`).exec(rule[1]);
        if (!match) return null;

        // Sizes can be written as a variable with a fallback, e.g.
        // `var(--widget-width, 400px)` - the fallback is the real default.
        const value = match[1];
        const number = /(-?[\d.]+)px/.exec(value.includes('var(') ? value.split(',').slice(1).join(',') : value);

        return number ? Math.round(Number(number[1])) : null;
    };

    const width = pixels('width');
    const height = pixels('height');

    return width && height ? { width, height } : null;
}

function isEditable(name) {
    return fs.existsSync(path.join(themeDir(name), 'theme.json'));
}

function exists(name) {
    return fs.existsSync(path.join(themeDir(name), 'index.html'));
}

/** Every theme the widget can use, flagged by whether the editor owns it. */
async function listThemes() {
    let entries = [];

    try {
        entries = await fsPromises.readdir(THEMES_DIR, { withFileTypes: true });
    } catch {
        return [];
    }

    const themes = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || !NAME_PATTERN.test(entry.name)) continue;
        if (!exists(entry.name)) continue;

        const editable = isEditable(entry.name);
        let label = entry.name;

        if (editable) {
            try {
                label = JSON.parse(await fsPromises.readFile(path.join(themeDir(entry.name), 'theme.json'), 'utf8')).label || label;
            } catch {
                // A damaged model still leaves a usable theme; it just cannot
                // be reopened in the editor.
            }
        }

        themes.push({ name: entry.name, label, editable, builtIn: !editable });
    }

    return themes.sort((a, b) => a.name.localeCompare(b.name));
}

async function readModel(name) {
    if (!exists(name)) throw new ThemeError(`There is no theme called "${name}".`, 'not_found');

    if (!isEditable(name)) {
        throw new ThemeError(
            `"${name}" is one of the built-in themes, so it cannot be opened in the editor. Duplicate it instead.`,
            'not_editable'
        );
    }

    const contents = await fsPromises.readFile(path.join(themeDir(name), 'theme.json'), 'utf8');
    return normalizeModel(JSON.parse(contents));
}

/**
 * Writes the model and everything generated from it. Refuses to touch a
 * hand-written theme, so the shipped fallbacks stay exactly as they are.
 */
async function saveTheme(name, model) {
    assertName(name);

    if (exists(name) && !isEditable(name)) {
        throw new ThemeError(
            `"${name}" is a built-in theme and cannot be overwritten. Pick a different name.`,
            'not_editable'
        );
    }

    const normalized = normalizeModel(model, { label: model?.label });
    const dir = themeDir(name);

    await fsPromises.mkdir(dir, { recursive: true });

    await Promise.all([
        fsPromises.writeFile(path.join(dir, 'theme.json'), JSON.stringify({ ...normalized, name }, null, 2)),
        fsPromises.writeFile(path.join(dir, 'style.css'), generateCss(normalized)),
        fsPromises.writeFile(path.join(dir, 'index.html'), generateHtml(name, normalized)),
        fsPromises.writeFile(path.join(dir, 'properties.json'), JSON.stringify(normalized.properties, null, 4))
    ]);

    return { name, model: normalized };
}

/**
 * The saved themes with viewer rewards, or milestones, switched off. Themes
 * made before rewards existed have both off, so a streamer with several
 * would otherwise open each one in the editor. Built-in themes have them on.
 */
async function themesWithRewardsOff() {
    const off = [];

    for (const theme of await listThemes()) {
        if (!theme.editable) continue;
        let props;
        try {
            props = (await readModel(theme.name)).properties;
        } catch {
            // A damaged model cannot be switched on either; leave it be.
            continue;
        }
        if (!props.perks || !props.milestone.enabled) {
            off.push({ name: theme.name, label: theme.label, effects: props.perks, milestones: props.milestone.enabled });
        }
    }

    return off;
}

/** Switches reward effects and milestones on in every saved theme. */
async function turnOnRewardsEverywhere() {
    const changed = [];
    const failed = [];

    for (const theme of await themesWithRewardsOff()) {
        try {
            const model = await readModel(theme.name);
            model.properties.perks = true;
            model.properties.milestone.enabled = true;
            await saveTheme(theme.name, model);
            changed.push(theme.name);
        } catch (err) {
            failed.push({ name: theme.name, error: err.message });
        }
    }

    return { changed, failed };
}

async function deleteTheme(name) {
    assertName(name);

    if (!exists(name)) throw new ThemeError(`There is no theme called "${name}".`, 'not_found');

    if (!isEditable(name)) {
        throw new ThemeError(
            `"${name}" is a built-in theme. Those stay put so there is always a working fallback.`,
            'not_editable'
        );
    }

    await fsPromises.rm(themeDir(name), { recursive: true, force: true });
    return { name };
}

module.exports = {
    THEMES_DIR,
    canvasSizeOf,
    PRESETS_DIR,
    listPresets,
    presetModel,
    MODULE_TYPES,
    TIME_TYPES,
    TEXT_TYPES,
    MODEL_VERSION,
    CARD_LIMIT,
    TRANSITIONS,
    AMBIENCES,
    LABEL_LIMIT,
    NEXT_LIMIT,
    LABEL_TOKENS,
    FONTS,
    FONT_CATEGORIES,
    googleFonts,
    googleFontsHref,
    ThemeError,
    defaultModel,
    defaultStack,
    stackOf,
    normalizeModel,
    generateCss,
    generateHtml,
    extraMarkup,
    previewHtml,
    iconCatalog,
    iconBody,
    listThemes,
    readModel,
    saveTheme,
    deleteTheme,
    themesWithRewardsOff,
    turnOnRewardsEverywhere,
    isEditable,
    exists
};
