/*
 * Viewer rewards: the effects a viewer's song starts with, the milestone
 * takeover, and a theme's ambience. See services/perks.js for who gets what.
 *
 * One file with no dependencies, because four pages draw with it: the widget
 * on stream, the editor's and the admin page's previews, and the public page
 * viewers pick their effect on (queueify-site, public/fx/effects.js - a copy
 * of this file; copy it again when it changes).
 *
 * Everything is drawn on a layer laid over a host element and removed once
 * it has played, so nothing runs between songs - except ambience, which a
 * theme asks for, and which only runs while music plays. The widget's host is
 * the page itself, which is exactly the OBS source: nothing can be drawn
 * outside it.
 *
 * Some effects move the widget's own parts. They do it with animations
 * layered on top of whatever the theme already does, never by changing the
 * parts themselves, so when an effect ends - or is stopped half way - every
 * part is exactly where it was.
 *
 * The Glow effects are drawn with textures from Particle Pack by Kenney Vleugels (Kenney.nl, CC0),
 * kept as white masks in fx-textures/ beside this file and tinted to the
 * effect's colors. scripts/build-fx-textures.js makes them.
 *
 *   QueueifyFx.play(name, { host, target, from, colors, power, scale, style })
 *   QueueifyFx.milestone({ number, name }, { host, target, colors, font, seconds })
 *   QueueifyFx.ambience(style, { host, target, colors, palette, amount, speed, scale })
 */
