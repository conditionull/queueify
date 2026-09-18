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
const MODEL_VERSION = 7;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

// The modules the widget runtime knows how to fill. They are always present in
// a generated theme - hiding one is a flag, not a deletion, so the elements
// app.js queries never go missing.
const MODULE_TYPES = ['art', 'title', 'artist', 'progress', 'elapsed', 'duration'];

// The two clocks either side of the bar: how far into the song you are, and
// how long it runs for. app.js writes the text; they are otherwise ordinary
// text modules, so they get the same fonts, colors and outline as the title.
const TIME_TYPES = ['elapsed', 'duration'];

// Everything that is text, and so takes the text settings below.
const TEXT_TYPES = ['title', 'artist', ...TIME_TYPES];

/* ------------------------------------------------------------- icons */

/**
 * Lucide, read straight out of the installed package.
 *
 * Only the shapes inside <svg> are kept. The wrapper is written fresh by the
 * generator so the size, colour and stroke width come from the theme rather
 * than from whatever the file happened to ship with - Lucide draws every icon
 * with `stroke="currentColor"`, which is exactly what lets a theme point one
 * at `var(--album-vibrant)` and have it re-tint with the artwork.
 *
 * ISC, with a subset inherited from Feather under MIT. Both notices ship in
 * node_modules/lucide-static/LICENSE, which is what either licence asks for.
 */
const LUCIDE_DIR = process.env.QUEUEIFY_LUCIDE_DIR
    || path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');

// At most this many on one theme. A widget is 680x192; past a dozen the
// theme is not a widget any more, and the cap keeps a hand-written
// theme.json from asking the generator to inline a megabyte of paths.
const ICON_LIMIT = 12;

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
function iconCatalogue() {
    let tags = {};
    try {
        tags = require(path.join(LUCIDE_DIR, '..', 'tags.json'));
    } catch (err) {
        tags = {};
    }

    return [...iconNames()].sort().map(name => ({ name, tags: tags[name] || [] }));
}

