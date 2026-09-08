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
const MODEL_VERSION = 2;
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
            return { type, hidden: false, x: 16, y: 16, w: 160, h: 160, radius: 24, shadow: 18, fit: 'cover' };
        case 'title':
            return {
                type, hidden: false, x: 200, y: 46, w: 456, h: 36,
                font: 'system', fontSize: 26, fontWeight: 700, color: '#ffffff',
                letterSpacing: 0, align: 'left', opacity: 1,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000'
            };
        case 'artist':
            return {
                type, hidden: false, x: 200, y: 88, w: 456, h: 26,
                font: 'system', fontSize: 17, fontWeight: 500, color: 'var(--album-light)',
                letterSpacing: 0, align: 'left', opacity: 0.85,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000'
            };
        case 'progress':
            return {
                type, hidden: false, x: 246, y: 132, w: 364, h: 6,
                radius: 999, trackColor: 'rgba(255,255,255,0.18)', fillColor: 'var(--album-vibrant)'
            };
        // The clocks sit level with the middle of the bar rather than under
        // it: 0:04 [========] 3:07 is the shape people already know.
        case 'elapsed':
            return {
                type, hidden: false, x: 200, y: 124, w: 40, h: 22,
                font: 'system', fontSize: 12, fontWeight: 600, color: 'var(--album-light)',
                letterSpacing: 0, align: 'right', opacity: 0.75,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000'
            };
        case 'duration':
            return {
                type, hidden: false, x: 616, y: 124, w: 40, h: 22,
                font: 'system', fontSize: 12, fontWeight: 600, color: 'var(--album-light)',
                letterSpacing: 0, align: 'left', opacity: 0.75,
                uppercase: false, italic: false, glow: 0, glowColor: 'var(--album-vibrant)',
                outline: 0, outlineColor: '#000000'
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
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            padding: 0
        },
        modules: MODULE_TYPES.map(defaultModule),
        properties: {
            media: { mode: 'canvas' },
            showProgress: true,
            updateInterval: 5000,
            hideAfter: 5,
            scroll: { enabled: true, speed: 70, pauseDuration: 7 }
        }
    };
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
        borderWidth: Math.round(number(canvasIn.borderWidth, base.canvas.borderWidth, 0, 12)),
        borderColor: color(canvasIn.borderColor, base.canvas.borderColor),
        padding: Math.round(number(canvasIn.padding, base.canvas.padding, 0, 200))
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
                shadow: Math.round(number(module.shadow, fallback.shadow, 0, 80)),
                fit: pick(module.fit, ['cover', 'contain'], fallback.fit)
            };
        }

        if (type === 'progress') {
            return {
                ...common,
                radius: Math.round(number(module.radius, fallback.radius, 0, 999)),
                trackColor: color(module.trackColor, fallback.trackColor),
                fillColor: color(module.fillColor, fallback.fillColor)
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
            outlineColor: color(module.outlineColor, fallback.outlineColor)
        };
    });

    const propsIn = raw.properties || {};
    const scrollIn = propsIn.scroll || {};

    const properties = {
        media: { mode: pick(propsIn.media?.mode, ['canvas', 'cover'], 'canvas') },
        showProgress: propsIn.showProgress !== false,
        // Fade the widget out while playback is paused rather than leaving a
        // frozen progress bar on screen.
        hideWhenPaused: propsIn.hideWhenPaused !== false,
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

function textRules(selector, module) {
    // The glow is a filter on the box, not a text-shadow on the text: the box
    // clips its overflow so long titles can scroll, and a shadow inside it gets
    // sliced into a hard-edged rectangle. A filter paints outside the box.
    const glow = module.glow
        ? `\n    filter: drop-shadow(0 0 ${module.glow}px ${module.glowColor}) drop-shadow(0 0 ${Math.round(module.glow / 2)}px ${module.glowColor});`
        : '';

    // -webkit-text-stroke centres the stroke on the glyph edge, so half of it
    // eats into the letter. `paint-order` puts the stroke down first and the
    // fill over the top, which is what an outline is meant to look like -
    // otherwise a 3px outline visibly thins the text it is protecting.
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
    overflow: hidden;${glow}
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
 */
function fadeRules() {
    const mask = 'linear-gradient(to right, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%)';

    return `

/* Soft edges, but only while a line is scrolling. */

.title-wrapper.scrolling,
.artist-wrapper.scrolling {
    -webkit-mask-image: ${mask};
    mask-image: ${mask};
}
`;
}

/** A flat color, or the two-stop gradient the editor offers. */
function canvasBackground(canvas) {
    if (canvas.backgroundMode !== 'gradient') return canvas.background;
    return `linear-gradient(${canvas.gradientAngle}deg, ${canvas.background}, ${canvas.backgroundTo})`;
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
    border-radius: ${canvas.radius}px;

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

/* Album art / Canvas video */

.cover,
.canvas {
    position: absolute;
${box(art)}
    object-fit: ${art.fit};
    border-radius: ${art.radius}px;
    box-shadow: 0 ${Math.round(art.shadow / 2)}px ${art.shadow}px rgba(0, 0, 0, .38);
    ${art.hidden ? 'display: none !important;' : ''}
}

/* Title */

${textRules('.title-wrapper', title)}

.title-container {
    width: 100%;
    overflow: hidden;
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

.progress-container {
    position: absolute;
${box(progress)}
    background: ${progress.trackColor};
    border-radius: ${progress.radius}px;
    overflow: hidden;
    ${progress.hidden ? 'display: none;' : ''}
}

.progress {
    width: 0%;
    height: 100%;
    background: ${progress.fillColor};
    border-radius: inherit;
    transition: width .25s linear;
}

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
${fadeRules()}`;
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
            <div class="progress"></div>
        </div>

        <div class="elapsed-wrapper">
            <div class="elapsed"></div>
        </div>

        <div class="duration-wrapper">
            <div class="duration"></div>
        </div>
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
    listThemes,
    readModel,
    saveTheme,
    deleteTheme,
    isEditable,
    exists
};