(function () {
    'use strict';

    // The textures live in fx-textures/, beside this file - which is
    // /effects.js on the widget and the dashboard, and /fx/effects.js on the
    // docs site. Worked out once, while the script is running.
    const TEXTURE_BASE = (() => {
        try {
            return new URL('fx-textures/', document.currentScript.src).href;
        } catch {
            return 'fx-textures/';
        }
    })();

    // group: what kind of effect it is, for the lists people pick from.
    //   burst  - particles, all over the widget
    //   widget - moves or changes the widget's own parts
    //   light  - light drawn over and around the widget
    //   glow   - soft light, drifting and glinting, from textures
    //   magic  - spells: circles, portals, cuts, and blasts, from textures
    const EFFECTS = [
        { name: 'sparkles', label: 'Sparkles', group: 'burst' },
        { name: 'stars', label: 'Stars', group: 'burst' },
        { name: 'confetti', label: 'Confetti', group: 'burst' },
        { name: 'hearts', label: 'Hearts', group: 'burst' },
        { name: 'notes', label: 'Notes', group: 'burst' },
        { name: 'fireworks', label: 'Fireworks', group: 'burst' },
        { name: 'pixels', label: 'Pixels', group: 'burst' },
        { name: 'coins', label: 'Coins', group: 'burst' },
        { name: 'embers', label: 'Embers', group: 'burst' },
        { name: 'bubbles', label: 'Bubbles', group: 'burst' },
        { name: 'petals', label: 'Petals', group: 'burst' },
        { name: 'scatter', label: 'Scatter', group: 'widget' },
        { name: 'wave', label: 'Wave', group: 'widget' },
        { name: 'jelly', label: 'Jelly', group: 'widget' },
        { name: 'glitch', label: 'Glitch', group: 'widget' },
        { name: 'heartbeat', label: 'Heartbeat', group: 'widget' },
        { name: 'spotlight', label: 'Spotlight', group: 'widget' },
        { name: 'comet', label: 'Comet', group: 'light' },
        { name: 'neon', label: 'Neon trace', group: 'light' },
        { name: 'warp', label: 'Warp', group: 'light' },
        { name: 'aurora', label: 'Aurora', group: 'light' },
        { name: 'scanline', label: 'Scanline', group: 'light' },
        { name: 'lightning', label: 'Lightning', group: 'light' },
        { name: 'supernova', label: 'Supernova', group: 'light' },
        { name: 'vortex', label: 'Vortex', group: 'light' },
        { name: 'bokeh', label: 'Bokeh', group: 'glow' },
        { name: 'glimmer', label: 'Glimmer', group: 'glow' },
        { name: 'fairy', label: 'Fairy dust', group: 'glow' },
        { name: 'mist', label: 'Mist', group: 'glow' },
        { name: 'shine', label: 'Shine', group: 'glow' },
        { name: 'flare', label: 'Lens flare', group: 'glow' },
        { name: 'halo', label: 'Halo', group: 'glow' },
        { name: 'glitter', label: 'Glitter', group: 'glow' },
        { name: 'wisps', label: 'Wisps', group: 'glow' },
        { name: 'love', label: 'Love', group: 'glow' },
        { name: 'starfall', label: 'Starfall', group: 'glow' },
        { name: 'fountain', label: 'Fountain', group: 'glow' },
        { name: 'bloom', label: 'Bloom', group: 'glow' },
        { name: 'ripple', label: 'Ripple', group: 'magic' },
        { name: 'rune', label: 'Rune', group: 'magic' },
        { name: 'blaze', label: 'Blaze', group: 'magic' },
        { name: 'meteors', label: 'Meteors', group: 'magic' },
        { name: 'swirl', label: 'Swirl', group: 'magic' },
        { name: 'portal', label: 'Portal', group: 'magic' },
        { name: 'poof', label: 'Poof', group: 'magic' },
        { name: 'crackle', label: 'Crackle', group: 'magic' },
        { name: 'slash', label: 'Slash', group: 'magic' },
        { name: 'impact', label: 'Impact', group: 'magic' }
    ];

    const GROUPS = [
        { name: 'burst', label: 'Bursts' },
        { name: 'widget', label: 'The widget itself' },
        { name: 'light', label: 'Light shows' },
        { name: 'glow', label: 'Glow' },
        { name: 'magic', label: 'Magic' }
    ];

    // Colors an effect can be drawn in. `album` follows the song playing;
    // the rest are fixed sets, for a streamer (or a sub) who wants a look
    // that is theirs whatever is on.
    const PALETTES = [
        { name: 'album', label: 'Album' },
        { name: 'rainbow', label: 'Rainbow' },
        { name: 'gold', label: 'Gold', stops: ['#fff3c4', '#ffd24a', '#f0a000'] },
        { name: 'silver', label: 'Silver', stops: ['#ffffff', '#dfe6f2', '#9fb0c8'] },
        { name: 'ice', label: 'Ice', stops: ['#e6fcff', '#7fe7ff', '#3a9dff'] },
        { name: 'fire', label: 'Fire', stops: ['#fff2a8', '#ffa200', '#ff4a1c'] },
        { name: 'candy', label: 'Candy', stops: ['#ffd1ec', '#ff7ac6', '#a98bff'] },
        { name: 'neon', label: 'Neon', stops: ['#d6ffe9', '#2dff9a', '#00d9ff', '#ff3df2'] },
        { name: 'sunset', label: 'Sunset', stops: ['#ffe29a', '#ff8a5c', '#ff4f8b'] }
    ];

    const AMBIENCES = [
        { name: 'none', label: 'None' },
        { name: 'embers', label: 'Embers' },
        { name: 'snow', label: 'Snow' },
        { name: 'petals', label: 'Petals' },
        { name: 'bokeh', label: 'Bokeh' },
        { name: 'fireflies', label: 'Fireflies' },
        { name: 'motes', label: 'Dust motes' },
        { name: 'fog', label: 'Fog' },
        { name: 'twinkle', label: 'Starlight' }
    ];

    const TAU = Math.PI * 2;
    const rand = (min, max) => min + Math.random() * (max - min);
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    const easeIn = t => Math.pow(clamp(t, 0, 1), 3);
    const easeInOut = t => {
        t = clamp(t, 0, 1);
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    /* ----------------------------------------------------------- colors */

    let probe = null;

    /** Any CSS color, as { r, g, b }. Falls back to white. */
    function parse(color) {
        if (!probe) probe = document.createElement('canvas').getContext('2d');
        probe.fillStyle = '#fff';
        probe.fillStyle = String(color || '#fff');
        const value = probe.fillStyle;

        if (value[0] === '#') {
            return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
        }

        const [r, g, b] = value.match(/[\d.]+/g).map(Number);
        return { r, g, b };
    }

    function toHsl({ r, g, b }) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l };

        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return { h: h * 60, s, l };
    }

    const hsl = ({ h, s, l }, alpha = 1) =>
        `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(clamp(s, 0, 1) * 100)}%, ${Math.round(clamp(l, 0, 1) * 100)}%, ${alpha})`;

    const lighter = (c, by) => ({ ...c, l: clamp(c.l + by, 0, 0.97) });
    const WHITE = { h: 0, s: 0, l: 1 };

    /**
     * The colors to draw with.
     *
     * Album palettes are often muddy or near black, which vanish as particles;
     * each is kept to its hue and brought to a lightness and saturation that
     * glows. A named palette is drawn as it was designed.
     */
    function palette(colors = {}, name = 'album') {
        const dark = toHsl(parse(colors.dark || '#141419'));
        const chosen = PALETTES.find(entry => entry.name === name);

        if (name === 'rainbow') {
            const spread = [0, 45, 150, 200, 265, 320].map(h => ({ h, s: 0.95, l: 0.64 }));
            return { base: spread[4], light: { h: 0, s: 0, l: 0.97 }, spread, dark, named: true };
        }

        if (chosen && chosen.stops) {
            const stops = chosen.stops.map(stop => toHsl(parse(stop)));
            return { base: stops[1], light: stops[0], spread: stops.slice(1).concat(stops[0]), dark, named: true };
        }

        const vibrant = toHsl(parse(colors.vibrant || '#7b8cff'));
        const light = toHsl(parse(colors.light || '#ffffff'));
        const lift = (c, l = [0.58, 0.78], s = 0.75) => ({ h: c.h, s: Math.max(c.s, c.s < 0.08 ? 0 : s), l: clamp(c.l, l[0], l[1]) });

        const base = lift(vibrant);
        const soft = lift(light, [0.78, 0.94], 0.6);
        return {
            base,
            light: soft,
            // Two neighbors on the wheel, for effects that want variety.
            spread: [base, { ...base, h: base.h + 38 }, { ...base, h: base.h - 38 }, soft],
            dark,
            named: false
        };
    }

    /* ---------------------------------------------------------- sprites */

    const glows = new Map();
    // Each is 16KB, and shades change with every song's album - over a long
    // stream an unbounded list of them only grows. The most recent 256 stay.
    const GLOWS_KEPT = 256;

    /** A soft round glow in one color, drawn once and stamped from then on. */
    function glow(color) {
        const kept = glows.get(color);
        if (kept) {
            glows.delete(color);
            glows.set(color, kept);
            return kept;
        }
        if (glows.size >= GLOWS_KEPT) glows.delete(glows.keys().next().value);

        const size = 64;
        const sprite = document.createElement('canvas');
        sprite.width = sprite.height = size;
        const ctx = sprite.getContext('2d');
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.35)'));
        gradient.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        glows.set(color, sprite);
        return sprite;
    }

    function stamp(ctx, color, radius, alpha) {
        if (radius <= 0 || alpha <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(glow(hsl(color, 1)), -radius, -radius, radius * 2, radius * 2);
    }

    /** A glow at the effect's middle, for scenes. */
    function stampAt(ctx, x, y, color, radius, alpha) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(x, y);
        stamp(ctx, color, radius, alpha);
        ctx.restore();
    }

    /**
     * A light trail through a particle's last positions: thin and faint at
     * the tail, full at the head. Drawn in the layer's own coordinates.
     */
    function streak(ctx, points, width, color, alpha) {
        if (!points || points.length < 2 || alpha <= 0) return;
        ctx.lineCap = 'round';
        for (let i = 1; i < points.length; i++) {
            const t = i / (points.length - 1);
            ctx.globalAlpha = alpha * t * t;
            ctx.strokeStyle = hsl(color);
            ctx.lineWidth = Math.max(0.5, width * t);
            ctx.beginPath();
            ctx.moveTo(points[i - 1].x, points[i - 1].y);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
        }
    }

    /* ----------------------------------------------------------- shapes */

    function starPath(ctx, points, outer, inner) {
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 ? inner : outer;
            const angle = (i / (points * 2)) * TAU - Math.PI / 2;
            ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
    }

    /** A four-point twinkle: long thin rays, pinched in the middle. */
    function twinklePath(ctx, length, width) {
        ctx.beginPath();
        ctx.moveTo(0, -length);
        ctx.quadraticCurveTo(width * 0.35, -width * 0.35, length, 0);
        ctx.quadraticCurveTo(width * 0.35, width * 0.35, 0, length);
        ctx.quadraticCurveTo(-width * 0.35, width * 0.35, -length, 0);
        ctx.quadraticCurveTo(-width * 0.35, -width * 0.35, 0, -length);
        ctx.closePath();
    }

    function heartPath(ctx, size) {
        const s = size / 2;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.9);
        ctx.bezierCurveTo(-s * 1.6, -s * 0.1, -s * 0.85, -s * 1.25, 0, -s * 0.45);
        ctx.bezierCurveTo(s * 0.85, -s * 1.25, s * 1.6, -s * 0.1, 0, s * 0.9);
        ctx.closePath();
    }

    function petalPath(ctx, size) {
        const s = size / 2;
        ctx.beginPath();
        ctx.moveTo(0, s);
        ctx.bezierCurveTo(-s * 0.9, s * 0.4, -s * 0.75, -s * 0.7, -s * 0.18, -s);
        // The notch at the tip is what makes it a cherry petal and not a leaf.
        ctx.lineTo(0, -s * 0.78);
        ctx.lineTo(s * 0.18, -s);
        ctx.bezierCurveTo(s * 0.75, -s * 0.7, s * 0.9, s * 0.4, 0, s);
        ctx.closePath();
    }

    /** A note head with its stem: one for ♪, two joined by a beam for ♫. */
    function notePath(ctx, size, beamed) {
        const head = size * 0.26;
        const stem = size * 0.95;

        const noteAt = x => {
            ctx.save();
            ctx.translate(x, size * 0.3);
            ctx.rotate(-0.45);
            ctx.beginPath();
            ctx.ellipse(0, 0, head * 1.25, head * 0.9, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
            ctx.fillRect(x + head * 0.95, size * 0.3 - stem, size * 0.085, stem);
        };

        if (beamed) {
            noteAt(-size * 0.32);
            noteAt(size * 0.32);
            ctx.beginPath();
            const left = -size * 0.32 + head * 0.95, right = size * 0.32 + head * 0.95 + size * 0.085;
            ctx.moveTo(left, size * 0.3 - stem);
            ctx.lineTo(right, size * 0.3 - stem - size * 0.12);
            ctx.lineTo(right, size * 0.3 - stem + size * 0.1);
            ctx.lineTo(left, size * 0.3 - stem + size * 0.22);
            ctx.closePath();
            ctx.fill();
        } else {
            noteAt(0);
            // The flag.
            const x = head * 0.95 + size * 0.085, top = size * 0.3 - stem;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.bezierCurveTo(x + size * 0.05, top + size * 0.25, x + size * 0.42, top + size * 0.28, x + size * 0.26, top + size * 0.62);
            ctx.bezierCurveTo(x + size * 0.3, top + size * 0.36, x + size * 0.08, top + size * 0.3, x, top + size * 0.24);
            ctx.closePath();
            ctx.fill();
        }
    }

    function roundedBox(ctx, box, r) {
        ctx.beginPath();
        const radius = Math.max(0, Math.min(r || 0, box.w / 2, box.h / 2));
        if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, radius);
        else ctx.rect(box.x, box.y, box.w, box.h);
    }

    /** A point `s` along the outline of a rounded box, clockwise from its top left. */
    function perimeter(box) {
        const r = Math.max(0, Math.min(box.r || 0, box.w / 2, box.h / 2));
        const sw = Math.max(0, box.w - 2 * r), sh = Math.max(0, box.h - 2 * r), arc = Math.PI * r / 2;
        const lengths = [sw, arc, sh, arc, sw, arc, sh, arc];
        const total = lengths.reduce((a, b) => a + b, 0) || 1;
        const { x, y, w, h } = box;

        const at = s => {
            s = ((s % total) + total) % total;
            let i = 0;
            while (i < 7 && s > lengths[i]) s -= lengths[i++];
            const angle = start => start + (r ? s / r : 0);
            switch (i) {
                case 0: return { x: x + r + s, y };
                case 1: { const a = angle(-Math.PI / 2); return { x: x + w - r + Math.cos(a) * r, y: y + r + Math.sin(a) * r }; }
                case 2: return { x: x + w, y: y + r + s };
                case 3: { const a = angle(0); return { x: x + w - r + Math.cos(a) * r, y: y + h - r + Math.sin(a) * r }; }
                case 4: return { x: x + w - r - s, y: y + h };
                case 5: { const a = angle(Math.PI / 2); return { x: x + r + Math.cos(a) * r, y: y + h - r + Math.sin(a) * r }; }
                case 6: return { x, y: y + h - r - s };
                default: { const a = angle(Math.PI); return { x: x + r + Math.cos(a) * r, y: y + r + Math.sin(a) * r }; }
            }
        };

        return { at, total };
    }

    /** A jagged line from one point to another, for lightning. */
    function jag(x1, y1, x2, y2, rough) {
        let points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
        let amount = rough;
        for (let depth = 0; depth < 5; depth++) {
            const next = [points[0]];
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i];
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
                const off = rand(-1, 1) * amount * len;
                next.push({ x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off }, b);
            }
            points = next;
            amount *= 0.62;
        }
        return points;
    }

    /* ------------------------------------------------------- placement */

    // Particles fill the whole widget, not just the album art: a burst goes
    // off from a few points spread across it, one after another, and the
    // rest appears anywhere on it.

    /** Anywhere inside the widget. */
    const anywhere = env => ({ x: env.box.x + rand(0.03, 0.97) * env.box.w, y: env.box.y + rand(0.05, 0.95) * env.box.h });

    /** Somewhere along one edge of the widget, just outside it. */
    const alongBottom = (env, out = 6) => ({ x: env.box.x + rand(0.02, 0.98) * env.box.w, y: env.box.y + env.box.h + out * env.u });
    const alongTop = (env, out = 6) => ({ x: env.box.x + rand(0.02, 0.98) * env.box.w, y: env.box.y - out * env.u });

    /** One of the points a burst goes off from, with when it goes off. */
    const emitter = env => pick(env.emitters);

    /* ---------------------------------------------------------- effects */

    // Every effect: how many particles at each power, over how long they are
    // let out, how each one starts, moves, and is drawn, and whether they add
    // light ('lighter') or paint over each other.
    //
    // Sizes are in `u`, a unit that follows the widget's height, so a slim
    // banner theme gets small particles and a tall card gets big ones. Speeds
    // follow `R`, half the widget's diagonal, so a burst reaches its edges
    // whatever its shape.
    //
    // `trail` keeps that many past positions on each particle, for effects
    // drawn as streaks of light. `scene` draws what belongs to the whole
    // effect rather than one particle, and `last` keeps it going that long
    // even with no particles left. `moves` animates the widget's own parts.

    // How much of a particle's life is spent fading out.
    const FADE = 0.35;

    const fade = p => {
        const t = p.age / p.life;
        return clamp(p.age / 0.08, 0, 1) * clamp((1 - t) / FADE, 0, 1);
    };

    const radial = (env, min, max) => {
        const angle = rand(0, TAU);
        const speed = env.R * (min + (max - min) * Math.pow(Math.random(), 0.7));
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
    };

    const drag = (p, dt, k) => {
        const f = Math.exp(-k * dt);
        p.vx *= f;
        p.vy *= f;
    };

    /** An expanding ring of light around a point, drawn by a scene. */
    function ring(ctx, env, at, duration, reach, width, color, x = env.ox, y = env.oy) {
        const t = (env.t - at) / duration;
        if (t < 0 || t >= 1) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.75 * (1 - t);
        ctx.strokeStyle = hsl(color);
        ctx.lineWidth = Math.max(0.5, width * env.u * (1 - t));
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, reach * easeOut(t)), 0, TAU);
        ctx.stroke();
    }

    function flash(ctx, env, at, duration, reach, strength, x = env.ox, y = env.oy) {
        const t = (env.t - at) / duration;
        if (t < 0 || t >= 1) return;
        const radius = Math.max(1, reach * (0.35 + 0.65 * t));
        const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, hsl(WHITE, strength * (1 - t)));
        g.addColorStop(0.25, hsl(env.pal.light, strength * 0.6 * (1 - t)));
        g.addColorStop(1, hsl(env.pal.base, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    /** Animate one of the widget's parts, on top of whatever it is doing already. */
    function nudge(env, element, keyframes, options, composite = 'add') {
        if (!element || !element.animate) return null;
        const animation = element.animate(keyframes, { composite, fill: 'none', ...options });
        animation.playbackRate = env.speed;
        env.animations.push(animation);
        return animation;
    }

    /** A small spark, for the moments a part lands or a bolt strikes. */
    function drawSpark(ctx, p, a) {
        stamp(ctx, p.color, p.size * 3, a * 0.7);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.45, 0, TAU);
        ctx.fill();
    }

    /* --------------------------------------------------------- textures */

    const textures = new Map();
    const TINTS_KEPT = 12;

    /** Loads textures once and keeps them. Resolves false if any cannot be had. */
    function loadTextures(names) {
        return Promise.all(names.map(name => {
            if (!textures.has(name)) {
                const img = new Image();
                const ready = new Promise(resolve => {
                    img.onload = () => resolve(true);
                    img.onerror = () => resolve(false);
                });
                img.src = TEXTURE_BASE + name + '.png';
                textures.set(name, { img, ready, tints: new Map() });
            }
            return textures.get(name).ready;
        })).then(all => all.every(Boolean));
    }

    // Each color's name, worked out once: tinted() is asked for one on every
    // texture drawn, hundreds of times a frame.
    const colorKeys = new WeakMap();

    /** A texture in one color: made once per color, and stamped from then on. */
    function tinted(name, color) {
        const entry = textures.get(name);
        if (!entry || !entry.img.naturalWidth) return null;

        let key = colorKeys.get(color);
        if (!key) {
            key = hsl(color, 1);
            colorKeys.set(color, key);
        }
        let canvas = entry.tints.get(key);
        if (canvas) {
            // Most recently used last, so the one let go below is the stalest.
            entry.tints.delete(key);
            entry.tints.set(key, canvas);
        } else {
            // Every song brings new album colors. A widget runs for hours, and
            // each copy is up to a quarter of a megabyte, so only the dozen
            // most recent are kept - a song's effects use about six.
            if (entry.tints.size >= TINTS_KEPT) entry.tints.delete(entry.tints.keys().next().value);
            canvas = document.createElement('canvas');
            canvas.width = entry.img.naturalWidth;
            canvas.height = entry.img.naturalHeight;
            const c = canvas.getContext('2d');
            c.drawImage(entry.img, 0, 0);
            c.globalCompositeOperation = 'source-in';
            c.fillStyle = key;
            c.fillRect(0, 0, canvas.width, canvas.height);
            entry.tints.set(key, canvas);
        }
        return canvas;
    }

    /**
     * A texture centered on the origin, `size` wide and `stretch` times as
     * tall. Nothing is drawn until it has loaded.
     */
    function texture(ctx, name, color, size, alpha, stretch = 1) {
        if (!(size > 0) || !(alpha > 0)) return;
        const image = tinted(name, color);
        if (!image) return;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(image, -size / 2, -size * stretch / 2, size, size * stretch);
    }

    /** Rises and falls over a particle's life, with no hard edge at either end. */
    const swell = p => Math.sin(Math.PI * clamp(p.age / p.life, 0, 1));

    const SPECS = {
        sparkles: {
            count: [40, 64, 96],
            blend: 'lighter',
            scene: (ctx, env) => {
                for (const spot of env.emitters) {
                    flash(ctx, env, spot.at, 0.3, env.R * 0.3, 0.45, spot.x, spot.y);
                    ring(ctx, env, spot.at, 0.5, env.R * 0.4, 2, env.pal.light, spot.x, spot.y);
                }
            },
            spawn: env => {
                // A third burst out of the flashes; the rest twinkle in
                // wherever they are, all over the widget.
                const burst = Math.random() < 0.35;
                const from = burst ? emitter(env) : anywhere(env);
                return {
                    x: from.x, y: from.y, wait: burst ? from.at : rand(0, 0.7),
                    ...radial(env, burst ? 0.6 : 0.05, burst ? 1.8 : 0.25),
                    life: burst ? rand(0.8, 1.4) : rand(0.9, 1.8),
                    size: (burst ? rand(3.5, 7) : rand(2, 5.5)) * env.u,
                    phase: rand(0, TAU), rate: rand(10, 20), burst,
                    color: Math.random() < 0.4 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, p.burst ? 3.4 : 1.2);
                if (p.burst) p.vy += 16 * env.u * dt;
            },
            draw: (ctx, p, a) => {
                const twinkle = 0.55 + 0.45 * Math.sin(p.phase + p.age * p.rate);
                stamp(ctx, p.color, p.size * 2.4, a * 0.5 * twinkle);
                ctx.globalAlpha = a * (p.burst ? 1 : twinkle);
                ctx.fillStyle = hsl(lighter(p.color, 0.15));
                // The ones appearing in place grow in and shrink away.
                const grow = p.burst ? twinkle : Math.sin(Math.PI * clamp(p.age / p.life, 0, 1));
                twinklePath(ctx, p.size * grow, p.size * 0.5);
                ctx.fill();
            }
        },

        stars: {
            count: [26, 40, 60],
            blend: 'lighter',
            trail: 7,
            scene: (ctx, env) => {
                for (const spot of env.emitters) {
                    flash(ctx, env, spot.at, 0.35, env.R * 0.4, 0.6, spot.x, spot.y);
                    ring(ctx, env, spot.at, 0.5, env.R * 0.45, 2.2, env.pal.light, spot.x, spot.y);
                }
            },
            spawn: env => {
                const from = emitter(env);
                const gold = env.pal.named ? pick(env.pal.spread) : { h: 44, s: 0.95, l: 0.66 };
                return {
                    x: from.x, y: from.y, wait: from.at,
                    ...radial(env, 0.6, 2),
                    life: rand(1.1, 1.8), size: rand(5, 10) * env.u,
                    rot: rand(0, TAU), spin: rand(-5, 5),
                    color: Math.random() < 0.5 ? gold : pick([env.pal.base, env.pal.light])
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, 3);
                p.vy += 26 * env.u * dt;
                p.rot += p.spin * dt;
            },
            streak: (ctx, p, a) => streak(ctx, p.trail, p.size * 0.35, p.color, a * 0.45),
            draw: (ctx, p, a) => {
                stamp(ctx, p.color, p.size * 2, a * 0.5);
                ctx.globalAlpha = a;
                ctx.rotate(p.rot);
                ctx.fillStyle = hsl(lighter(p.color, 0.12));
                starPath(ctx, 5, p.size * 0.62, p.size * 0.27);
                ctx.fill();
            }
        },

        confetti: {
            count: [50, 80, 120],
            blend: 'source-over',
            spawn: env => {
                const shape = Math.random();
                // Poppers go off along the bottom of the widget, and the rest
                // rains down across all of it a moment later.
                const pop = Math.random() < 0.45;
                const from = pop ? { ...emitter(env), y: env.box.y + env.box.h * 0.92 } : alongTop(env, rand(2, 40));
                const angle = -Math.PI / 2 + rand(-0.9, 0.9);
                const speed = Math.max(env.box.h, env.box.w * 0.25) * rand(1.6, 2.8);
                return {
                    x: from.x, y: from.y,
                    vx: pop ? Math.cos(angle) * speed : rand(-0.08, 0.08) * env.R,
                    vy: pop ? Math.sin(angle) * speed : rand(0.1, 0.4) * env.box.h,
                    wait: pop ? from.at : rand(0.1, 0.6),
                    life: pop ? rand(1.8, 2.6) : rand(1.9, 2.8),
                    w: rand(4, 8) * env.u, h: rand(2.2, 4) * env.u,
                    shape: shape < 0.14 ? 'dot' : shape < 0.3 ? 'ribbon' : 'rect',
                    rot: rand(0, TAU), spin: rand(-9, 9),
                    flip: rand(0, TAU), flipRate: rand(7, 14),
                    sway: rand(0, TAU),
                    color: pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, 2.6);
                p.vy += env.box.h * 1.6 * dt;
                p.vx += Math.sin(p.sway + p.age * 5) * env.u * 30 * dt;
                p.rot += p.spin * dt;
                p.flip += p.flipRate * dt;
            },
            draw: (ctx, p, a) => {
                const face = Math.cos(p.flip);
                ctx.rotate(p.rot);
                ctx.scale(1, Math.max(Math.abs(face), 0.12));
                ctx.globalAlpha = a;
                // The back of a piece of paper is a shade darker than its
                // front, and it catches the light as it turns.
                const shade = face < 0 ? p.color.l * 0.78 : p.color.l + (1 - Math.abs(face)) * 0.12;
                ctx.fillStyle = hsl({ ...p.color, l: shade });

                if (p.shape === 'dot') {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.h * 0.8, 0, TAU);
                    ctx.fill();
                } else if (p.shape === 'ribbon') {
                    ctx.beginPath();
                    ctx.moveTo(-p.w, 0);
                    ctx.bezierCurveTo(-p.w * 0.4, -p.h * 1.6, p.w * 0.4, p.h * 1.6, p.w, 0);
                    ctx.lineWidth = p.h * 0.55;
                    ctx.strokeStyle = ctx.fillStyle;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                } else {
                    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                }
            }
        },

        hearts: {
            count: [18, 28, 42],
            over: 1,
            blend: 'source-over',
            spawn: env => {
                const pink = env.pal.named ? pick(env.pal.spread) : { h: 345 + rand(-10, 10), s: 0.9, l: rand(0.62, 0.72) };
                // Rising from the whole bottom edge, and popping up in place.
                const from = Math.random() < 0.55 ? alongBottom(env, 8) : anywhere(env);
                return {
                    x: from.x, y: from.y,
                    vx: rand(-0.06, 0.06) * env.R, vy: -rand(0.35, 0.62) * env.box.h,
                    life: rand(1.6, 2.4), size: rand(8, 14) * env.u,
                    sway: rand(0, TAU), swayRate: rand(3, 5),
                    color: Math.random() < 0.65 ? pink : env.pal.base
                };
            },
            update: (p, dt) => {
                // Sideways only: a heart floats up at the speed it set off.
                p.vx *= Math.exp(-1.6 * dt);
                p.x += Math.sin(p.sway + p.age * p.swayRate) * p.size * 0.9 * dt;
            },
            draw: (ctx, p, a) => {
                // Pops in a little past full size, settles, and beats once.
                const t = clamp(p.age / 0.28, 0, 1);
                const beat = 1 + 0.12 * Math.max(0, Math.sin((p.age - 0.55) * 14)) * (p.age > 0.55 && p.age < 0.78 ? 1 : 0);
                const scale = (t < 1 ? 1.18 * Math.sin(t * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) : 1) * beat;
                ctx.rotate(Math.sin(p.sway + p.age * p.swayRate) * 0.2);
                ctx.scale(scale, scale);
                stamp(ctx, p.color, p.size * 1.1, a * 0.28);
                ctx.globalAlpha = a;
                const fill = ctx.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
                fill.addColorStop(0, hsl(lighter(p.color, 0.1)));
                fill.addColorStop(1, hsl({ ...p.color, l: p.color.l - 0.1 }));
                ctx.fillStyle = fill;
                heartPath(ctx, p.size);
                ctx.fill();
                ctx.globalAlpha = a * 0.5;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.ellipse(-p.size * 0.22, -p.size * 0.18, p.size * 0.12, p.size * 0.07, -0.6, 0, TAU);
                ctx.fill();
            }
        },

        notes: {
            count: [16, 26, 38],
            over: 1,
            blend: 'source-over',
            spawn: env => {
                const from = Math.random() < 0.5 ? alongBottom(env, 4) : anywhere(env);
                return {
                    x: from.x, y: from.y,
                    vx: rand(-0.3, 0.3) * env.R, vy: -rand(0.45, 0.85) * env.box.h,
                    life: rand(1.6, 2.3), size: rand(10, 16) * env.u,
                    beamed: Math.random() < 0.35,
                    sway: rand(0, TAU),
                    color: Math.random() < 0.55 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, 1.5);
                p.vy += env.box.h * 0.12 * dt;
            },
            draw: (ctx, p, a) => {
                const t = clamp(p.age / 0.22, 0, 1);
                const scale = 0.4 + 0.6 * (1 - Math.pow(1 - t, 3));
                ctx.rotate(Math.sin(p.sway + p.age * 4) * 0.28);
                ctx.scale(scale, scale);
                stamp(ctx, p.color, p.size * 0.9, a * 0.35);
                ctx.globalAlpha = a * 0.55;
                ctx.fillStyle = 'rgba(0,0,0,.45)';
                ctx.save();
                ctx.translate(p.size * 0.05, p.size * 0.07);
                notePath(ctx, p.size, p.beamed);
                ctx.restore();
                ctx.globalAlpha = a;
                ctx.fillStyle = hsl(p.color);
                notePath(ctx, p.size, p.beamed);
            }
        },

        // Rockets go up from the bottom and burst into shells of sparks, each
        // shell one color, the sparks trailing light as they fall.
        fireworks: {
            count: [3, 4, 6],
            over: 0.8,
            blend: 'lighter',
            trail: 8,
            spawn: (env, i, n) => ({
                kind: 'rocket',
                x: env.box.x + env.box.w * ((i + 0.5) / n + rand(-0.08, 0.08)), y: env.box.y + env.box.h + 4 * env.u,
                vx: rand(-0.06, 0.06) * env.box.w, vy: -rand(1.9, 2.3) * env.box.h,
                life: 1.4, size: 2.2 * env.u,
                color: pick(env.pal.spread)
            }),
            update: (p, dt, env) => {
                if (p.kind === 'rocket') {
                    p.vy += env.box.h * 3.2 * dt;
                    // Bursts near the top of its climb.
                    if (p.vy > -env.box.h * 0.35 || p.y < env.box.y + env.box.h * 0.22) {
                        p.age = p.life;
                        const n = Math.round(env.scaleCount(38));
                        const reach = Math.min(env.box.w, env.box.h * 1.6) * rand(0.55, 0.75);
                        for (let i = 0; i < n; i++) {
                            const angle = (i / n) * TAU + rand(-0.08, 0.08);
                            const speed = reach * rand(1.6, 2.1);
                            env.add({
                                kind: 'spark', x: p.x, y: p.y,
                                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                                life: rand(1, 1.5), size: rand(1.4, 2.4) * env.u,
                                crackle: Math.random() < 0.35,
                                color: Math.random() < 0.2 ? env.pal.light : p.color
                            });
                        }
                        env.add({ kind: 'bloom', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.35, size: reach * 0.55, color: p.color });
                    }
                    return;
                }
                if (p.kind === 'spark') {
                    drag(p, dt, 2.4);
                    p.vy += env.box.h * 0.45 * dt;
                }
            },
            streak: (ctx, p, a) => {
                if (p.kind === 'rocket') streak(ctx, p.trail, p.size * 1.2, lighter(p.color, 0.25), a * 0.8);
                else if (p.kind === 'spark') streak(ctx, p.trail, p.size, p.color, a * 0.6);
            },
            draw: (ctx, p, a) => {
                if (p.kind === 'bloom') {
                    const t = p.age / p.life;
                    stamp(ctx, lighter(p.color, 0.1), p.size * (0.6 + 0.4 * t), (1 - t) * 0.55);
                    return;
                }
                // Sparks crackle at the end of their life.
                const twinkle = p.crackle && p.age > p.life * 0.55 ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
                stamp(ctx, p.color, p.size * 3, a * 0.6 * twinkle);
                ctx.globalAlpha = a * twinkle;
                ctx.fillStyle = hsl(lighter(p.color, 0.25));
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.6, 0, TAU);
                ctx.fill();
            }
        },

        // Square pixels, snapped to a grid: 8-bit bursts across the widget.
        pixels: {
            count: [48, 76, 110],
            blend: 'source-over',
            spawn: env => {
                const from = emitter(env);
                const inRing = Math.random() < 0.35;
                const angle = inRing ? rand(0, TAU) : -Math.PI / 2 + rand(-1.4, 1.4);
                const speed = inRing ? env.R * 0.9 : Math.max(env.box.h, env.box.w * 0.2) * rand(1, 2.2);
                return {
                    x: from.x, y: from.y, wait: from.at,
                    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                    inRing, life: inRing ? rand(0.6, 0.8) : rand(1.2, 1.9),
                    size: (Math.random() < 0.25 ? 2 : 1) * env.grid,
                    color: Math.random() < 0.25 ? WHITE : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, p.inRing ? 3.6 : 2.2);
                if (!p.inRing) p.vy += env.box.h * 1.4 * dt;
            },
            // Blinks out in steps, the way sprites did.
            alpha: p => (p.age > p.life * 0.65 ? (Math.floor(p.age * 14) % 2 ? 1 : 0) : 1),
            absolute: () => true,
            draw: (ctx, p, a, env) => {
                if (!a) return;
                ctx.globalAlpha = 1;
                const g = env.grid;
                const x = Math.round(p.x / g) * g, y = Math.round(p.y / g) * g;
                ctx.fillStyle = hsl({ ...p.color, l: p.color.l * 0.7 });
                ctx.fillRect(x + g * 0.5, y + g * 0.5, p.size, p.size);
                ctx.fillStyle = hsl(p.color);
                ctx.fillRect(x, y, p.size, p.size);
            }
        },

        // Coins rain down across the widget, spinning as they fall.
        coins: {
            count: [16, 26, 40],
            over: 0.8,
            blend: 'source-over',
            spawn: env => {
                const from = alongTop(env, rand(4, 30));
                return {
                    x: from.x, y: from.y,
                    vx: rand(-0.05, 0.05) * env.R, vy: rand(0.1, 0.5) * env.box.h,
                    life: rand(1.4, 2), size: rand(9, 14) * env.u,
                    spin: rand(0, TAU), spinRate: rand(9, 15), rot: rand(-0.3, 0.3),
                    glint: rand(0.3, 1)
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, 1);
                p.vy += env.box.h * 1.7 * dt;
                p.spin += p.spinRate * dt;
            },
            draw: (ctx, p, a, env) => {
                const face = env.pal.named ? env.pal.base : { h: 45, s: 0.95, l: 0.55 };
                const r = p.size / 2;
                const turn = Math.cos(p.spin);
                const w = Math.max(r * 0.12, r * Math.abs(turn));
                ctx.rotate(p.rot);
                ctx.globalAlpha = a;
                // The edge, showing more as the coin turns side on.
                ctx.fillStyle = hsl({ ...face, l: face.l * 0.6 });
                ctx.beginPath();
                ctx.ellipse(Math.sign(turn || 1) * r * 0.1 * (1 - Math.abs(turn)), 0, w, r, 0, 0, TAU);
                ctx.fill();
                const fill = ctx.createLinearGradient(-w, -r, w, r);
                fill.addColorStop(0, hsl({ ...face, l: clamp(face.l + 0.3, 0, 0.95) }));
                fill.addColorStop(0.5, hsl(face));
                fill.addColorStop(1, hsl({ ...face, l: face.l * 0.7 }));
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.ellipse(0, 0, w * 0.9, r * 0.9, 0, 0, TAU);
                ctx.fill();
                ctx.strokeStyle = hsl({ ...face, l: face.l * 0.75 });
                ctx.lineWidth = Math.max(0.6, r * 0.1);
                ctx.beginPath();
                ctx.ellipse(0, 0, w * 0.62, r * 0.62, 0, 0, TAU);
                ctx.stroke();
                // A glint as it catches the light.
                if (Math.abs(p.age - p.glint) < 0.12) {
                    const g = 1 - Math.abs(p.age - p.glint) / 0.12;
                    ctx.globalAlpha = a * g;
                    ctx.fillStyle = '#fff';
                    twinklePath(ctx, r * 1.3 * g, r * 0.5);
                    ctx.fill();
                }
            }
        },

        embers: {
            count: [34, 54, 80],
            over: 1.3,
            blend: 'lighter',
            trail: 5,
            spawn: env => {
                const from = Math.random() < 0.6 ? alongBottom(env, 3) : anywhere(env);
                const ember = env.pal.named ? pick(env.pal.spread) : { h: 22 + rand(-8, 14), s: 1, l: 0.6 };
                return {
                    x: from.x, y: from.y,
                    vx: rand(-0.1, 0.1) * env.R, vy: -rand(0.35, 0.8) * env.box.h,
                    life: rand(1.6, 2.8), size: rand(1.4, 3.2) * env.u,
                    seed: rand(0, TAU),
                    color: Math.random() < 0.7 ? ember : env.pal.base
                };
            },
            update: (p, dt, env) => {
                p.vx += Math.sin(p.seed + p.age * 3.1) * env.u * 60 * dt;
                p.vy -= 12 * env.u * dt;
                drag(p, dt, 0.6);
            },
            streak: (ctx, p, a) => streak(ctx, p.trail, p.size * 0.8, p.color, a * 0.3),
            draw: (ctx, p, a) => {
                const t = p.age / p.life;
                const flicker = 0.72 + 0.28 * Math.sin(p.seed * 7 + p.age * 26);
                // Hot and pale at first, deeper as it cools.
                const color = { ...p.color, l: clamp(0.8 - t * 0.3, 0.45, 0.85) };
                stamp(ctx, color, p.size * 4, a * flicker * 0.8);
                ctx.globalAlpha = a * flicker;
                ctx.fillStyle = hsl({ ...color, l: 0.9 });
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.55, 0, TAU);
                ctx.fill();
            }
        },

        bubbles: {
            count: [20, 32, 48],
            over: 1.1,
            blend: 'source-over',
            spawn: env => {
                const from = Math.random() < 0.6 ? alongBottom(env, 8) : anywhere(env);
                return {
                    x: from.x, y: from.y,
                    vx: rand(-0.12, 0.12) * env.R, vy: -rand(0.35, 0.7) * env.box.h,
                    life: rand(1.4, 2.4), size: rand(4, 11) * env.u,
                    seed: rand(0, TAU),
                    color: Math.random() < 0.5 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                p.vx += Math.sin(p.seed + p.age * 4) * env.u * 40 * dt;
                drag(p, dt, 0.8);
            },
            // A bubble does not fade - it pops.
            alpha: p => clamp(p.age / 0.12, 0, 1),
            draw: (ctx, p, a) => {
                const popAt = p.life - 0.16;
                const r = p.size * (0.8 + 0.2 * clamp(p.age / 0.3, 0, 1));

                if (p.age > popAt) {
                    const t = (p.age - popAt) / 0.16;
                    ctx.globalAlpha = a * (1 - t);
                    ctx.strokeStyle = hsl(p.color);
                    ctx.lineWidth = Math.max(1, r * 0.12);
                    for (let i = 0; i < 6; i++) {
                        const angle = (i / 6) * TAU + p.seed;
                        const d = r * (1 + t * 0.9);
                        ctx.beginPath();
                        ctx.moveTo(Math.cos(angle) * d * 0.75, Math.sin(angle) * d * 0.75);
                        ctx.lineTo(Math.cos(angle) * d, Math.sin(angle) * d);
                        ctx.stroke();
                    }
                    return;
                }

                ctx.globalAlpha = a;
                const fill = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
                fill.addColorStop(0, hsl(p.color, 0.02));
                fill.addColorStop(1, hsl(p.color, 0.28));
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, TAU);
                ctx.fill();
                // A rim that shifts hue around the bubble, like a film of soap.
                const rim = ctx.createLinearGradient(-r, -r, r, r);
                rim.addColorStop(0, hsl({ ...p.color, h: p.color.h + 60, s: 0.8, l: 0.8 }, 0.9));
                rim.addColorStop(1, hsl({ ...p.color, h: p.color.h - 60, s: 0.8, l: 0.75 }, 0.9));
                ctx.strokeStyle = rim;
                ctx.lineWidth = Math.max(1, r * 0.1);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(255,255,255,.85)';
                ctx.lineWidth = Math.max(1, r * 0.14);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.62, Math.PI * 1.1, Math.PI * 1.45);
                ctx.stroke();
            }
        },

        petals: {
            count: [24, 38, 56],
            over: 1.2,
            blend: 'source-over',
            spawn: env => {
                const pink = env.pal.named ? pick(env.pal.spread) : { h: 340 + rand(-8, 12), s: 0.8, l: rand(0.8, 0.9) };
                // Blown in across the whole widget from its top left.
                const from = Math.random() < 0.6
                    ? { x: env.box.x + rand(-0.25, 0.7) * env.box.w, y: env.box.y - rand(0, 0.4) * env.box.h }
                    : anywhere(env);
                return {
                    x: from.x, y: from.y,
                    vx: rand(0.3, 0.6) * env.R, vy: rand(0.15, 0.4) * env.box.h,
                    life: rand(2, 2.9), size: rand(7, 12) * env.u,
                    rot: rand(0, TAU), spin: rand(-3, 3), flip: rand(0, TAU), flipRate: rand(3, 6),
                    sway: rand(0, TAU),
                    color: Math.random() < 0.75 ? pink : env.pal.light
                };
            },
            update: (p, dt, env) => {
                drag(p, dt, 0.9);
                p.vy += env.box.h * 0.35 * dt;
                p.vx += (env.R * 0.22 + Math.sin(p.sway + p.age * 2.4) * env.R * 0.4) * dt;
                p.rot += p.spin * dt;
                p.flip += p.flipRate * dt;
            },
            draw: (ctx, p, a) => {
                ctx.rotate(p.rot);
                ctx.scale(Math.max(Math.abs(Math.cos(p.flip)), 0.2), 1);
                ctx.globalAlpha = a;
                const fill = ctx.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
                fill.addColorStop(0, hsl(lighter(p.color, 0.08)));
                fill.addColorStop(1, hsl({ ...p.color, l: p.color.l - 0.12 }));
                ctx.fillStyle = fill;
                petalPath(ctx, p.size);
                ctx.fill();
            }
        },

        /* --------------------------------------------- the widget itself */

        // Every part flies out from the middle, hangs there a moment, and
        // clicks back into place with a flash where each one lands.
        scatter: {
            last: 1.5,
            blend: 'lighter',
            moves: env => {
                const cx = env.box.x + env.box.w / 2, cy = env.box.y + env.box.h / 2;
                env.parts.forEach((part, i) => {
                    let dx = part.x + part.w / 2 - cx, dy = part.y + part.h / 2 - cy;
                    if (Math.hypot(dx, dy) < 1) { dx = rand(-1, 1); dy = rand(-1, 1); }
                    const len = Math.hypot(dx, dy) || 1;
                    const reach = Math.min(env.box.w, env.box.h) * 0.3 * env.size * rand(0.8, 1.2);
                    const x = dx / len * reach, y = dy / len * reach;
                    const turn = rand(-18, 18);
                    const away = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${turn.toFixed(1)}deg) scale(0.9)`;
                    const home = 'translate(0px, 0px) rotate(0deg) scale(1)';
                    nudge(env, part.el, [
                        { transform: home, easing: 'cubic-bezier(.2,.8,.2,1)' },
                        { transform: away, offset: 0.24, easing: 'linear' },
                        { transform: away, offset: 0.52, easing: 'cubic-bezier(.3,1.7,.5,1)' },
                        { transform: home }
                    ], { duration: 1150, delay: i * 25 });
                    for (let k = 0; k < env.scaleCount(6); k++) {
                        env.add({ wait: 0.95 + i * 0.025, x: part.x + part.w / 2, y: part.y + part.h / 2, ...radial(env, 0.3, 0.9), life: rand(0.35, 0.6), size: rand(1.2, 2.2) * env.u, color: pick(env.pal.spread) });
                    }
                });
            },
            scene: (ctx, env) => ring(ctx, env, 1, 0.45, env.R * 0.7, 2, env.pal.light, env.box.x + env.box.w / 2, env.box.y + env.box.h / 2),
            update: (p, dt) => drag(p, dt, 3),
            draw: drawSpark
        },

        // Each part hops in turn, left to right, like a crowd doing the wave,
        // and kicks up a little dust where it lands.
        wave: {
            last: 1.6,
            blend: 'lighter',
            moves: env => {
                const parts = [...env.parts].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
                const hop = Math.min(env.box.h * 0.2, 22 * env.u) * env.size;
                parts.forEach((part, i) => {
                    const delay = i * 85;
                    nudge(env, part.el, [
                        { transform: 'translateY(0px) scale(1, 1)', easing: 'cubic-bezier(.2,.7,.3,1)' },
                        { transform: `translateY(${-hop}px) scale(0.97, 1.04)`, offset: 0.38, easing: 'cubic-bezier(.6,0,.9,.5)' },
                        { transform: 'translateY(0px) scale(1.05, 0.94)', offset: 0.7, easing: 'ease-out' },
                        { transform: `translateY(${-hop * 0.18}px) scale(1, 1)`, offset: 0.85 },
                        { transform: 'translateY(0px) scale(1, 1)' }
                    ], { duration: 560, delay });
                    for (let k = 0; k < env.scaleCount(4); k++) {
                        env.add({ wait: (delay + 390) / 1000, x: part.x + rand(0.2, 0.8) * part.w, y: part.y + part.h, vx: rand(-0.4, 0.4) * env.R, vy: -rand(0.05, 0.2) * env.R, life: rand(0.3, 0.5), size: rand(1, 1.8) * env.u, color: env.pal.light });
                    }
                });
            },
            update: (p, dt) => drag(p, dt, 4),
            draw: (ctx, p, a) => stamp(ctx, p.color, p.size * 2.6, a * 0.6)
        },

        // The whole widget squashes and wobbles like jelly, then settles,
        // with its parts wobbling a beat behind.
        jelly: {
            last: 1.2,
            moves: env => {
                const k = 0.1 * clamp(env.size, 0.5, 1.6);
                const frames = amount => [
                    { transform: 'scale(1, 1)' },
                    { transform: `scale(${1 + amount}, ${1 - amount})`, offset: 0.16 },
                    { transform: `scale(${1 - amount * 0.6}, ${1 + amount * 0.7})`, offset: 0.36 },
                    { transform: `scale(${1 + amount * 0.35}, ${1 - amount * 0.3})`, offset: 0.56 },
                    { transform: `scale(${1 - amount * 0.12}, ${1 + amount * 0.1})`, offset: 0.76 },
                    { transform: 'scale(1, 1)' }
                ];
                nudge(env, env.target, frames(k), { duration: 950, easing: 'ease-in-out' });
                env.parts.forEach((part, i) => nudge(env, part.el, frames(k * 0.6), { duration: 900, delay: 90 + i * 20, easing: 'ease-in-out' }));
            }
        },

        // Half a second of broken signal: the widget jumps, its colors split,
        // slices of it slip sideways, and noise bars flicker over it.
        glitch: {
            last: 0.9,
            blend: 'lighter',
            moves: env => {
                const s = 4 * env.u * env.size;
                const steps = 11;
                const shake = [], broken = [];
                for (let i = 0; i <= steps; i++) {
                    const calm = i === 0 || i === steps;
                    const x = calm ? 0 : rand(-1, 1) * s;
                    const y = calm ? 0 : rand(-0.4, 0.4) * s;
                    const split = calm ? 0 : rand(1.5, 3) * s * 0.5;
                    const top = rand(0, 60), bottom = rand(0, 100 - top - 10);
                    shake.push({ offset: i / steps, easing: 'steps(1, end)', transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` });
                    broken.push({
                        offset: i / steps,
                        easing: 'steps(1, end)',
                        filter: calm ? 'none' : `drop-shadow(${split.toFixed(1)}px 0 0 rgba(255, 0, 90, .75)) drop-shadow(${(-split).toFixed(1)}px 0 0 rgba(0, 230, 255, .75))`,
                        clipPath: calm || Math.random() < 0.5 ? 'inset(0 0 0 0)' : `inset(${top.toFixed(0)}% 0 ${bottom.toFixed(0)}% 0)`
                    });
                }
                nudge(env, env.target, shake, { duration: 620 });
                // The color split and the slices replace, for a moment, what
                // the widget had - and hand it back when they end.
                nudge(env, env.target, broken, { duration: 620 }, 'replace');
                // Parts slip on their own, too.
                env.parts.forEach(part => nudge(env, part.el, [
                    { transform: 'translateX(0px)' },
                    { transform: `translateX(${(rand(-1, 1) * s * 1.5).toFixed(1)}px)`, offset: rand(0.2, 0.4), easing: 'steps(1, end)' },
                    { transform: `translateX(${(rand(-1, 1) * s).toFixed(1)}px)`, offset: rand(0.5, 0.7), easing: 'steps(1, end)' },
                    { transform: 'translateX(0px)', offset: 0.85 },
                    { transform: 'translateX(0px)' }
                ], { duration: 620 }));
            },
            scene: (ctx, env) => {
                if (env.t > 0.65) return;
                // Noise bars, redrawn at random every frame.
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 5; i++) {
                    if (Math.random() < 0.4) continue;
                    const y = env.box.y + rand(0, 1) * env.box.h;
                    const h = rand(1, 5) * env.u;
                    ctx.globalAlpha = rand(0.15, 0.4);
                    ctx.fillStyle = pick(['rgba(255,0,90,1)', 'rgba(0,230,255,1)', 'rgba(255,255,255,1)']);
                    ctx.fillRect(env.box.x + rand(-0.1, 0.3) * env.box.w, y, env.box.w * rand(0.3, 0.9), h);
                }
                // Scanlines.
                ctx.globalAlpha = 0.08;
                ctx.fillStyle = '#fff';
                for (let y = env.box.y; y < env.box.y + env.box.h; y += 3 * env.u) ctx.fillRect(env.box.x, y, env.box.w, Math.max(0.5, env.u * 0.6));
            }
        },

        // Two beats, lub-dub: the widget swells with a glow round its edge.
        heartbeat: {
            last: 1.3,
            blend: 'lighter',
            moves: env => {
                const a = 0.05 * env.size;
                nudge(env, env.target, [
                    { transform: 'scale(1)', easing: 'cubic-bezier(.3,0,.3,1)' },
                    { transform: `scale(${1 + a})`, offset: 0.1, easing: 'cubic-bezier(.3,0,.3,1)' },
                    { transform: 'scale(1)', offset: 0.24, easing: 'cubic-bezier(.3,0,.3,1)' },
                    { transform: `scale(${1 + a * 1.4})`, offset: 0.36, easing: 'cubic-bezier(.3,0,.3,1)' },
                    { transform: 'scale(1)', offset: 0.62 },
                    { transform: 'scale(1)' }
                ], { duration: 1100 });
            },
            scene: (ctx, env) => {
                const pulse = t => Math.max(0, Math.sin(Math.PI * clamp(t, 0, 1)));
                const strength = Math.max(pulse((env.t - 0.02) / 0.22), 1.3 * pulse((env.t - 0.3) / 0.35));
                if (strength <= 0) return;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.9 * Math.min(1, strength);
                ctx.shadowColor = hsl(env.pal.base);
                ctx.shadowBlur = 22 * env.u * strength;
                ctx.strokeStyle = hsl(lighter(env.pal.base, 0.1), 0.9);
                ctx.lineWidth = 2.5 * env.u;
                roundedBox(ctx, { x: env.box.x + env.u * 2, y: env.box.y + env.u * 2, w: env.box.w - env.u * 4, h: env.box.h - env.u * 4 }, env.box.r);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        },

        // The widget dims, a spotlight sweeps across it and stops on the song,
        // which lifts a little in the light.
        spotlight: {
            last: 2.1,
            moves: env => {
                const title = env.parts.find(part => part.el.classList.contains('title-wrapper') || part.el.classList.contains('title')) ||
                    [...env.parts].sort((a, b) => b.w - a.w)[0];
                env.focus = title;
                if (title) {
                    nudge(env, title.el, [
                        { transform: 'scale(1)' },
                        { transform: 'scale(1.06)', offset: 0.35, easing: 'cubic-bezier(.2,1.4,.4,1)' },
                        { transform: 'scale(1.06)', offset: 0.7 },
                        { transform: 'scale(1)' }
                    ], { duration: 900, delay: 950, easing: 'ease-out' });
                }
            },
            scene: (ctx, env) => {
                const t = env.t;
                const dim = Math.min(clamp(t / 0.25, 0, 1), clamp((2 - t) / 0.4, 0, 1));
                if (dim <= 0) return;
                const end = env.focus
                    ? { x: env.focus.x + Math.min(env.focus.w, env.box.w * 0.5) / 2, y: env.focus.y + env.focus.h / 2 }
                    : { x: env.box.x + env.box.w / 2, y: env.box.y + env.box.h / 2 };
                const start = { x: env.box.x - env.box.h * 0.3, y: env.box.y + env.box.h * 0.2 };
                const k = easeInOut((t - 0.15) / 0.9);
                const x = start.x + (end.x - start.x) * k + Math.sin(t * 3) * env.u * 4 * (1 - k);
                const y = start.y + (end.y - start.y) * k;
                const radius = Math.max(env.box.h * 0.5, 40 * env.u);

                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 0.62 * dim;
                ctx.fillStyle = hsl({ ...env.pal.dark, l: 0.03 });
                roundedBox(ctx, env.box, env.box.r);
                ctx.fill();

                ctx.globalCompositeOperation = 'destination-out';
                ctx.globalAlpha = 1;
                const hole = ctx.createRadialGradient(x, y, radius * 0.45, x, y, radius);
                hole.addColorStop(0, 'rgba(0,0,0,1)');
                hole.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = hole;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.25 * dim;
                const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
                light.addColorStop(0, hsl(env.pal.light, 0.9));
                light.addColorStop(1, hsl(env.pal.light, 0));
                ctx.fillStyle = light;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
        },

        /* ------------------------------------------------- light shows */

        // Comets race round the edge of the widget, trailing light, and burst
        // where they finish.
        comet: {
            count: [2, 3, 4],
            blend: 'lighter',
            trail: 22,
            spawn: (env, i, n) => {
                const lap = env.edge.total;
                return {
                    kind: 'comet', x: 0, y: 0, vx: 0, vy: 0,
                    start: (i / n) * lap, distance: lap * rand(0.9, 1.15),
                    life: rand(1.25, 1.5), size: 3 * env.u,
                    color: i % 2 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                if (p.kind !== 'comet') {
                    drag(p, dt, 3);
                    return;
                }
                // Quick off the mark, easing into the finish.
                const t = clamp(p.age / p.life, 0, 1);
                const at = env.edge.at(p.start + p.distance * (1 - Math.pow(1 - t, 2.2)));
                p.x = at.x;
                p.y = at.y;
                if (p.age + dt >= p.life && !p.burst) {
                    p.burst = true;
                    for (let i = 0; i < env.scaleCount(14); i++) {
                        env.add({ kind: 'bit', x: p.x, y: p.y, ...radial(env, 0.4, 1.3), life: rand(0.5, 0.9), size: rand(1.2, 2.2) * env.u, color: p.color });
                    }
                }
            },
            alpha: p => (p.kind === 'comet' ? clamp(p.age / 0.1, 0, 1) * clamp((p.life - p.age) / 0.12, 0, 1) : fade(p)),
            streak: (ctx, p, a) => {
                if (p.kind !== 'comet') return;
                streak(ctx, p.trail, p.size * 1.6, p.color, a * 0.9);
                streak(ctx, p.trail, p.size * 0.6, WHITE, a * 0.8);
            },
            draw: (ctx, p, a) => {
                stamp(ctx, p.color, p.size * (p.kind === 'comet' ? 5 : 2.5), a * 0.8);
                ctx.globalAlpha = a;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, p.size * (p.kind === 'comet' ? 0.7 : 0.45), 0, TAU);
                ctx.fill();
            }
        },

        // Light draws the widget's outline, then the outline of every part in
        // it, and fades.
        neon: {
            last: 2,
            blend: 'lighter',
            scene: (ctx, env) => {
                const out = clamp((2 - env.t) / 0.5, 0, 1);
                if (out <= 0) return;
                const trace = (box, radius, start, duration, color, width) => {
                    const p = easeInOut((env.t - start) / duration);
                    if (p <= 0) return;
                    const length = perimeter({ ...box, r: radius }).total;
                    ctx.setLineDash([length * p, length]);
                    ctx.lineCap = 'round';
                    for (const [w, alpha, c] of [[width * 4, 0.16, color], [width * 2, 0.4, color], [width * 0.7, 0.95, WHITE]]) {
                        ctx.globalAlpha = alpha * out;
                        ctx.strokeStyle = hsl(c);
                        ctx.lineWidth = Math.max(0.6, w);
                        roundedBox(ctx, box, radius);
                        ctx.stroke();
                    }
                    ctx.setLineDash([]);
                };
                const inset = 2 * env.u;
                trace({ x: env.box.x + inset, y: env.box.y + inset, w: env.box.w - inset * 2, h: env.box.h - inset * 2 }, Math.max(0, env.box.r - inset), 0, 0.8, env.pal.base, 2.2 * env.u);
                // Only the parts with a shape of their own - the art, a bar, a
                // card. A box traced round a line of text looks like a mistake.
                env.parts.filter(part => part.solid).forEach((part, i) => {
                    trace(part, part.r, 0.35 + i * 0.08, 0.55, env.pal.spread[i % env.pal.spread.length], 1.4 * env.u);
                });
            }
        },

        // Hyperspace: stars stream out of the middle of the widget, faster
        // and longer as they go, and it ends in a flash.
        warp: {
            count: [60, 90, 130],
            over: 0.9,
            blend: 'lighter',
            last: 1.3,
            spawn: env => ({
                x: 0, y: 0, vx: 0, vy: 0, angle: rand(0, TAU),
                r: env.R * rand(0.02, 0.25), k: rand(2.6, 4.2),
                life: 1.2, size: rand(0.8, 1.8) * env.u,
                color: Math.random() < 0.5 ? WHITE : pick([env.pal.light, env.pal.base])
            }),
            update: (p, dt, env) => {
                p.prev = p.r;
                p.r *= Math.exp(p.k * dt);
                if (p.r > env.R * 1.4) p.age = p.life;
            },
            absolute: () => true,
            alpha: p => clamp(p.age / 0.15, 0, 1),
            draw: (ctx, p, a, env) => {
                const tail = Math.min(p.prev || p.r, p.r * 0.72);
                const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
                ctx.globalAlpha = a * clamp(p.r / (env.R * 0.3), 0.2, 1);
                ctx.strokeStyle = hsl(p.color);
                ctx.lineWidth = p.size * clamp(p.r / env.R, 0.3, 1.6);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(env.ox + cos * tail, env.oy + sin * tail * 0.75);
                ctx.lineTo(env.ox + cos * p.r, env.oy + sin * p.r * 0.75);
                ctx.stroke();
            },
            scene: (ctx, env) => {
                if (env.t < 0.9) stampAt(ctx, env.ox, env.oy, env.pal.light, env.R * 0.25 * easeIn(env.t / 0.9), 0.5);
                flash(ctx, env, 0.95, 0.4, env.R * 0.9, 0.8);
            }
        },

        // Ribbons of light flow across the widget, like the northern lights.
        aurora: {
            last: 2.6,
            blend: 'lighter',
            scene: (ctx, env) => {
                const t = env.t;
                const alpha = Math.min(clamp(t / 0.6, 0, 1), clamp((2.6 - t) / 0.8, 0, 1));
                if (alpha <= 0) return;
                const { x, y, w, h } = env.box;
                ctx.save();
                roundedBox(ctx, env.box, env.box.r);
                ctx.clip();
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 3; i++) {
                    const color = env.pal.spread[i % env.pal.spread.length];
                    const mid = y + h * (0.3 + 0.2 * i);
                    const amp = h * 0.14;
                    const thick = h * (0.16 + 0.05 * i);
                    const phase = t * (1.2 + i * 0.35) + i * 2;
                    const g = ctx.createLinearGradient(0, mid - thick - amp, 0, mid + thick + amp);
                    g.addColorStop(0, hsl(color, 0));
                    g.addColorStop(0.5, hsl(lighter(color, 0.1), 0.55 * alpha));
                    g.addColorStop(1, hsl(color, 0));
                    ctx.fillStyle = g;
                    ctx.globalAlpha = 1;
                    ctx.beginPath();
                    const step = Math.max(6, w / 60);
                    for (let px = x - step; px <= x + w + step; px += step) {
                        const k = (px - x) / w;
                        ctx.lineTo(px, mid + Math.sin(k * 5 + phase) * amp - thick * (0.7 + 0.3 * Math.sin(k * 9 + phase * 1.7)));
                    }
                    for (let px = x + w + step; px >= x - step; px -= step) {
                        const k = (px - x) / w;
                        ctx.lineTo(px, mid + Math.sin(k * 5 + phase) * amp + thick * (0.7 + 0.3 * Math.cos(k * 7 + phase)));
                    }
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            }
        },

        // A bright line sweeps down the widget and back, and every part it
        // passes flares and jumps as it goes over.
        scanline: {
            last: 1.3,
            blend: 'lighter',
            moves: env => {
                const passes = [{ start: 0.05, duration: 0.55, down: true }, { start: 0.7, duration: 0.4, down: false }];
                env.passes = passes;
                for (const pass of passes) {
                    for (const part of env.parts) {
                        const middle = clamp((part.y + part.h / 2 - env.box.y) / env.box.h, 0, 1);
                        const at = pass.start + pass.duration * (pass.down ? middle : 1 - middle);
                        nudge(env, part.el, [
                            { transform: 'translateX(0px)', filter: 'brightness(1)' },
                            { transform: `translateX(${(rand(-1, 1) * 3 * env.u).toFixed(1)}px)`, filter: 'brightness(1.7)', offset: 0.3, easing: 'steps(1, end)' },
                            { transform: 'translateX(0px)', filter: 'brightness(1)' }
                        ], { duration: 180, delay: Math.max(0, at * 1000 - 60) });
                    }
                }
            },
            scene: (ctx, env) => {
                for (const pass of env.passes || []) {
                    const k = (env.t - pass.start) / pass.duration;
                    if (k < 0 || k > 1.15) continue;
                    const y = env.box.y + env.box.h * (pass.down ? easeInOut(k) : 1 - easeInOut(k));
                    const fadeOut = clamp((1.15 - k) / 0.15, 0, 1);
                    const band = 14 * env.u;
                    const g = ctx.createLinearGradient(0, y - band, 0, y + band);
                    g.addColorStop(0, hsl(env.pal.base, 0));
                    g.addColorStop(0.5, hsl(env.pal.base, 0.55 * fadeOut));
                    g.addColorStop(1, hsl(env.pal.base, 0));
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = g;
                    ctx.fillRect(env.box.x, y - band, env.box.w, band * 2);
                    ctx.globalAlpha = 0.95 * fadeOut;
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(env.box.x, y - env.u * 0.8, env.box.w, env.u * 1.6);
                    // Glitchy offcuts trailing behind it.
                    for (let i = 0; i < 4; i++) {
                        const behind = (pass.down ? -1 : 1) * rand(4, 24) * env.u;
                        ctx.globalAlpha = rand(0.1, 0.35) * fadeOut;
                        ctx.fillStyle = hsl(pick(env.pal.spread));
                        ctx.fillRect(env.box.x + rand(0, 0.7) * env.box.w, y + behind, env.box.w * rand(0.1, 0.3), rand(1, 2.5) * env.u);
                    }
                }
            }
        },

        // Bolts crack across the widget from edge to edge, with a flash on each.
        lightning: {
            count: [3, 4, 6],
            over: 1,
            blend: 'lighter',
            spawn: env => {
                const s = rand(0, env.edge.total);
                const from = env.edge.at(s);
                const end = env.edge.at(s + env.edge.total * rand(0.35, 0.65));
                const bolt = { kind: 'bolt', x: 0, y: 0, vx: 0, vy: 0, life: 0.32, from, end, color: pick([env.pal.base, env.pal.light]) };
                bolt.points = jag(from.x, from.y, end.x, end.y, 0.2);
                // A branch off part way.
                const fork = bolt.points[Math.floor(bolt.points.length * rand(0.35, 0.65))];
                const angle = Math.atan2(end.y - from.y, end.x - from.x) + rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1);
                const reach = Math.hypot(end.x - from.x, end.y - from.y) * rand(0.2, 0.35);
                bolt.branch = jag(fork.x, fork.y, fork.x + Math.cos(angle) * reach, fork.y + Math.sin(angle) * reach, 0.25);
                env.strike = env.t;
                for (let i = 0; i < env.scaleCount(8); i++) {
                    env.add({ kind: 'spark', x: end.x, y: end.y, ...radial(env, 0.4, 1.4), life: rand(0.35, 0.7), size: rand(1, 1.8) * env.u, color: bolt.color });
                }
                return bolt;
            },
            update: (p, dt, env) => {
                if (p.kind === 'spark') {
                    drag(p, dt, 3);
                    p.vy += env.box.h * 0.6 * dt;
                    return;
                }
                // It jumps once, the way a real one flickers.
                if (p.age > 0.12 && !p.rejagged) {
                    p.rejagged = true;
                    p.points = jag(p.from.x, p.from.y, p.end.x, p.end.y, 0.18);
                }
            },
            scene: (ctx, env) => {
                if (env.strike === undefined) return;
                const t = (env.t - env.strike) / 0.25;
                if (t < 0 || t >= 1) return;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.16 * (1 - t);
                ctx.fillStyle = hsl(env.pal.light);
                roundedBox(ctx, env.box, env.box.r);
                ctx.fill();
            },
            alpha: p => (p.kind === 'bolt' ? (p.age < 0.05 || p.age > 0.09 ? clamp((p.life - p.age) / 0.12, 0, 1) : 0.25) : fade(p)),
            absolute: p => p.kind === 'bolt',
            draw: (ctx, p, a, env) => {
                if (p.kind === 'spark') {
                    drawSpark(ctx, p, a);
                    return;
                }
                const line = (points, width, color, alpha) => {
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = width;
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
                    ctx.stroke();
                };
                for (const points of [p.points, p.branch]) {
                    const thin = points === p.branch ? 0.6 : 1;
                    line(points, 9 * env.u * thin, hsl(p.color), a * 0.18);
                    line(points, 4 * env.u * thin, hsl(p.color), a * 0.45);
                    line(points, 1.4 * env.u * thin, '#fff', a);
                }
            }
        },

        // A star going off in the middle of the widget: a white core, rays that
        // sweep round, two shockwaves, and ejecta trailing light.
        supernova: {
            count: [36, 56, 84],
            blend: 'lighter',
            trail: 6,
            last: 1.2,
            setup: env => {
                env.rays = Array.from({ length: 16 }, (_, i) => ({
                    angle: (i / 16) * TAU + rand(-0.12, 0.12),
                    width: rand(0.018, 0.05),
                    reach: rand(0.8, 1.35),
                    color: i % 2 ? env.pal.light : env.pal.base
                }));
            },
            scene: (ctx, env) => {
                const t = env.t;
                if (t < 1.2) {
                    const grow = easeOut(t / 0.35);
                    const fadeOut = Math.pow(1 - t / 1.2, 1.6);
                    ctx.globalCompositeOperation = 'lighter';
                    for (const ray of env.rays) {
                        const angle = ray.angle + t * 0.35;
                        const length = env.R * 1.25 * ray.reach * grow;
                        const g = ctx.createLinearGradient(env.ox, env.oy, env.ox + Math.cos(angle) * length, env.oy + Math.sin(angle) * length);
                        g.addColorStop(0, hsl(ray.color, 0.55 * fadeOut));
                        g.addColorStop(1, hsl(ray.color, 0));
                        ctx.globalAlpha = 1;
                        ctx.fillStyle = g;
                        ctx.beginPath();
                        ctx.moveTo(env.ox, env.oy);
                        ctx.lineTo(env.ox + Math.cos(angle - ray.width) * length, env.oy + Math.sin(angle - ray.width) * length);
                        ctx.lineTo(env.ox + Math.cos(angle + ray.width) * length, env.oy + Math.sin(angle + ray.width) * length);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
                flash(ctx, env, 0, 0.45, env.R * 0.7, 0.9);
                ring(ctx, env, 0.02, 0.6, env.R * 0.9, 4, env.pal.light);
                ring(ctx, env, 0.16, 0.8, env.R * 1.3, 2.5, env.pal.base);
            },
            spawn: env => {
                const slow = Math.random() < 0.3;
                return {
                    x: env.ox, y: env.oy,
                    ...radial(env, slow ? 0.4 : 1.6, slow ? 1 : 3.4),
                    life: slow ? rand(1.3, 1.9) : rand(0.7, 1.2),
                    size: (slow ? rand(1.2, 2) : rand(1.5, 2.8)) * env.u,
                    slow, phase: rand(0, TAU),
                    color: Math.random() < 0.4 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt) => drag(p, dt, p.slow ? 1.8 : 3.4),
            streak: (ctx, p, a) => streak(ctx, p.trail, p.size * 1.1, p.color, a * 0.7),
            draw: (ctx, p, a) => {
                const twinkle = p.slow ? 0.55 + 0.45 * Math.sin(p.phase + p.age * 18) : 1;
                stamp(ctx, p.color, p.size * 3.2, a * 0.6 * twinkle);
                ctx.globalAlpha = a * twinkle;
                ctx.fillStyle = hsl(lighter(p.color, 0.3));
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.55, 0, TAU);
                ctx.fill();
            }
        },

        // Light spirals in to the middle of the widget from all round, then
        // bursts back out.
        vortex: {
            count: [34, 52, 78],
            blend: 'lighter',
            trail: 9,
            last: 1.9,
            spawn: env => {
                const duration = rand(0.75, 1);
                return {
                    kind: 'in', x: 0, y: 0, vx: 0, vy: 0,
                    theta: rand(0, TAU), r0: env.R * rand(0.75, 1.2), duration,
                    life: duration, size: rand(1.4, 2.6) * env.u,
                    color: Math.random() < 0.35 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                if (p.kind === 'in') {
                    const t = clamp(p.age / p.duration, 0, 1);
                    const r = p.r0 * (1 - easeIn(t) * 0.97);
                    const angle = p.theta + 3.2 * t * t;
                    p.x = env.ox + Math.cos(angle) * r;
                    p.y = env.oy + Math.sin(angle) * r * 0.8;
                    return;
                }
                drag(p, dt, 2.8);
            },
            scene: (ctx, env) => {
                const at = 1;
                if (env.t >= at && !env.burst) {
                    env.burst = true;
                    for (let i = 0; i < env.scaleCount(40); i++) {
                        env.add({ kind: 'out', x: env.ox, y: env.oy, ...radial(env, 1.2, 3), life: rand(0.6, 1.1), size: rand(1.4, 2.6) * env.u, color: pick(env.pal.spread) });
                    }
                }
                // The pull gathering at the middle, then letting go.
                if (env.t < at) stampAt(ctx, env.ox, env.oy, env.pal.light, env.R * 0.3 * easeIn(env.t / at), 0.5 * easeIn(env.t / at));
                flash(ctx, env, at, 0.4, env.R * 0.6, 0.85);
                ring(ctx, env, at, 0.55, env.R * 0.8, 3, env.pal.light);
            },
            streak: (ctx, p, a) => streak(ctx, p.trail, p.size * 1.1, p.color, a * 0.75),
            draw: (ctx, p, a) => {
                stamp(ctx, p.color, p.size * 2.8, a * 0.55);
                ctx.globalAlpha = a;
                ctx.fillStyle = hsl(lighter(p.color, 0.3));
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.5, 0, TAU);
                ctx.fill();
            }
        }
    };

    // Glow: soft light and smoke from textures, tinted to the effect's
    // colors. The textures load the first time one plays, and the effect
    // waits for them, so its first frame is never an empty one.
    Object.assign(SPECS, {
        bokeh: {
            count: [22, 34, 50],
            over: 0.9,
            blend: 'lighter',
            textures: ['circle_05', 'light_01'],
            spawn: env => {
                const at = anywhere(env);
                // Near ones are big, soft, and faint, the way a lens blurs them.
                const near = Math.random();
                return {
                    x: at.x, y: at.y,
                    vx: rand(-0.06, 0.06) * env.R, vy: -rand(0.05, 0.16) * env.box.h,
                    life: rand(1.6, 2.6), size: (0.14 + near * 0.5) * env.box.h * env.size, near,
                    kind: Math.random() < 0.75 ? 'circle_05' : 'light_01',
                    color: pick(env.pal.spread)
                };
            },
            alpha: swell,
            draw: (ctx, p, a) => texture(ctx, p.kind, p.color, p.size, a * (0.75 - p.near * 0.45))
        },

        glimmer: {
            count: [14, 22, 32],
            over: 1.2,
            blend: 'lighter',
            textures: ['star_05', 'star_06', 'star_07', 'star_08', 'star_09'],
            spawn: env => {
                const at = anywhere(env);
                return {
                    x: at.x, y: at.y, life: rand(0.7, 1.1),
                    size: rand(0.35, 0.8) * env.box.h * env.size,
                    rot: rand(-0.3, 0.3), spin: rand(-0.8, 0.8),
                    kind: pick(['star_06', 'star_07', 'star_08', 'star_09']),
                    color: Math.random() < 0.5 ? env.pal.light : pick(env.pal.spread)
                };
            },
            update: (p, dt) => { p.rot += p.spin * dt; },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                // Pops open, and pinches shut.
                const k = t < 0.25 ? easeOut(t / 0.25) : 1 - easeIn((t - 0.25) / 0.75);
                ctx.rotate(p.rot);
                texture(ctx, 'star_05', p.color, p.size * 0.9 * k, 0.5 * k);
                texture(ctx, p.kind, p.color, p.size * k, k);
                texture(ctx, p.kind, WHITE, p.size * 0.5 * k, 0.8 * k);
            }
        },

        fairy: {
            count: [70, 110, 160],
            over: 1.4,
            last: 1.45,
            blend: 'lighter',
            textures: ['star_04', 'star_05', 'star_07', 'star_09'],
            setup: env => {
                const ltr = Math.random() < 0.5;
                // A wand sweeping across in a wave, shedding dust behind it.
                env.wand = t => {
                    const k = clamp(t / 1.4, 0, 1);
                    return {
                        x: env.box.x + env.box.w * (ltr ? k : 1 - k),
                        y: env.box.y + env.box.h * (0.5 + 0.28 * Math.sin(k * TAU * 1.25))
                    };
                };
            },
            scene: (ctx, env) => {
                if (env.t > 1.45) return;
                const at = env.wand(env.t);
                ctx.globalCompositeOperation = 'lighter';
                ctx.translate(at.x, at.y);
                ctx.rotate(env.t * 3);
                texture(ctx, 'star_05', env.pal.base, env.box.h * 0.6 * env.size, 0.7);
                texture(ctx, 'star_09', env.pal.light, env.box.h * 0.42 * env.size, 1);
            },
            spawn: env => {
                const at = env.wand(env.t);
                return {
                    x: at.x + rand(-6, 6) * env.u, y: at.y + rand(-6, 6) * env.u,
                    vx: rand(-0.08, 0.08) * env.R, vy: rand(-0.05, 0.15) * env.box.h,
                    life: rand(0.8, 1.5), size: rand(0.1, 0.26) * env.box.h * env.size, seed: rand(0, TAU),
                    kind: Math.random() < 0.6 ? 'star_07' : 'star_04',
                    color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt, env) => {
                p.vy += env.box.h * 0.25 * dt;
                drag(p, dt, 1.2);
            },
            draw: (ctx, p, a) => texture(ctx, p.kind, p.color, p.size, a * (0.55 + 0.45 * Math.sin(p.seed + p.age * 18)))
        },

        mist: {
            count: [8, 12, 16],
            over: 0.6,
            // Painted, not added: smoke has to show on a light theme too.
            blend: 'source-over',
            textures: ['smoke_04', 'smoke_07', 'smoke_08'],
            spawn: (env, i) => {
                // Rolls in low from both sides, and meets in the middle.
                const left = i % 2 === 0;
                return {
                    x: left ? env.box.x - rand(0, 0.1) * env.box.w : env.box.x + env.box.w * rand(1, 1.1),
                    y: env.box.y + env.box.h * rand(0.35, 1),
                    vx: (left ? 1 : -1) * rand(0.22, 0.4) * env.box.w, vy: -rand(0.02, 0.1) * env.box.h,
                    life: rand(1.8, 2.6), size: rand(0.9, 1.5) * env.box.h * env.size,
                    rot: rand(0, TAU), spin: rand(-0.4, 0.4),
                    kind: pick(['smoke_04', 'smoke_07', 'smoke_08']),
                    color: Math.random() < 0.5 ? env.pal.light : env.pal.base
                };
            },
            update: (p, dt) => {
                p.rot += p.spin * dt;
                p.size *= 1 + 0.18 * dt;
                drag(p, dt, 0.5);
            },
            alpha: swell,
            draw: (ctx, p, a) => {
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size, a * 0.45);
            }
        },

        ripple: {
            count: [3, 4, 6],
            blend: 'lighter',
            last: 0.4,
            textures: ['circle_02', 'circle_03', 'light_03', 'star_05'],
            scene: (ctx, env) => {
                if (env.t > 0.4) return;
                const t = env.t / 0.4;
                ctx.globalCompositeOperation = 'lighter';
                ctx.translate(env.ox, env.oy);
                texture(ctx, 'star_05', env.pal.light, env.box.h * 1.3 * easeOut(t), 1 - t);
            },
            spawn: (env, i) => ({
                x: env.ox, y: env.oy, wait: i * 0.2, life: 1.3,
                reach: env.R * rand(2, 2.4) * env.size,
                kind: pick(['circle_02', 'circle_03', 'light_03']),
                color: i % 2 ? env.pal.base : env.pal.light
            }),
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                texture(ctx, p.kind, p.color, p.reach * easeOut(t), (1 - t) * 0.9);
            }
        },

        rune: {
            count: [14, 22, 32],
            // Painted, not added: thin lines of light vanish on a light theme.
            blend: 'source-over',
            textures: ['magic_01', 'magic_02', 'magic_03', 'star_07'],
            spawn: (env, i) => {
                // The first three are the circle, in layers turning against
                // each other; the rest are motes drawn in toward it.
                if (i < 3) {
                    return {
                        x: env.ox, y: env.oy, glyph: true, life: 2.1,
                        rot: rand(0, TAU), spin: [0.5, -0.35, 0.9][i],
                        size: env.box.h * env.size * [1.55, 1.15, 0.75][i],
                        kind: ['magic_02', 'magic_01', 'magic_03'][i],
                        color: [env.pal.base, env.pal.base, env.pal.light][i]
                    };
                }
                const angle = rand(0, TAU), far = env.box.h * rand(0.8, 1.4);
                const fx = env.ox + Math.cos(angle) * far, fy = env.oy + Math.sin(angle) * far;
                return {
                    x: fx, y: fy, fx, fy, wait: rand(0, 0.8), life: rand(0.7, 1.1),
                    size: rand(0.08, 0.16) * env.box.h * env.size, color: pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                if (p.glyph) {
                    p.rot += p.spin * dt;
                    return;
                }
                const k = easeIn(p.age / p.life);
                p.x = p.fx + (env.ox - p.fx) * k;
                p.y = p.fy + (env.oy - p.fy) * k;
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (!p.glyph) {
                    texture(ctx, 'star_07', p.color, p.size, Math.sin(Math.PI * t));
                    return;
                }
                const open = easeOut(t / 0.3);
                const out = t > 0.7 ? 1 - easeIn((t - 0.7) / 0.3) : 1;
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size * (0.6 + 0.4 * open) * (1 + (1 - out) * 0.15), open * out * 0.95);
            }
        },

        blaze: {
            count: [18, 28, 40],
            over: 1,
            blend: 'lighter',
            textures: ['muzzle_02', 'muzzle_04', 'muzzle_05', 'flame_05', 'flame_06'],
            spawn: env => ({
                x: env.box.x + env.box.w * rand(0.02, 0.98), y: env.box.y + env.box.h,
                life: rand(0.7, 1.2), size: rand(0.45, 0.95) * env.box.h * env.size, seed: rand(0, TAU),
                kind: pick(['muzzle_02', 'muzzle_04', 'muzzle_05', 'flame_05', 'flame_06']),
                flip: Math.random() < 0.5,
                color: env.pal.named ? pick(env.pal.spread) : pick([env.pal.base, env.pal.base, env.pal.light])
            }),
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                const rise = easeOut(t / 0.3) * (1 - easeIn((t - 0.55) / 0.45));
                const h = p.size * rise * (1 + 0.12 * Math.sin(p.seed + p.age * 30));
                if (h <= 0) return;
                // Standing on the bottom edge: the flame's foot on it.
                ctx.translate(0, -h / 2);
                if (p.flip) ctx.scale(-1, 1);
                texture(ctx, p.kind, p.color, h * 0.85, 0.9, 1 / 0.85);
                ctx.translate(0, h * 0.15);
                p.hot = p.hot || lighter(p.color, 0.3);
                texture(ctx, p.kind, p.hot, h * 0.5, 0.7, 0.7 / 0.5);
            }
        },

        meteors: {
            count: [5, 8, 12],
            over: 1.1,
            blend: 'lighter',
            textures: ['trace_06', 'star_04', 'star_05'],
            setup: env => { env.dir = Math.random() < 0.5 ? 1 : -1; },
            spawn: env => {
                const speed = env.R * rand(1.6, 2.4);
                const slope = rand(0.35, 0.6);
                const angle = env.dir > 0 ? slope : Math.PI - slope;
                return {
                    x: env.box.x + env.box.w * (env.dir > 0 ? rand(-0.3, 0.6) : rand(0.4, 1.3)),
                    y: env.box.y - env.box.h * rand(0.1, 0.4),
                    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, angle,
                    life: rand(0.7, 1), size: rand(0.12, 0.2) * env.box.h * env.size,
                    length: rand(0.9, 1.5) * env.box.h * env.size,
                    color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            draw: (ctx, p, a) => {
                // Turned so the tail trails behind, along +y.
                ctx.rotate(p.angle + Math.PI / 2);
                ctx.save();
                ctx.translate(0, p.length / 2);
                texture(ctx, 'trace_06', p.color, p.size * 1.4, a * 0.9, p.length / (p.size * 1.4));
                ctx.restore();
                texture(ctx, 'star_05', p.color, p.size * 3, a * 0.8);
                texture(ctx, 'star_04', WHITE, p.size * 2.2, a);
            }
        },

        swirl: {
            count: [18, 26, 36],
            blend: 'lighter',
            textures: ['twirl_01', 'twirl_02', 'twirl_03', 'star_07'],
            spawn: (env, i) => {
                // Four crescents spinning open, and sparks flung out in a spiral.
                if (i < 4) {
                    return {
                        x: env.ox, y: env.oy, twirl: true, wait: i * 0.12, life: 1.3,
                        rot: rand(0, TAU), spin: (i % 2 ? -1 : 1) * rand(4, 6),
                        size: env.box.h * env.size * (0.9 + i * 0.3),
                        kind: ['twirl_01', 'twirl_02', 'twirl_03', 'twirl_01'][i],
                        color: i % 2 ? env.pal.light : env.pal.base
                    };
                }
                return {
                    x: env.ox, y: env.oy, angle: rand(0, TAU), radius: env.box.h * rand(0.2, 0.4),
                    grow: env.R * rand(0.5, 0.9), spin: rand(3, 5) * (Math.random() < 0.5 ? 1 : -1),
                    wait: rand(0, 0.5), life: rand(0.8, 1.2),
                    size: rand(0.07, 0.14) * env.box.h * env.size, color: pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                if (p.twirl) {
                    p.rot += p.spin * dt;
                    return;
                }
                p.angle += p.spin * dt;
                p.radius += p.grow * dt;
                p.x = env.ox + Math.cos(p.angle) * p.radius;
                p.y = env.oy + Math.sin(p.angle) * p.radius * 0.8;
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (!p.twirl) {
                    texture(ctx, 'star_07', p.color, p.size, Math.sin(Math.PI * t));
                    return;
                }
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size * (0.7 + 0.5 * easeOut(t)), Math.sin(Math.PI * t) * 0.9);
            }
        }
    });

    // More Glow and Magic, from the same textures.
    Object.assign(SPECS, {
        shine: {
            count: [4, 6, 9],
            blend: 'lighter',
            last: 1.45,
            textures: ['trace_06', 'star_04', 'star_05'],
            // A sheen of light sweeping across the widget, like light over
            // glass, and a second, thinner one just behind it.
            scene: (ctx, env) => {
                roundedBox(ctx, env.box, env.box.r);
                ctx.clip();
                ctx.globalCompositeOperation = 'lighter';
                for (const [delay, width, strength] of [[0, 1.8, 0.8], [0.18, 0.7, 0.6]]) {
                    const t = (env.t - delay) / 1.2;
                    if (t <= 0 || t >= 1) continue;
                    ctx.save();
                    ctx.translate(env.box.x - env.box.w * 0.25 + env.box.w * 1.5 * easeInOut(t), env.box.y + env.box.h / 2);
                    ctx.rotate(0.35);
                    texture(ctx, 'trace_06', env.pal.light, env.box.h * width, strength * Math.sin(Math.PI * t), 2.4 / width);
                    ctx.restore();
                }
            },
            spawn: env => {
                // Glints where the sheen passes.
                const k = rand(0.1, 0.9);
                return {
                    x: env.box.x + env.box.w * k, y: env.box.y + env.box.h * rand(0.15, 0.85),
                    wait: 1.2 * k * 0.9, life: rand(0.35, 0.55), size: rand(0.25, 0.45) * env.box.h * env.size
                };
            },
            alpha: () => 1,
            draw: (ctx, p, a, env) => {
                const k = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1));
                texture(ctx, 'star_05', env.pal.light, p.size, k * 0.6);
                texture(ctx, 'star_04', WHITE, p.size * 0.8, k);
            }
        },

        flare: {
            // No particles: it is all one scene.
            blend: 'lighter',
            last: 1.7,
            textures: ['flare_01', 'star_02', 'circle_04', 'light_02', 'circle_05'],
            setup: env => {
                env.ltr = Math.random() < 0.5;
                // Ghosts along the line from the light through the middle,
                // the way a camera lens throws them.
                env.ghosts = [[0.55, 0.22, 'circle_05'], [1.25, 0.5, 'circle_04'], [1.6, 0.16, 'circle_05'], [2.1, 0.7, 'light_02']];
            },
            scene: (ctx, env) => {
                const t = env.t / 1.6;
                if (t >= 1) return;
                const k = Math.sin(Math.PI * t);
                const cx = env.box.x + env.box.w / 2, cy = env.box.y + env.box.h / 2;
                const sx = env.box.x + env.box.w * (env.ltr ? -0.05 + 0.6 * t : 1.05 - 0.6 * t);
                const sy = env.box.y + env.box.h * (0.1 + 0.15 * t);
                roundedBox(ctx, env.box, env.box.r);
                ctx.clip();
                ctx.globalCompositeOperation = 'lighter';
                ctx.save();
                ctx.translate(sx, sy);
                texture(ctx, 'flare_01', env.pal.light, env.box.w * 1.3, k * 0.9, 0.25);
                texture(ctx, 'star_02', env.pal.light, env.box.h * 1.1, k);
                texture(ctx, 'star_02', WHITE, env.box.h * 0.5, k);
                ctx.restore();
                env.ghosts.forEach(([along, size, kind], i) => {
                    ctx.save();
                    ctx.translate(sx + (cx - sx) * along, sy + (cy - sy) * along);
                    texture(ctx, kind, i % 2 ? env.pal.base : env.pal.light, env.box.h * size, k * 0.35);
                    ctx.restore();
                });
            }
        },

        halo: {
            count: [8, 12, 16],
            blend: 'lighter',
            textures: ['circle_03', 'light_02', 'star_07'],
            spawn: (env, i, n) => {
                const art = env.art || { x: env.ox - env.box.h * 0.4, y: env.oy - env.box.h * 0.4, w: env.box.h * 0.8, h: env.box.h * 0.8 };
                const cx = art.x + art.w / 2, cy = art.y + art.h / 2;
                const reach = Math.max(art.w, art.h) * 1.45 * env.size;
                if (i < 2) return { x: cx, y: cy, ring: i, life: 1.9, reach, color: i ? env.pal.base : env.pal.light };
                // Glints running round the ring.
                return { x: cx, y: cy, cx, cy, angle: ((i - 2) / (n - 2)) * TAU, radius: reach * 0.42, spin: 1.6, life: 1.9, size: reach * 0.14, color: env.pal.light };
            },
            update: (p, dt) => {
                if (p.ring !== undefined) return;
                p.angle += p.spin * dt;
                p.x = p.cx + Math.cos(p.angle) * p.radius;
                p.y = p.cy + Math.sin(p.angle) * p.radius;
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                const open = easeOut(t / 0.3);
                const out = t > 0.7 ? 1 - easeIn((t - 0.7) / 0.3) : 1;
                if (p.ring === undefined) {
                    texture(ctx, 'star_07', p.color, p.size, open * out);
                    return;
                }
                // Settles into place, and breathes twice.
                const breathe = 1 + 0.05 * Math.sin(t * TAU * 2);
                const size = p.reach * (0.8 + 0.2 * open) * breathe * (p.ring ? 1.25 : 1);
                texture(ctx, p.ring ? 'light_02' : 'circle_03', p.color, size, open * out * (p.ring ? 0.5 : 0.9));
            }
        },

        glitter: {
            count: [70, 110, 160],
            over: 1.2,
            blend: 'lighter',
            textures: ['star_01', 'star_04', 'star_05'],
            spawn: env => {
                // A shower drifting down over the whole widget, each fleck
                // catching the light now and then as it turns.
                const at = Math.random() < 0.5 ? alongTop(env, -4) : anywhere(env);
                return {
                    x: at.x, y: at.y, vx: rand(-0.04, 0.04) * env.R, vy: env.box.h * rand(0.12, 0.3), life: rand(1.2, 1.8),
                    size: rand(0.06, 0.13) * env.box.h * env.size, seed: rand(0, TAU), rate: rand(8, 16),
                    kind: Math.random() < 0.5 ? 'star_01' : 'star_04', color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt, env) => { p.vx += Math.sin(p.seed + p.age * 4) * env.u * 20 * dt; },
            alpha: swell,
            draw: (ctx, p, a) => {
                const glint = Math.max(0, Math.sin(p.seed + p.age * p.rate)) ** 3;
                texture(ctx, 'star_05', p.color, p.size * 0.9, a * 0.5);
                texture(ctx, p.kind, p.color, p.size * (0.7 + glint * 1.3), a * (0.4 + 0.6 * glint));
                texture(ctx, p.kind, WHITE, p.size * glint, a * glint);
            }
        },

        wisps: {
            count: [10, 14, 20],
            over: 1,
            blend: 'lighter',
            textures: ['flame_01', 'flame_02', 'flame_03', 'flame_04'],
            spawn: env => {
                const from = alongBottom(env, -10);
                return {
                    x: from.x, y: from.y, vx: rand(-0.05, 0.05) * env.R, vy: -rand(0.3, 0.5) * env.box.h,
                    life: rand(1.6, 2.2), size: rand(0.6, 1) * env.box.h * env.size,
                    rot: rand(-0.3, 0.3), seed: rand(0, TAU),
                    kind: pick(['flame_01', 'flame_02', 'flame_03', 'flame_04']), color: pick(env.pal.spread)
                };
            },
            update: (p, dt, env) => {
                p.vx += Math.sin(p.seed + p.age * 2.2) * env.u * 30 * dt;
                p.rot = Math.sin(p.seed + p.age * 1.4) * 0.35;
            },
            alpha: swell,
            draw: (ctx, p, a) => {
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size, a, 1.2);
                p.hot = p.hot || lighter(p.color, 0.25);
                texture(ctx, p.kind, p.hot, p.size * 0.7, a * 0.6, 1.2);
            }
        },

        love: {
            count: [14, 22, 32],
            over: 1.1,
            blend: 'lighter',
            textures: ['symbol_01', 'star_05'],
            spawn: env => {
                const from = Math.random() < 0.6 ? alongBottom(env, -4) : anywhere(env);
                // Pink, unless a palette says otherwise, with a little of the album in it.
                const color = env.pal.named ? pick(env.pal.spread) : Math.random() < 0.7 ? { h: 345 + rand(-12, 12), s: 0.85, l: 0.72 } : env.pal.light;
                return {
                    x: from.x, y: from.y, vy: -rand(0.25, 0.5) * env.box.h, life: rand(1.3, 2),
                    size: rand(0.18, 0.34) * env.box.h * env.size, seed: rand(0, TAU), color
                };
            },
            update: (p, dt, env) => { p.vx = Math.sin(p.seed + p.age * 3) * env.u * 14; },
            alpha: swell,
            draw: (ctx, p, a) => {
                // Two beats, like a heart.
                const beat = 1 + 0.14 * Math.max(0, Math.sin(p.age * 11 + p.seed)) ** 4;
                ctx.rotate(Math.sin(p.seed + p.age * 3) * 0.2);
                texture(ctx, 'star_05', p.color, p.size * 2, a * 0.35);
                texture(ctx, 'symbol_01', p.color, p.size * beat, a);
                p.hot = p.hot || lighter(p.color, 0.2);
                texture(ctx, 'symbol_01', p.hot, p.size * beat * 0.55, a * 0.6);
            }
        },

        starfall: {
            count: [14, 22, 32],
            over: 1,
            blend: 'lighter',
            textures: ['symbol_02', 'star_05'],
            spawn: env => {
                const from = alongTop(env, 10);
                return {
                    x: from.x, y: from.y, vx: rand(-0.1, 0.1) * env.R, vy: rand(0.2, 0.45) * env.box.h,
                    life: rand(1.1, 1.6), size: rand(0.22, 0.4) * env.box.h * env.size,
                    rot: rand(0, TAU), spin: rand(-4, 4), color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt, env) => {
                p.vy += env.box.h * 1.1 * dt;
                p.rot += p.spin * dt;
            },
            draw: (ctx, p, a) => {
                texture(ctx, 'star_05', p.color, p.size * 2.2, a * 0.45);
                ctx.rotate(p.rot);
                texture(ctx, 'symbol_02', p.color, p.size, a);
                texture(ctx, 'symbol_02', WHITE, p.size * 0.45, a * 0.8);
            }
        },

        fountain: {
            count: [60, 90, 130],
            over: 1.2,
            blend: 'lighter',
            textures: ['star_04', 'star_05', 'star_07'],
            spawn: env => {
                // One spout on a square widget, two on a wide one.
                const spouts = env.box.w > env.box.h * 2 ? [0.3, 0.7] : [0.5];
                return {
                    x: env.box.x + env.box.w * pick(spouts), y: env.box.y + env.box.h,
                    vx: rand(-0.3, 0.3) * env.box.h * 1.4, vy: -rand(1.2, 1.7) * env.box.h,
                    life: rand(1.1, 1.6), size: rand(0.12, 0.24) * env.box.h * env.size, seed: rand(0, TAU),
                    kind: Math.random() < 0.6 ? 'star_07' : 'star_04', color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt, env) => { p.vy += env.box.h * 2.4 * dt; },
            draw: (ctx, p, a) => {
                texture(ctx, 'star_05', p.color, p.size * 1.8, a * 0.4);
                texture(ctx, p.kind, p.color, p.size, a * (0.6 + 0.4 * Math.sin(p.seed + p.age * 20)));
            }
        },

        bloom: {
            count: [14, 18, 24],
            blend: 'lighter',
            textures: ['magic_04', 'star_03', 'light_02', 'trace_06'],
            spawn: (env, i, n) => {
                if (i < 3) {
                    return {
                        x: env.ox, y: env.oy, core: i, life: [1.5, 1.3, 1.6][i], rot: rand(0, TAU),
                        size: env.box.h * env.size * [1.6, 1.1, 2][i],
                        kind: ['magic_04', 'star_03', 'light_02'][i],
                        color: [env.pal.light, WHITE, env.pal.base][i]
                    };
                }
                // Petals of light opening out from it.
                const angle = ((i - 3) / (n - 3)) * TAU + rand(-0.1, 0.1);
                const speed = env.R * rand(1, 1.4);
                return {
                    x: env.ox, y: env.oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, angle,
                    wait: 0.12, life: rand(0.8, 1.1), size: rand(0.12, 0.2) * env.box.h * env.size,
                    color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt) => { if (p.core === undefined) drag(p, dt, 2.2); },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (p.core === undefined) {
                    ctx.rotate(p.angle + Math.PI / 2);
                    texture(ctx, 'trace_06', p.color, p.size, (1 - t), 3.5 * (1 - t * 0.6));
                    return;
                }
                const open = easeOut(t / 0.25), out = 1 - easeIn(t);
                ctx.rotate(p.rot + t * 0.6 * (p.core === 1 ? -1 : 1));
                texture(ctx, p.kind, p.color, p.size * (0.4 + 0.6 * open), open * out * (p.core === 2 ? 0.5 : 0.9));
            }
        },

        portal: {
            count: [26, 36, 50],
            blend: 'lighter',
            last: 2.2,
            textures: ['smoke_09', 'smoke_10', 'twirl_02', 'star_07', 'star_05'],
            scene: (ctx, env) => {
                // It opens, turns, and closes with a flash.
                const t = env.t;
                const size = env.box.h * 1.35 * env.size * (t < 0.4 ? easeOut(t / 0.4) : t > 1.7 ? 1 - easeIn((t - 1.7) / 0.3) : 1);
                ctx.globalCompositeOperation = 'lighter';
                ctx.translate(env.ox, env.oy);
                if (size > 0 && t < 2) {
                    ctx.save();
                    ctx.rotate(t * 2.2);
                    texture(ctx, 'smoke_10', env.pal.base, size, 0.8);
                    ctx.rotate(-t * 4.4);
                    texture(ctx, 'smoke_09', env.pal.light, size * 0.8, 0.6);
                    ctx.rotate(t * 7);
                    texture(ctx, 'twirl_02', env.pal.light, size * 0.6, 0.8);
                    ctx.restore();
                }
                if (t > 1.9) texture(ctx, 'star_05', env.pal.light, env.box.h * 2.2 * easeOut((t - 1.9) / 0.3), 1 - (t - 1.9) / 0.3);
            },
            spawn: env => ({
                x: env.ox, y: env.oy, angle: rand(0, TAU), radius: env.box.h * rand(0.9, 1.4), spin: rand(2.5, 4),
                wait: rand(0.1, 1.2), life: rand(0.6, 0.9), size: rand(0.08, 0.16) * env.box.h * env.size, color: pick(env.pal.spread)
            }),
            update: (p, dt, env) => {
                // Drawn in, round and round.
                p.angle += p.spin * dt;
                const r = p.radius * (1 - easeIn(p.age / p.life));
                p.x = env.ox + Math.cos(p.angle) * r;
                p.y = env.oy + Math.sin(p.angle) * r * 0.8;
            },
            alpha: () => 1,
            draw: (ctx, p) => texture(ctx, 'star_07', p.color, p.size, Math.sin(Math.PI * clamp(p.age / p.life, 0, 1)))
        },

        poof: {
            count: [24, 36, 50],
            blend: 'source-over',
            textures: ['smoke_01', 'smoke_02', 'smoke_05', 'star_07'],
            spawn: (env, i) => {
                const n = env.emitters.length;
                const at = env.emitters[i % n];
                // Three puffs of smoke at each point, then sparkles thrown out of them.
                if (i < n * 3) {
                    return {
                        x: at.x + rand(-0.12, 0.12) * env.box.h, y: at.y + rand(-0.12, 0.12) * env.box.h, puff: true,
                        wait: at.at, life: rand(0.8, 1.1), size: rand(0.8, 1.2) * env.box.h * env.size,
                        rot: rand(0, TAU), spin: rand(-1, 1), kind: pick(['smoke_01', 'smoke_02', 'smoke_05']),
                        color: Math.random() < 0.6 ? env.pal.light : env.pal.base
                    };
                }
                return {
                    x: at.x, y: at.y, ...radial(env, 0.3, 0.9), wait: at.at + 0.05, life: rand(0.6, 1),
                    size: rand(0.1, 0.18) * env.box.h * env.size, color: pick(env.pal.spread)
                };
            },
            update: (p, dt) => {
                if (p.puff) p.rot += p.spin * dt;
                else drag(p, dt, 3);
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (!p.puff) {
                    texture(ctx, 'star_07', p.color, p.size, 1 - t);
                    texture(ctx, 'star_07', WHITE, p.size * 0.5, 1 - t);
                    return;
                }
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size * (0.3 + 0.7 * easeOut(t / 0.45)), 0.75 * (1 - easeIn(t)));
            }
        },

        crackle: {
            count: [16, 26, 38],
            over: 1.2,
            blend: 'lighter',
            textures: ['spark_01', 'spark_02', 'spark_03', 'spark_04', 'star_04'],
            spawn: env => {
                const at = anywhere(env);
                return {
                    x: at.x, y: at.y, life: rand(0.14, 0.28), rot: rand(0, TAU), flip: Math.random() < 0.5,
                    size: rand(0.5, 0.9) * env.box.h * env.size, seed: rand(0, TAU),
                    kind: pick(['spark_01', 'spark_02', 'spark_03', 'spark_04']),
                    color: Math.random() < 0.5 ? env.pal.light : pick(env.pal.spread)
                };
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                // Flickers on and off, as electricity does.
                const on = Math.sin(p.seed + p.age * 90) > -0.3 ? 1 : 0.25;
                ctx.rotate(p.rot);
                if (p.flip) ctx.scale(-1, 1);
                texture(ctx, p.kind, p.color, p.size, on);
                texture(ctx, p.kind, WHITE, p.size * 0.9, on * 0.5);
                texture(ctx, 'star_04', p.color, p.size * 0.4, on * 0.7);
            }
        },

        slash: {
            count: [14, 22, 30],
            blend: 'lighter',
            textures: ['slash_01', 'slash_02', 'slash_03', 'slash_04', 'scratch_01', 'star_04'],
            spawn: (env, i) => {
                const cuts = 2 + Math.min(2, Math.floor(env.box.w / env.box.h / 1.5));
                const x = env.box.x + env.box.w * ((i % cuts) + 0.5) / cuts + rand(-0.08, 0.08) * env.box.w;
                const y = env.box.y + env.box.h * rand(0.3, 0.7);
                // The cuts, a beat apart; the rest are sparks off them.
                if (i < cuts) {
                    return {
                        x, y, cut: true, wait: i * 0.14, life: 0.55, rot: rand(-0.6, 0.6) + (Math.random() < 0.5 ? Math.PI : 0),
                        size: rand(1.2, 1.7) * env.box.h * env.size,
                        kind: pick(['slash_01', 'slash_02', 'slash_03', 'slash_04', 'scratch_01']),
                        color: Math.random() < 0.5 ? env.pal.light : env.pal.base
                    };
                }
                return {
                    x, y, ...radial(env, 0.4, 1.1), wait: (i % cuts) * 0.14 + 0.03, life: rand(0.4, 0.7),
                    size: rand(0.1, 0.18) * env.box.h * env.size, color: env.pal.light
                };
            },
            update: (p, dt) => { if (!p.cut) drag(p, dt, 4); },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (!p.cut) {
                    texture(ctx, 'star_04', p.color, p.size, 1 - t);
                    return;
                }
                // Snaps open, then thins and fades.
                ctx.rotate(p.rot);
                const open = easeOut(t / 0.12);
                texture(ctx, p.kind, p.color, p.size * (0.5 + 0.5 * open), (1 - easeIn(t)) * 0.95, 1 - t * 0.4);
                texture(ctx, p.kind, WHITE, p.size * (0.5 + 0.5 * open) * 0.96, (1 - t) * 0.5, 0.8 - t * 0.4);
            }
        },

        impact: {
            count: [30, 45, 64],
            blend: 'lighter',
            textures: ['scorch_01', 'scorch_02', 'scorch_03', 'circle_02', 'star_04'],
            spawn: (env, i) => {
                const n = env.emitters.length;
                const at = env.emitters[i % n];
                // At each point: a burst, a shockwave, then sparks.
                if (i < n * 2) {
                    const wave = i >= n;
                    return {
                        x: at.x, y: at.y, part: wave ? 'wave' : 'burst', wait: at.at, life: wave ? 0.6 : 0.5,
                        rot: rand(0, TAU), size: env.box.h * env.size * (wave ? rand(1.4, 1.8) : rand(0.8, 1.1)),
                        kind: wave ? 'circle_02' : pick(['scorch_01', 'scorch_02', 'scorch_03']),
                        color: wave ? env.pal.light : pick(env.pal.spread)
                    };
                }
                return {
                    x: at.x, y: at.y, ...radial(env, 0.5, 1.4), wait: at.at, life: rand(0.4, 0.8),
                    size: rand(0.08, 0.16) * env.box.h * env.size, color: pick([env.pal.light, ...env.pal.spread])
                };
            },
            update: (p, dt, env) => {
                if (p.part) return;
                drag(p, dt, 3.5);
                p.vy += env.box.h * 0.6 * dt;
            },
            alpha: () => 1,
            draw: (ctx, p) => {
                const t = p.age / p.life;
                if (!p.part) {
                    texture(ctx, 'star_04', p.color, p.size, 1 - t);
                    return;
                }
                ctx.rotate(p.rot);
                if (p.part === 'wave') {
                    texture(ctx, p.kind, p.color, p.size * easeOut(t), (1 - t) * 0.8);
                    return;
                }
                texture(ctx, p.kind, p.color, p.size * (0.25 + 0.75 * easeOut(t / 0.3)), 1 - easeIn(t));
                texture(ctx, p.kind, WHITE, p.size * 0.5 * (0.25 + 0.75 * easeOut(t / 0.3)), (1 - t) * 0.6);
            }
        }
    });

    /* ------------------------------------------------------------ layer */

    const STYLE = `
.qfx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2147483000; contain: strict; }
.qfx-layer.qfx-page { position: fixed; }
.qfx-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.qfx-layer .qfx-take::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, .3) 50%, transparent 70%);
  translate: -120% 0; animation: qfx-sheen 1.1s .35s cubic-bezier(.4, 0, .2, 1) both;
}
.qfx-layer .qfx-take {
  position: absolute; box-sizing: border-box; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: .6em; padding: 0 6%;
  font: 700 var(--qfx-size, 16px)/1.1 var(--qfx-font, system-ui, sans-serif); color: #fff; text-align: left;
  background:
    radial-gradient(60% 90% at var(--qfx-glow-x, 30%) 50%, var(--qfx-glow) 0%, transparent 70%),
    linear-gradient(150deg, var(--qfx-bg1), var(--qfx-bg2));
  box-shadow: inset 0 0 0 1px var(--qfx-rim);
  animation: qfx-take-in .6s cubic-bezier(.2, 1.15, .3, 1) both, qfx-take-out .38s cubic-bezier(.5, 0, .8, .3) var(--qfx-hold, 4s) forwards;
}
.qfx-layer .qfx-take.qfx-stack { flex-direction: column; text-align: center; gap: .25em; --qfx-glow-x: 50%; }
.qfx-layer .qfx-take-num {
  flex: none; font-size: var(--qfx-num, 3em); font-weight: 900; line-height: .95; letter-spacing: -.04em;
  /* Room for glyphs that lean past their box, as script and italic ones do:
     the gradient is painted only inside it. */
  padding: .06em .14em;
  font-variant-numeric: tabular-nums; color: transparent;
  background: linear-gradient(180deg, #fff 25%, var(--qfx-accent-text) 100%); -webkit-background-clip: text; background-clip: text;
  animation: qfx-num-in .8s .1s cubic-bezier(.2, 1.4, .3, 1) both;
}
.qfx-layer .qfx-take-text { min-width: 0; max-width: 100%; animation: qfx-text-in .6s .22s cubic-bezier(.2, 1, .3, 1) both; }
.qfx-layer .qfx-kicker { display: block; font-size: .62em; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; opacity: .72; margin-bottom: .12em; }
.qfx-layer .qfx-name { display: block; padding-right: .1em; font-size: 1.35em; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--qfx-accent-text); font-weight: 800; }
.qfx-layer .qfx-line { display: block; opacity: .82; font-weight: 600; margin-top: .15em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@keyframes qfx-sheen { to { translate: 120% 0; } }
@keyframes qfx-take-in { from { opacity: 0; scale: .9; } to { opacity: 1; scale: 1; } }
@keyframes qfx-take-out { to { opacity: 0; scale: 1.04; } }
@keyframes qfx-num-in { from { opacity: 0; scale: .4; translate: 0 .15em; } to { opacity: 1; scale: 1; translate: 0 0; } }
@keyframes qfx-text-in { from { opacity: 0; translate: .6em 0; } to { opacity: 1; translate: 0 0; } }
`;

    function ensureStyle(doc) {
        if (doc.getElementById('qfx-style')) return;
        const style = doc.createElement('style');
        style.id = 'qfx-style';
        style.textContent = STYLE;
        doc.head.appendChild(style);
    }

    /** The layer over a host, made on first use and kept while anything is on it. */
    function layerFor(host) {
        const target = host || document.body;
        ensureStyle(target.ownerDocument);

        let layer = target.querySelector(':scope > .qfx-layer');
        if (!layer) {
            layer = target.ownerDocument.createElement('div');
            layer.className = 'qfx-layer' + (target === target.ownerDocument.body ? ' qfx-page' : '');
            target.appendChild(layer);
        }

        return layer;
    }

    function tidy(layer) {
        if (layer.isConnected && !layer.children.length) layer.remove();
    }

    /**
     * Where an element sits on the layer, in the layer's own pixels. Positions
     * are read in whatever units the page lays out in - zoom and transforms
     * included - and brought back.
     */
    function boxOn(layer, element) {
        const W = layer.clientWidth || 1, H = layer.clientHeight || 1;
        const outer = layer.getBoundingClientRect();
        const k = outer.width ? W / outer.width : 1;
        const inner = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null;

        if (!inner || !inner.width || !inner.height) return { x: 0, y: 0, w: W, h: H, k };
        return {
            x: (inner.left - outer.left) * k, y: (inner.top - outer.top) * k,
            w: inner.width * k, h: inner.height * k, k
        };
    }

    function radiusOf(element, fallback) {
        if (!element) return fallback;
        const r = parseFloat(getComputedStyle(element).borderTopLeftRadius);
        return Number.isFinite(r) ? r : fallback;
    }

    /** The widget's visible parts, where they are on the layer. */
    function artOn(layer, target) {
        const art = target && target.querySelector('.cover, .fx-art, .fx-cover');
        if (!art || art.getBoundingClientRect().width < 3) return null;
        return boxOn(layer, art);
    }

    function partsOf(layer, target) {
        if (!target) return [];
        return [...target.children].filter(element => {
            if (element.classList.contains('qfx-layer')) return false;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
        }).map(element => {
            const style = getComputedStyle(element);
            const solid = /^(IMG|VIDEO|CANVAS|SVG)$/i.test(element.tagName) ||
                style.backgroundImage !== 'none' || parseFloat(style.borderTopWidth) > 0 ||
                !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(style.backgroundColor);
            return { el: element, ...boxOn(layer, element), r: radiusOf(element, 0), solid };
        });
    }

    /* ------------------------------------------------------------- play */

    const running = new Set();
    // Widgets a takeover has stepped aside, so stop() can bring them back.
    const stepped = new Set();
    let takeovers = 0;

    const STYLE_DEFAULTS = { colors: 'album', amount: 1, size: 1, speed: 1 };

    // Ambience steps aside while a reward plays; see ambience() below.
    const ambiences = new Set();
    const hush = () => { for (const a of ambiences) a.hush(); };
    const unhush = () => { if (!running.size && !takeovers) for (const a of ambiences) a.unhush(); };

    /**
     * Plays one effect over the host. Resolves when it has finished.
     *
     * `target` is the widget: what the particles fill, what the comets run
     * round, and whose parts move. `from` moves the middle of the effects
     * that have one - supernova, vortex, warp - off the widget's own middle.
     * `scale` is the page's render scale, so particles are drawn at the
     * pixels OBS shows. `style` is the streamer's (or the sub's) take on it:
     * colors, amount, size, speed.
     */
    function play(name, options = {}) {
        const spec = SPECS[name];
        if (!spec) return Promise.resolve(false);

        const style = { ...STYLE_DEFAULTS, ...(options.style || {}) };
        const amount = clamp(Number(style.amount) || 1, 0.25, 3);
        const size = clamp(Number(style.size) || 1, 0.4, 2.5);
        const speed = clamp(Number(style.speed) || 1, 0.4, 2.5);

        const layer = layerFor(options.host);
        const canvas = layer.ownerDocument.createElement('canvas');
        canvas.className = 'qfx-canvas';
        layer.appendChild(canvas);

        const W = layer.clientWidth || 1;
        const H = layer.clientHeight || 1;
        const outer = layer.getBoundingClientRect();
        const density = Math.max(outer.width / W || 1, Number(options.scale) || 1) * (window.devicePixelRatio || 1);

        canvas.width = Math.max(1, Math.round(W * density));
        canvas.height = Math.max(1, Math.round(H * density));
        const ctx = canvas.getContext('2d');

        const target = options.target || null;
        const tb = boxOn(layer, target);
        const box = { x: tb.x, y: tb.y, w: tb.w, h: tb.h, r: radiusOf(target, 14) };
        const middle = options.from ? boxOn(layer, options.from) : null;
        const ox = middle ? middle.x + middle.w / 2 : box.x + box.w / 2;
        const oy = middle ? middle.y + middle.h / 2 : box.y + box.h / 2;

        const u = clamp(box.h / 110, 0.65, 1.7) * size;
        const inset = 3 * u;
        const power = clamp(Math.round(Number(options.power) || 2), 1, 3);
        const particles = [];

        // Where the bursts go off: a few points spread along the widget, a
        // beat apart, left to right or right to left.
        const across = clamp(Math.round(box.w / Math.max(box.h, 1) * 1.1), 2, 5);
        const ltr = Math.random() < 0.5;
        const emitters = Array.from({ length: across }, (_, i) => ({
            x: box.x + box.w * ((i + 0.5) / across + rand(-0.06, 0.06)),
            y: box.y + box.h * rand(0.35, 0.65),
            at: (ltr ? i : across - 1 - i) * 0.12
        }));

        const env = {
            W, H, ox, oy, u, box, emitters, size, speed,
            R: Math.hypot(box.w, box.h) / 2,
            grid: Math.max(2, Math.round(3 * u)),
            pal: palette(options.colors, style.colors),
            edge: perimeter({ x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2, r: Math.max(0, box.r - inset) }),
            target,
            parts: partsOf(layer, target),
            // The album art, for effects drawn round it. The widget's middle if there is none.
            art: artOn(layer, target),
            animations: [],
            t: 0,
            scaleCount: n => Math.max(1, Math.round(n * amount)),
            add: p => {
                p.age = 0;
                p.vx = p.vx || 0;
                p.vy = p.vy || 0;
                particles.push(p);
            }
        };

        const total = spec.count ? Math.max(1, Math.round(spec.count[power - 1] * amount)) : 0;
        const over = spec.over || 0;
        let emitted = 0;

        const emit = count => {
            for (let i = 0; i < count; i++) env.add(spec.spawn(env, emitted + i, total));
        };

        hush();

        // A Glow effect waits for its textures - a moment, the first time.
        const ready = spec.textures ? loadTextures(spec.textures) : Promise.resolve(true);

        return new Promise(resolve => {
            let last = performance.now();
            const token = { stop: null };
            running.add(token);

            const finish = () => {
                if (!running.has(token)) return;
                running.delete(token);
                // Whatever was moving the widget's parts stops here, and they
                // are back exactly where they were.
                for (const animation of env.animations) animation.cancel();
                canvas.remove();
                tidy(layer);
                unhush();
                resolve(true);
            };
            token.stop = () => { cancelAnimationFrame(token.frame); finish(); };

            try {
                if (spec.setup) spec.setup(env);
                if (spec.moves) spec.moves(env);
            } catch (err) {
                console.error('Effect failed:', err);
                finish();
                return;
            }

            const frame = now => {
                try {
                    // A frame's timestamp can be from just before the effect
                    // started; a step back in time drew rings of negative size,
                    // which threw and left nothing on screen. A dropped frame
                    // is not made up either: a long gap would throw every
                    // particle across the screen in one step.
                    const dt = clamp((now - last) / 1000, 0, 1 / 20) * speed;
                    last = now;
                    env.t += dt;

                    const due = over ? Math.min(total, Math.ceil(total * env.t / over)) : total;
                    if (due > emitted) {
                        emit(due - emitted);
                        emitted = due;
                    }

                    ctx.setTransform(density, 0, 0, density, 0, 0);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = 1;
                    ctx.clearRect(0, 0, W, H);

                    if (spec.scene) {
                        ctx.save();
                        spec.scene(ctx, env);
                        ctx.restore();
                    }

                    ctx.globalCompositeOperation = spec.blend || 'source-over';

                    for (let i = particles.length - 1; i >= 0; i--) {
                        const p = particles[i];
                        // Let out with the rest, but not on its way yet.
                        if (p.wait > 0) {
                            p.wait -= dt;
                            continue;
                        }

                        p.age += dt;
                        if (p.age >= p.life) {
                            particles.splice(i, 1);
                            continue;
                        }

                        if (spec.update) spec.update(p, dt, env);
                        if (p.age >= p.life) {
                            particles.splice(i, 1);
                            continue;
                        }
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;

                        if (spec.trail) {
                            (p.trail = p.trail || []).push({ x: p.x, y: p.y });
                            if (p.trail.length > spec.trail) p.trail.shift();
                        }

                        const alpha = spec.alpha ? spec.alpha(p) : fade(p);
                        if (alpha <= 0) continue;

                        if (spec.streak) {
                            ctx.save();
                            spec.streak(ctx, p, alpha, env);
                            ctx.restore();
                        }

                        ctx.save();
                        if (!(spec.absolute && spec.absolute(p))) ctx.translate(p.x, p.y);
                        spec.draw(ctx, p, alpha, env);
                        ctx.restore();
                    }

                    ctx.globalAlpha = 1;

                    const moving = env.animations.some(animation => animation.playState === 'running' || animation.playState === 'pending');
                    const moreToCome = emitted < total || env.t < (spec.last || 0) || moving;
                    if (!particles.length && !moreToCome) {
                        finish();
                        return;
                    }
                } catch (err) {
                    // Never leave a half-drawn layer, or a part out of place,
                    // behind on stream.
                    console.error('Effect failed:', err);
                    finish();
                    return;
                }

                token.frame = requestAnimationFrame(frame);
            };

            ready.then(ok => {
                if (!running.has(token)) return;
                if (!ok) {
                    finish();
                    return;
                }
                last = performance.now();
                token.frame = requestAnimationFrame(frame);
            });
        });
    }

    /* -------------------------------------------------------- milestone */

    function ordinal(n) {
        const mod100 = n % 100;
        const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
        return n + suffix;
    }

    /** The takeover's colors, from the album. */
    function milestoneColors(element, colors) {
        const pal = palette(colors);
        const accent = { ...pal.base, l: clamp(pal.base.l, 0.55, 0.7) };
        const dark = { ...pal.dark, s: Math.min(pal.dark.s, 0.55) };
        element.style.setProperty('--qfx-bg1', hsl({ ...dark, l: clamp(dark.l + 0.04, 0.1, 0.2) }));
        element.style.setProperty('--qfx-bg2', hsl({ ...dark, l: clamp(dark.l - 0.04, 0.03, 0.08) }));
        element.style.setProperty('--qfx-glow', hsl(accent, 0.42));
        element.style.setProperty('--qfx-rim', hsl(accent, 0.55));
        element.style.setProperty('--qfx-accent-text', hsl({ ...accent, l: 0.8 }));
    }

    /**
     * Makes the takeover's contents fit inside it, whatever the widget's
     * shape. The number is sized for its digits - 1000 is twice as wide as 10
     * - and the words shrink together until the whole name and the request
     * line are in. A name too long even then is cut short with an ellipsis,
     * never cut off at the edge.
     */
    function fitTake(card, num, text, box, stacked) {
        const width = box.w * 0.88;
        const height = box.h * 0.9;
        let size = parseFloat(card.style.getPropertyValue('--qfx-size'));
        let numPx = parseFloat(card.style.getPropertyValue('--qfx-num'));
        const smallest = Math.max(8, size * 0.55);
        const smallestNum = numPx * 0.3;
        const apply = () => {
            card.style.setProperty('--qfx-size', size + 'px');
            card.style.setProperty('--qfx-num', numPx + 'px');
        };

        // The number: never more than its share of the width. Side by side,
        // the words keep most of it.
        const numRoom = stacked ? width : width * 0.4;
        if (num.offsetWidth > numRoom) {
            numPx *= numRoom / num.offsetWidth;
            apply();
        }

        // How much wider a line's words are than the room it has. Measured
        // exactly: scrollWidth rounds to whole pixels, and a name a fraction
        // of a pixel too wide still gets an ellipsis.
        const spill = line => {
            const range = line.ownerDocument.createRange();
            range.selectNodeContents(line);
            // The room inside its padding, unrounded - clientWidth is whole
            // pixels - and at the scale it is drawn, since the card is still
            // scaling in while this runs.
            const style = getComputedStyle(line);
            const box = line.getBoundingClientRect().width;
            const scale = box / Math.max(1, line.offsetWidth);
            const room = box - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) * scale;
            return room > 0 ? range.getBoundingClientRect().width / room : 1;
        };

        for (let i = 0; i < 10; i++) {
            const wide = Math.max(...[...text.children].map(spill));
            const tall = stacked
                ? (num.offsetHeight + text.offsetHeight + size * 0.25) / height
                : Math.max(num.offsetHeight, text.offsetHeight) / height;
            if (wide <= 1.002 && tall <= 1) return;
            const k = clamp(0.99 / Math.max(wide, tall), 0.6, 0.97);
            if (wide > 1.002) {
                // The words as small as they go, beside the number: the
                // number gives them some of its room instead.
                if (size > smallest || stacked) size = Math.max(smallest, size * k);
                else if (numPx > smallestNum) numPx = Math.max(smallestNum, numPx * k);
                else if (tall <= 1) return;
            }
            if (tall > 1) {
                size = Math.max(8, size * k);
                numPx *= k;
            }
            apply();
        }
    }

    /** Counts up to the number, quickly, then settles on it. */
    function countUp(element, number, ms) {
        const start = performance.now();
        const step = now => {
            if (!element.isConnected) return;
            const t = clamp((now - start) / ms, 0, 1);
            element.textContent = String(Math.round(number * easeOut(t)));
            if (t < 1) requestAnimationFrame(step);
        };
        element.textContent = '0';
        requestAnimationFrame(step);
    }

    /**
     * A viewer's milestone: the widget steps aside and the milestone fills
     * its place for `seconds`, the number counting up, then the widget comes
     * back.
     *
     * Returns the number, for a burst to come out of, and a promise for when
     * it is over and the widget is back.
     */
    function milestone(parts, options = {}) {
        const layer = layerFor(options.host);
        const doc = layer.ownerDocument;
        const target = options.target || null;
        const box = boxOn(layer, target);
        const seconds = clamp(Number(options.seconds) || 4, 1.5, 15);
        const number = Number(parts && parts.number) || 0;
        const who = (parts && parts.name) || 'Someone';

        const card = doc.createElement('div');
        card.className = 'qfx-take';
        milestoneColors(card, options.colors);
        if (options.font) card.style.setProperty('--qfx-font', options.font);
        card.style.left = box.x + 'px';
        card.style.top = box.y + 'px';
        card.style.width = box.w + 'px';
        card.style.height = box.h + 'px';
        card.style.borderRadius = target ? getComputedStyle(target).borderRadius : '16px';
        card.style.setProperty('--qfx-hold', seconds + 's');

        // Side by side on a wide widget, stacked on a tall one.
        const stacked = box.w / box.h < 1.6;
        card.classList.toggle('qfx-stack', stacked);
        const fontSize = stacked ? clamp(box.w * 0.075, 11, 30) : clamp(Math.min(box.h * 0.16, box.w * 0.05), 10, 30);
        card.style.setProperty('--qfx-size', fontSize + 'px');
        card.style.setProperty('--qfx-num', (stacked ? clamp(box.w * 0.3, 28, 160) : clamp(box.h * 0.6, 22, 150)) + 'px');

        const num = doc.createElement('span');
        num.className = 'qfx-take-num';
        const text = doc.createElement('span');
        text.className = 'qfx-take-text';
        const kicker = doc.createElement('span');
        kicker.className = 'qfx-kicker';
        kicker.textContent = 'Milestone';
        // Text nodes, never markup: the name is whatever the viewer called
        // themselves on Twitch.
        const name = doc.createElement('span');
        name.className = 'qfx-name';
        name.textContent = who;
        const line = doc.createElement('span');
        line.className = 'qfx-line';
        line.textContent = `${ordinal(number)} song request`;
        // Too short a widget for three lines: the name and the count only.
        if (box.h < 70 && !stacked) text.append(name, line);
        else text.append(kicker, name, line);
        card.append(num, text);
        layer.appendChild(card);
        // Measured at the number it counts up to: the widest it gets.
        num.textContent = String(number);
        fitTake(card, num, text, box, stacked);
        countUp(num, number, 700);

        takeovers += 1;
        hush();

        // The widget steps aside, and comes back when the card goes.
        let away = null;
        if (target && target.animate) {
            stepped.add(target);
            away = target.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.96' }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
        }

        const timers = [];
        let over = false;
        const end = () => {
            if (over) return;
            over = true;
            // stop() may have cleared the count already.
            takeovers = Math.max(0, takeovers - 1);
            unhush();
        };
        const done = new Promise(resolve => {
            timers.push(setTimeout(() => {
                if (away) {
                    away.cancel();
                    stepped.delete(target);
                    target.animate([{ opacity: 0, scale: '1.03' }, { opacity: 1, scale: '1' }], { duration: 480, easing: 'cubic-bezier(.2,1,.3,1)' });
                }
            }, seconds * 1000 + 120));
            timers.push(setTimeout(() => {
                card.remove();
                tidy(layer);
                end();
                resolve(true);
            }, seconds * 1000 + 620));
        });

        const remove = () => {
            timers.forEach(clearTimeout);
            if (away) away.cancel();
            card.remove();
            tidy(layer);
            end();
        };

        return { origin: num, done, element: card, remove };
    }

    /* --------------------------------------------------------- ambience */

    // A theme's quiet, always-there drift. Few particles, slow, drawn every
    // other frame - it runs for the whole song, so it is kept cheap - and
    // never a flash or a burst, which belong to viewers' rewards.
    const AMBIENT = {
        embers: {
            blend: 'lighter',
            spawn: (env, fresh) => {
                const at = fresh ? anywhere(env) : alongBottom(env, 3);
                const ember = env.pal.named ? pick(env.pal.spread) : { h: 22 + rand(-8, 14), s: 1, l: 0.6 };
                return { x: at.x, y: at.y, vx: 0, vy: -rand(0.08, 0.2) * env.box.h, life: rand(4, 8), size: rand(1.2, 2.6) * env.u, seed: rand(0, TAU), color: ember };
            },
            update: (p, dt, env) => {
                p.vx = Math.sin(p.seed + p.age * 1.3) * env.u * 10;
            },
            draw: (ctx, p, a) => {
                const flicker = 0.7 + 0.3 * Math.sin(p.seed * 5 + p.age * 9);
                stamp(ctx, p.color, p.size * 3.5, a * 0.6 * flicker);
                ctx.globalAlpha = a * flicker;
                ctx.fillStyle = hsl({ ...p.color, l: 0.85 });
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.45, 0, TAU);
                ctx.fill();
            }
        },
        snow: {
            blend: 'source-over',
            spawn: (env, fresh) => {
                const at = fresh ? anywhere(env) : alongTop(env, 3);
                const flake = env.pal.named ? pick([env.pal.light, ...env.pal.spread]) : { h: env.pal.light.h, s: Math.min(env.pal.light.s, 0.3), l: 0.95 };
                return { x: at.x, y: at.y, vx: 0, vy: rand(0.06, 0.16) * env.box.h, life: rand(6, 11), size: rand(1, 2.6) * env.u, seed: rand(0, TAU), color: flake };
            },
            update: (p, dt, env) => {
                p.vx = Math.sin(p.seed + p.age * 0.9) * env.u * 8;
            },
            draw: (ctx, p, a) => {
                stamp(ctx, p.color, p.size * 2.2, a * 0.35);
                ctx.globalAlpha = a * 0.9;
                ctx.fillStyle = hsl(p.color);
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.55, 0, TAU);
                ctx.fill();
            }
        },
        petals: {
            blend: 'source-over',
            spawn: (env, fresh) => {
                const at = fresh ? anywhere(env) : { x: env.box.x - rand(0, 0.2) * env.box.w, y: env.box.y + rand(-0.3, 0.6) * env.box.h };
                const pink = env.pal.named ? pick(env.pal.spread) : { h: 340 + rand(-8, 12), s: 0.75, l: rand(0.82, 0.9) };
                return { x: at.x, y: at.y, vx: rand(0.06, 0.12) * env.R, vy: rand(0.03, 0.08) * env.box.h, life: rand(6, 10), size: rand(5, 8) * env.u, rot: rand(0, TAU), spin: rand(-1, 1), flip: rand(0, TAU), flipRate: rand(1.5, 3), seed: rand(0, TAU), color: pink };
            },
            update: (p, dt, env) => {
                p.rot += p.spin * dt;
                p.flip += p.flipRate * dt;
                p.vy = Math.sin(p.seed + p.age * 1.1) * env.u * 8 + env.box.h * 0.05;
            },
            draw: (ctx, p, a) => {
                ctx.rotate(p.rot);
                ctx.scale(Math.max(Math.abs(Math.cos(p.flip)), 0.2), 1);
                ctx.globalAlpha = a * 0.85;
                ctx.fillStyle = hsl(p.color);
                petalPath(ctx, p.size);
                ctx.fill();
            }
        },
        bokeh: {
            blend: 'lighter',
            textures: ['circle_05'],
            spawn: (env, fresh) => {
                const near = Math.random();
                const size = (0.12 + near * 0.35) * env.box.h;
                const at = fresh ? anywhere(env) : { x: env.box.x + rand(0.02, 0.98) * env.box.w, y: env.box.y + env.box.h + size * 0.3 };
                return { x: at.x, y: at.y, vx: 0, vy: -rand(0.04, 0.1) * env.box.h, life: rand(6, 11), size, near, top: env.box.y, seed: rand(0, TAU), color: pick(env.pal.spread) };
            },
            update: (p, dt, env) => {
                p.vx = Math.sin(p.seed + p.age * 0.5) * env.u * 6;
            },
            draw: (ctx, p, a) => {
                // Fades away as it reaches the top, instead of vanishing there.
                const edge = clamp((p.y - p.top + p.size * 0.1) / (p.size * 0.6), 0, 1);
                texture(ctx, 'circle_05', p.color, p.size, a * edge * (0.55 - p.near * 0.3));
            }
        },
        fireflies: {
            blend: 'lighter',
            textures: ['star_04', 'star_05'],
            spawn: env => {
                const at = anywhere(env);
                const color = env.pal.named ? pick(env.pal.spread) : { h: env.pal.base.h, s: 0.9, l: 0.7 };
                return { x: at.x, y: at.y, vx: 0, vy: 0, life: rand(5, 9), size: rand(0.14, 0.24) * env.box.h, seed: rand(0, TAU), wander: rand(0, TAU), color };
            },
            update: (p, dt, env) => {
                p.wander += rand(-2, 2) * dt;
                p.vx = Math.cos(p.wander) * env.u * 9;
                p.vy = Math.sin(p.wander) * env.u * 7;
            },
            draw: (ctx, p, a) => {
                const blink = Math.max(0, Math.sin(p.seed + p.age * 1.7));
                texture(ctx, 'star_05', p.color, p.size * 1.8, a * blink);
                p.hot = p.hot || lighter(p.color, 0.25);
                texture(ctx, 'star_04', p.hot, p.size, a * blink);
                texture(ctx, 'star_04', WHITE, p.size * 0.5, a * blink);
            }
        },
        motes: {
            blend: 'lighter',
            textures: ['star_05'],
            spawn: env => {
                const at = anywhere(env);
                return { x: at.x, y: at.y, vx: 0, vy: 0, life: rand(6, 10), size: rand(0.07, 0.13) * env.box.h, seed: rand(0, TAU), drift: rand(0, TAU), color: env.pal.light };
            },
            update: (p, dt, env) => {
                // Dust in a sunbeam: hardly moving, never in a straight line.
                p.drift += rand(-0.6, 0.6) * dt;
                p.vx = Math.cos(p.drift) * env.u * 4;
                p.vy = Math.sin(p.drift) * env.u * 3 - env.u;
            },
            draw: (ctx, p, a) => texture(ctx, 'star_05', p.color, p.size, a * (0.6 + 0.3 * Math.sin(p.seed + p.age * 1.3)))
        },
        fog: {
            blend: 'source-over',
            // A few big banks, not many small ones.
            share: 0.3,
            textures: ['smoke_07', 'smoke_08'],
            spawn: (env, fresh) => {
                const size = rand(1.2, 1.8) * env.box.h;
                const x = fresh ? env.box.x + rand(0, 1) * env.box.w : env.box.x - size * 0.4;
                return {
                    x, y: env.box.y + env.box.h * rand(0.3, 1), vx: rand(0.02, 0.05) * env.box.w, vy: 0,
                    life: rand(14, 22), size, rot: rand(0, TAU), spin: rand(-0.08, 0.08), right: env.box.x + env.box.w,
                    kind: Math.random() < 0.5 ? 'smoke_07' : 'smoke_08', color: Math.random() < 0.6 ? env.pal.light : env.pal.base
                };
            },
            update: (p, dt) => { p.rot += p.spin * dt; },
            draw: (ctx, p, a) => {
                // Thins out before it reaches the right-hand edge, where it is let go.
                const edge = clamp((p.right - p.x + p.size * 0.1) / (p.size * 0.5), 0, 1);
                ctx.rotate(p.rot);
                texture(ctx, p.kind, p.color, p.size, a * edge * 0.22);
            }
        },
        twinkle: {
            blend: 'lighter',
            textures: ['star_04', 'star_05'],
            spawn: env => {
                const at = anywhere(env);
                return { x: at.x, y: at.y, vx: 0, vy: 0, life: rand(3, 6), size: rand(0.12, 0.22) * env.box.h, seed: rand(0, TAU), color: pick([env.pal.light, ...env.pal.spread]) };
            },
            update: () => {},
            draw: (ctx, p, a) => {
                const k = Math.max(0, Math.sin(p.seed + p.age * 2.2));
                texture(ctx, 'star_05', p.color, p.size * 1.6, a * k * 0.6);
                texture(ctx, 'star_04', p.color, p.size, a * k);
                texture(ctx, 'star_04', WHITE, p.size * 0.5, a * k * 0.8);
            }
        }
    };

    /**
     * Starts a theme's ambience over the widget. Returns a handle:
     *   colors(next)  the song changed, and so did its colors
     *   stop()        gone, at once
     *
     * It fades out on its own while a reward plays, and back in afterwards.
     * Whoever starts it stops it when the music does.
     */
    function ambience(name, options = {}) {
        const spec = AMBIENT[name];
        if (!spec) return null;
        // Drawn as soon as they arrive; nothing waits on them.
        if (spec.textures) loadTextures(spec.textures);

        const layer = layerFor(options.host);
        const canvas = layer.ownerDocument.createElement('canvas');
        canvas.className = 'qfx-canvas qfx-ambience';
        // Under any reward, which is added after it.
        layer.prepend(canvas);

        const W = layer.clientWidth || 1, H = layer.clientHeight || 1;
        const outer = layer.getBoundingClientRect();
        const density = Math.max(outer.width / W || 1, Number(options.scale) || 1) * (window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(W * density));
        canvas.height = Math.max(1, Math.round(H * density));
        const ctx = canvas.getContext('2d');

        const tb = boxOn(layer, options.target);
        const box = { x: tb.x, y: tb.y, w: tb.w, h: tb.h, r: radiusOf(options.target, 14) };
        const amount = clamp(Number(options.amount) || 1, 0.25, 3);
        const speed = clamp(Number(options.speed) || 1, 0.25, 3);
        const env = {
            box, W, H,
            u: clamp(box.h / 110, 0.65, 1.7),
            R: Math.hypot(box.w, box.h) / 2,
            pal: palette(options.colors, options.palette || 'album')
        };
        const count = Math.max(1, Math.round(clamp(box.w * box.h / 9000, 6, 24) * amount * (spec.share || 1)));
        const particles = Array.from({ length: count }, () => {
            const p = spec.spawn(env, true);
            p.age = rand(0, p.life * 0.6);
            return p;
        });

        let visible = 0;
        let wanted = running.size || takeovers ? 0 : 1;
        let frame = null;
        let last = performance.now();
        let skip = false;
        let stopped = false;

        const start = () => {
            if (frame !== null || stopped) return;
            last = performance.now();
            frame = requestAnimationFrame(tick);
        };

        const handle = {
            hush: () => { wanted = 0; },
            unhush: () => { wanted = 1; start(); },
            colors: next => { env.pal = palette(next, options.palette || 'album'); },
            stop: () => {
                stopped = true;
                if (frame !== null) cancelAnimationFrame(frame);
                frame = null;
                ambiences.delete(handle);
                canvas.remove();
                tidy(layer);
            }
        };

        function tick(now) {
            frame = null;
            const dt = clamp((now - last) / 1000, 0, 1 / 10);
            // Every other frame is plenty for things this slow.
            skip = !skip;
            if (skip) {
                frame = requestAnimationFrame(tick);
                return;
            }
            last = now;

            // Fades in and out over about a third of a second.
            visible += (wanted - visible) * clamp(dt * 5, 0, 1);
            if (Math.abs(visible - wanted) < 0.02) visible = wanted;

            ctx.setTransform(density, 0, 0, density, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, W, H);

            if (visible > 0) {
                ctx.save();
                roundedBox(ctx, box, box.r);
                ctx.clip();
                ctx.globalCompositeOperation = spec.blend;
                const step = dt * speed;
                for (let i = 0; i < particles.length; i++) {
                    let p = particles[i];
                    p.age += step;
                    spec.update(p, step, env);
                    p.x += p.vx * step;
                    p.y += p.vy * step;
                    const gone = p.age >= p.life || p.y < box.y - 24 * env.u || p.y > box.y + box.h + 24 * env.u || p.x > box.x + box.w + 24 * env.u;
                    if (gone) {
                        p = particles[i] = spec.spawn(env, false);
                        p.age = 0;
                    }
                    const a = clamp(p.age / 0.8, 0, 1) * clamp((p.life - p.age) / 1.2, 0, 1) * visible;
                    if (a <= 0) continue;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    spec.draw(ctx, p, a);
                    ctx.restore();
                }
                ctx.restore();
            }

            // Faded right out and asked to stay out: stop drawing until told.
            if (visible === 0 && wanted === 0) return;
            frame = requestAnimationFrame(tick);
        }

        ambiences.add(handle);
        start();
        return handle;
    }

    /* ------------------------------------------------------------ stop */

    /** Clears every effect and milestone off every host, mid-flight. Ambience stays. */
    function stop() {
        for (const token of [...running]) token.stop();
        for (const element of document.querySelectorAll('.qfx-take')) {
            const layer = element.parentElement;
            element.remove();
            if (layer) tidy(layer);
        }
        for (const element of stepped) {
            for (const animation of element.getAnimations()) {
                if (!(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)) animation.cancel();
            }
        }
        stepped.clear();
        takeovers = 0;
        unhush();
    }

    const groupOf = name => (EFFECTS.find(effect => effect.name === name) || {}).group || null;

    window.QueueifyFx = { EFFECTS, GROUPS, PALETTES, AMBIENCES, play, milestone, ambience, stop, ordinal, groupOf };
})();