const CANVAS_LIMITS = { width: [120, 1920], height: [40, 1080] };

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
    'playfair-display': { label: 'Playfair Display', category: 'Serif', family: 'Playfair Display', google: true, stack: '"Playfair Display", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700, 800, 900] },
    'lora': { label: 'Lora', category: 'Serif', family: 'Lora', google: true, stack: '"Lora", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700] },
    'bitter': { label: 'Bitter', category: 'Serif', family: 'Bitter', google: true, stack: '"Bitter", Georgia, "Times New Roman", serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'fraunces': { label: 'Fraunces', category: 'Serif', family: 'Fraunces', google: true, stack: '"Fraunces", Georgia, "Times New Roman", serif', weights: [300, 400, 500, 600, 700, 800, 900] },
    'bodoni-moda': { label: 'Bodoni Moda', category: 'Serif', family: 'Bodoni Moda', google: true, stack: '"Bodoni Moda", Georgia, "Times New Roman", serif', weights: [400, 500, 600, 700, 800, 900] },
    'jetbrains-mono': { label: 'JetBrains Mono', category: 'Mono', family: 'JetBrains Mono', google: true, stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700, 800] },
    'space-mono': { label: 'Space Mono', category: 'Mono', family: 'Space Mono', google: true, stack: '"Space Mono", ui-monospace, Menlo, Consolas, monospace', weights: [400, 700] },
    'ibm-plex-mono': { label: 'IBM Plex Mono', category: 'Mono', family: 'IBM Plex Mono', google: true, stack: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace', weights: [300, 400, 500, 600, 700] },
    'share-tech-mono': { label: 'Share Tech Mono', category: 'Mono', family: 'Share Tech Mono', google: true, stack: '"Share Tech Mono", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'vt323': { label: 'VT323', category: 'Mono', family: 'VT323', google: true, stack: '"VT323", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'press-start-2p': { label: 'Press Start 2P', category: 'Mono', family: 'Press Start 2P', google: true, stack: '"Press Start 2P", ui-monospace, Menlo, Consolas, monospace', weights: [400] },
    'pacifico': { label: 'Pacifico', category: 'Hand', family: 'Pacifico', google: true, stack: '"Pacifico", "Segoe Script", cursive', weights: [400] },
    'lobster': { label: 'Lobster', category: 'Hand', family: 'Lobster', google: true, stack: '"Lobster", "Segoe Script", cursive', weights: [400] },
    'caveat': { label: 'Caveat', category: 'Hand', family: 'Caveat', google: true, stack: '"Caveat", "Segoe Script", cursive', weights: [400, 500, 600, 700] },
    'permanent-marker': { label: 'Permanent Marker', category: 'Hand', family: 'Permanent Marker', google: true, stack: '"Permanent Marker", "Segoe Script", cursive', weights: [400] },
    'shadows-into-light': { label: 'Shadows Into Light', category: 'Hand', family: 'Shadows Into Light', google: true, stack: '"Shadows Into Light", "Segoe Script", cursive', weights: [400] },
    'satisfy': { label: 'Satisfy', category: 'Hand', family: 'Satisfy', google: true, stack: '"Satisfy", "Segoe Script", cursive', weights: [400] },
};

const FONT_CATEGORIES = {
    'Local': 'On your computer',
    'Display': 'Display',
    'Techno': 'Techno',
    'Sans': 'Sans serif',
    'Serif': 'Serif',
    'Mono': 'Monospace & pixel',
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

/* ------------------------------------------------- value sanitising */

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

    for (const module of model.modules) {
        if (!TEXT_TYPES.includes(module.type)) continue;
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
            return { type, hidden: false, x: 16, y: 16, w: 160, h: 160, radius: 24, corners: null, shadow: 18, fit: 'cover' };
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
                style: 'bar', bars: 48, barGap: 2, seed: 1
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
        properties: {
            media: { mode: 'canvas' },
            showProgress: true,
            updateInterval: 5000,
            hideAfter: 5,
            scroll: { enabled: true, speed: 70, pauseDuration: 7 }
        }
    };
}

/** The settings a freshly added icon starts with. */
function defaultIcon(name) {
    return {
        id: '', name, x: 24, y: 24, w: 32, h: 32,
        color: 'var(--album-light)', strokeWidth: 2, rotate: 0, opacity: 1, hidden: false
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
            opacity: number(item.opacity, fallback.opacity, 0, 1)
        });
    }

    return icons;
}

/**
 * Normalises whatever the editor sent into a model the generator can trust:
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

        const common = {
            type,
            hidden: missing && predatesTimes && TIME_TYPES.includes(type)
                ? true
                : Boolean(module.hidden),
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
                fit: pick(module.fit, ['cover', 'contain'], fallback.fit)
            };
        }

        if (type === 'progress') {
            return {
                ...common,
                radius: Math.round(number(module.radius, fallback.radius, 0, 999)),
                corners: corners(module.corners, 999),
                trackColor: color(module.trackColor, fallback.trackColor),
                fillColor: color(module.fillColor, fallback.fillColor),
                style: pick(module.style, ['bar', 'waveform'], fallback.style),
                // Enough bars to read as a waveform, few enough that the
                // generator is not writing hundreds of nth-child rules.
                bars: Math.round(number(module.bars, fallback.bars, 8, 96)),
                barGap: Math.round(number(module.barGap, fallback.barGap, 0, 12)),
                // The shape of the waveform, not the waveform itself. Heights
                // are worked out from this every time the theme is generated -
                // storing them instead would be storing a derived value, and
                // one that changes length the moment the bar count does.
                seed: Math.round(number(module.seed, fallback.seed, 1, 9999))
            };
        }

        const font = fontKey(module.font);

        return {
            ...common,
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
    });

    const propsIn = raw.properties || {};
    const scrollIn = propsIn.scroll || {};

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
        }
    };

    return {
        version: MODEL_VERSION,
        label: String(raw.label || base.label).slice(0, 60),
        canvas,
        modules,
        icons: normalizeIcons(raw.icons, canvas),
        properties
    };
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
 * `-webkit-text-stroke` is centred on the glyph edge, so half of a stroke is
 * drawn outside the letter - and the width written into the CSS is doubled
 * (see below), which puts that outer half exactly `outline` pixels past the
 * glyph. The box clips its overflow, so without room for it that half is
 * simply sliced off.
 */
function bleedOf(module) {
    return Math.ceil(module.outline || 0);
}

/**
 * The drop shadow step for a text module, or nothing if it has none.
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

    // -webkit-text-stroke centres the stroke on the glyph edge, so half of it
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
    justify-content: ${module.align === 'center' ? 'center' : module.align === 'right' ? 'flex-end' : 'flex-start'};
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
 * only touches colour, never alpha, so it darkens the artwork and leaves the
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
 * Colour is set on the wrapper rather than on the SVG, because Lucide draws
 * every shape with `stroke="currentColor"` - so one `color` reaches the whole
 * icon, and `var(--album-vibrant)` re-tints it with the artwork exactly the
 * way the text colours already do.
 *
 * Stroke width stays an attribute on the SVG instead: it is in the 24-unit
 * space of the viewBox, so the browser scales it with the icon. That is why a
 * large icon at width 1 still looks finer than a small one at 3.
 */
function iconRules(icons) {
    if (!icons.length) return '';

    const rules = icons.map(icon => `.icon-${icon.id} {
    position: absolute;
${box(icon)}
    z-index: 2;
    color: ${icon.color};
    opacity: ${icon.opacity};${icon.rotate ? `
    transform: rotate(${icon.rotate}deg);` : ''}
    ${icon.hidden ? 'display: none;' : ''}
}`).join('\n\n');

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

        // Weighted towards the swell so neighbours stay related, with enough
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
 * that means two identical rows of bars, one in the track colour and one in
 * the fill colour, with the fill row clipped by `.progress`. The fill row is
 * pinned to the full width of the box in pixels so its bars stay lined up
 * with the track's however far along the song is - a percentage would squash
 * them together as the clip narrowed.
 */
function progressRules(progress) {
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
    background: ${progress.fillColor};
    border-radius: inherit;
    transition: width .25s linear;
}`;
    }

    const heights = waveHeights(progress.bars, progress.seed);

    // One rule per bar, on both rows at once. The bars are centred on the
    // midline, the way a waveform is drawn.
    const bands = heights.map((height, at) =>
        `.wave > i:nth-child(${at + 1}) { height: ${Math.round(height * 100)}%; }`
    ).join('\n');

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
.wave.fill > i { background: ${progress.fillColor}; }

${bands}`;
}

function generateCss(model) {
    const { canvas } = model;
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

    background: ${canvas.hidden ? 'transparent' : canvasBackground(canvas)};
    border: ${canvas.hidden ? 0 : canvas.borderWidth}px solid ${canvas.borderColor};
    border-radius: ${radiusCss(canvas)};

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

${veilRules(canvas)}
/* Album art / Canvas video */

.cover,
.canvas {
    position: absolute;
${box(art)}
    z-index: 0;
    object-fit: ${art.fit};
    border-radius: ${radiusCss(art)};
    box-shadow: 0 ${Math.round(art.shadow / 2)}px ${art.shadow}px rgba(0, 0, 0, .38);
    ${art.hidden ? 'display: none !important;' : ''}
}

/* Title */

${textRules('.title-wrapper', title)}

/* No clip of its own: the wrapper above already cuts at the right place, and
   this box is only as tall as one line of text - tight enough to shave the top
   and bottom off an outline before the wrapper ever saw it. */

.title-container {
    width: 100%;
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
${fadeRules(model)}${iconRules(model.icons || [])}`;
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
    <div class="widget">
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
        </div>${iconMarkup(model ? model.icons || [] : [])}
    </div>

    <script src="/app.js"></script>
</body>

</html>
`;
}

/**
 * Somewhere to start. A blank canvas is the least helpful thing to hand
 * someone, so "New" offers finished layouts to pull apart instead.
 */
const PRESETS = {
    classic: {
        label: 'Classic',
        description: 'Square art on the left, title and artist stacked beside it.',
        build: () => defaultModel('Classic')
    },

    spotlight: {
        label: 'Spotlight',
        description: 'Big art, glowing title, gradient behind it all.',
        build: () => {
            const model = defaultModel('Spotlight');

            Object.assign(model.canvas, {
                width: 720, height: 220, radius: 26,
                backgroundMode: 'gradient',
                background: 'var(--album-dark)',
                backgroundTo: 'var(--album-vibrant)',
                gradientAngle: 120,
                borderWidth: 0
            });

            Object.assign(moduleOf(model, 'art'), { x: 20, y: 20, w: 180, h: 180, radius: 18, shadow: 34 });
            Object.assign(moduleOf(model, 'title'), {
                x: 222, y: 48, w: 476, h: 44, fontSize: 32, fontWeight: 800,
                glow: 18, glowColor: 'var(--album-light)'
            });
            Object.assign(moduleOf(model, 'artist'), { x: 222, y: 98, w: 476, h: 28, fontSize: 18, opacity: 0.9 });
            Object.assign(moduleOf(model, 'progress'), { x: 272, y: 150, w: 376, h: 8, fillColor: 'var(--album-light)' });
            Object.assign(moduleOf(model, 'elapsed'), { x: 222, y: 143, w: 42, h: 22, fontSize: 13 });
            Object.assign(moduleOf(model, 'duration'), { x: 656, y: 143, w: 42, h: 22, fontSize: 13 });

            return model;
        }
    },

    ticker: {
        label: 'Ticker',
        description: 'A slim strip: small art, one line of text, thin bar.',
        build: () => {
            const model = defaultModel('Ticker');

            Object.assign(model.canvas, {
                width: 560, height: 84, radius: 12, borderWidth: 0,
                background: 'rgba(10,10,14,0.86)'
            });

            Object.assign(moduleOf(model, 'art'), { x: 10, y: 10, w: 64, h: 64, radius: 8, shadow: 8 });
            Object.assign(moduleOf(model, 'title'), {
                x: 86, y: 14, w: 460, h: 26, fontSize: 18, fontWeight: 700, letterSpacing: 0.5
            });
            Object.assign(moduleOf(model, 'artist'), { x: 86, y: 40, w: 460, h: 20, fontSize: 13, opacity: 0.75 });
            Object.assign(moduleOf(model, 'progress'), { x: 122, y: 64, w: 388, h: 4 });
            Object.assign(moduleOf(model, 'elapsed'), { x: 86, y: 57, w: 32, h: 18, fontSize: 11 });
            Object.assign(moduleOf(model, 'duration'), { x: 514, y: 57, w: 32, h: 18, fontSize: 11 });

            return model;
        }
    },

    stacked: {
        label: 'Stacked',
        description: 'Art on top, centerd text underneath - good for a corner.',
        build: () => {
            const model = defaultModel('Stacked');

            Object.assign(model.canvas, { width: 300, height: 400, radius: 20 });

            Object.assign(moduleOf(model, 'art'), { x: 30, y: 26, w: 240, h: 240, radius: 16, shadow: 26 });
            Object.assign(moduleOf(model, 'title'), {
                x: 20, y: 288, w: 260, h: 32, fontSize: 21, align: 'center'
            });
            Object.assign(moduleOf(model, 'artist'), {
                x: 20, y: 322, w: 260, h: 24, fontSize: 15, align: 'center', opacity: 0.8
            });
            Object.assign(moduleOf(model, 'progress'), { x: 40, y: 358, w: 220, h: 6 });
            // 300px across is too narrow to flank a bar and still read, so
            // these tuck under its ends instead.
            Object.assign(moduleOf(model, 'elapsed'), { x: 40, y: 368, w: 46, h: 18, fontSize: 12, align: 'left' });
            Object.assign(moduleOf(model, 'duration'), { x: 214, y: 368, w: 46, h: 18, fontSize: 12, align: 'right' });

            return model;
        }
    }
};

function listPresets() {
    return Object.entries(PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        description: preset.description,
        model: normalizeModel(preset.build())
    }));
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
    PRESETS,
    listPresets,
    MODULE_TYPES,
    TIME_TYPES,
    TEXT_TYPES,
    MODEL_VERSION,
    FONTS,
    FONT_CATEGORIES,
    googleFonts,
    googleFontsHref,
    ThemeError,
    defaultModel,
    normalizeModel,
    generateCss,
    generateHtml,
    iconCatalogue,
    iconBody,
    listThemes,
    readModel,
    saveTheme,
    deleteTheme,
    isEditable,
    exists
};
