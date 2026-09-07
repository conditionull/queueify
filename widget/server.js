const express = require("express");
const path = require("path");
const nocache = require("nocache");
const fs = require("fs");
const fsPromises = require("fs/promises");
const app = express();
const { getCurrentTrack } = require("../spotify");

let widgetConfig = {};
let widgetConfigLoaded = false;
const MAX_THEME_CLIENTS = 50;
const themeClients = [];
// Same override the theme store uses, so both halves read one folder - and a
// test can point them somewhere throwaway.
const THEMES_DIR = process.env.QUEUEIFY_THEMES_DIR || path.join(__dirname, "themes");
const CONFIG_FILE = process.env.QUEUEIFY_WIDGET_CONFIG_FILE || path.join(__dirname, "config.json");

// The widget is laid out at 680x192 CSS pixels. OBS rasterises a browser
// source at exactly its configured size and then stretches that texture, so a
// source enlarged in the scene goes soft. Rendering at 2x or 3x and shrinking
// the scene item back down keeps the same on-screen size with real pixels
// behind it - the page is laid out bigger, not scaled up.
const BASE_WIDTH = 680;
const BASE_HEIGHT = 192;
const MAX_RENDER_SCALE = 4;

function getActiveTheme() {
    return widgetConfig.theme || 'default';
}

/**
 * Changes to a theme that keeps its name.
 *
 * Widgets reload when the theme name or the render scale changes, and neither
 * of those moves when somebody saves edits to the theme already on screen.
 * This does, so that save reaches OBS instead of waiting for the source to be
 * nudged into reloading itself.
 */
let revision = 0;

function bumpRevision() {
    revision += 1;
    return revision;
}

// Matching the widget to its size on the OBS canvas gives fractional zooms
// (a 680px design shown at 850px is 1.25x), so this is not rounded.
const MIN_RENDER_SCALE = 0.25;

function getRenderScale() {
    const scale = Number(widgetConfig.renderScale);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.min(Math.max(scale, MIN_RENDER_SCALE), MAX_RENDER_SCALE);
}

async function saveWidgetConfig() {
    await fsPromises.writeFile(CONFIG_FILE, JSON.stringify(widgetConfig, null, 4));
}

function isKnownTheme(theme) {
    if (typeof theme !== "string" || !/^[a-zA-Z0-9_-]+$/.test(theme)) return false;
    return fs.existsSync(path.join(THEMES_DIR, theme, "index.html"));
}

async function loadWidgetConfig() {
    if (widgetConfigLoaded) return;

    try {
        const contents = await fsPromises.readFile(CONFIG_FILE, "utf8");
        widgetConfig = JSON.parse(contents);
    } catch (err) {
        console.error("Failed to load widget config:", err.message);
        widgetConfig = {};
    }

    widgetConfigLoaded = true;
}

app.get("/api/widget/config", async (req, res) => {
    await loadWidgetConfig();
    res.json({
        ...widgetConfig,
        effectiveTheme: getActiveTheme(),
        revision,
        // How many widget pages are listening. Whoever is resizing the OBS
        // source uses this to decide whether it also has to reload it by hand.
        clients: themeClients.length,
        renderScale: getRenderScale(),
        width: Math.round(BASE_WIDTH * getRenderScale()),
        height: Math.round(BASE_HEIGHT * getRenderScale())
    });
});

app.get("/api/widget/themes", async (req, res) => {
    try {
        const entries = await fsPromises.readdir(THEMES_DIR, { withFileTypes: true });
        const themes = entries
            .filter(entry => entry.isDirectory() && isKnownTheme(entry.name))
            .map(entry => entry.name);

        res.json(themes);
    } catch (err) {
        console.error("Failed to list widget themes:", err.message);
        res.status(500).json({ error: "Unable to list themes" });
    }
});

app.get("/api/widget/theme-events", (req, res) => {
    if (themeClients.length >= MAX_THEME_CLIENTS) {
        res.status(503).send("Too many event stream connections");
        return;
    }

    res.setHeader(
        "Content-Type",
        "text/event-stream"
    );

    res.setHeader(
        "Cache-Control",
        "no-cache"
    );

    res.setHeader(
        "Connection",
        "keep-alive"
    );

    themeClients.push(res);

    req.on("close", () => {
        const index = themeClients.indexOf(res);

        if (index !== -1) {
            themeClients.splice(index, 1);
        }
    });
});

function notifyWidgetChange() {
    const payload = JSON.stringify({
        theme: getActiveTheme(),
        revision,
        renderScale: getRenderScale()
    });

    for (const client of themeClients) {
        client.write(`data: ${payload}\n\n`);
    }
}

app.post("/api/widget/theme", express.json(), async (req, res) => {
    const { theme } = req.body;

    if (!isKnownTheme(theme)) {
        return res.status(400).json({ error: "Unknown theme" });
    }

    widgetConfig.theme = theme;

    try {
        await saveWidgetConfig();
    } catch (err) {
        console.error("Failed to save widget config:", err.message);
        return res.status(500).json({ error: "Unable to save theme" });
    }

    // Posted on every save of the live theme, not only when the name changes,
    // so re-saving a design reloads the widgets showing it.
    bumpRevision();
    notifyWidgetChange();

    res.json({
        success: true,
        theme,
        revision
    });
});

app.post("/api/widget/render-scale", express.json(), async (req, res) => {
    await loadWidgetConfig();

    const scale = Number(req.body?.scale);

    if (!Number.isFinite(scale) || scale < MIN_RENDER_SCALE || scale > MAX_RENDER_SCALE) {
        return res.status(400).json({ error: `Render scale must be between ${MIN_RENDER_SCALE} and ${MAX_RENDER_SCALE}` });
    }

    const previous = getRenderScale();
    widgetConfig.renderScale = scale;

    try {
        await saveWidgetConfig();
    } catch (err) {
        widgetConfig.renderScale = previous;
        console.error("Failed to save widget config:", err.message);
        return res.status(500).json({ error: "Unable to save render scale" });
    }

    // Open widgets reload themselves, so the new size takes effect without the
    // user touching the browser source.
    bumpRevision();
    notifyWidgetChange();

    res.json({
        success: true,
        renderScale: scale,
        previousRenderScale: previous,
        width: Math.round(BASE_WIDTH * scale),
        height: Math.round(BASE_HEIGHT * scale)
    });
});

app.use(nocache());

/**
 * The zoom, written into the page rather than fetched by it.
 *
 * app.js asks for the config and applies the zoom when the answer comes back,
 * which leaves one or two frames where the design is drawn at 1x inside a
 * browser source sized for 2x - the widget in the top-left corner with empty
 * bars down two sides. Short, but a theme switch reloads the page, so it is
 * exactly what you see every time you change scene. Putting it in the markup
 * means the very first paint is already the right size.
 */
function withRenderScale(html, scale) {
    // Two rules, because they have different lifetimes. The zoom stays; the
    // hiding is lifted by app.js the moment there is a song to show, so the
    // page cannot paint an empty panel before its own script has run. It needs
    // !important because it is written above the theme's own stylesheet.
    const style = '<style id="queueify-zoom">html{zoom:' + scale + '}' +
        'body{margin:0;overflow:hidden}</style>' +
        '<style id="queueify-boot">.widget{opacity:0!important}</style>';

    // Every theme, generated or hand-written, opens with <head>.
    return html.includes('<head>')
        ? html.replace('<head>', '<head>' + style)
        : style + html;
}

app.get("/", async (req, res) => {
    // The config has to be read before the theme is chosen. Without this the
    // very first request - which is the one OBS makes - fell back to "default"
    // and served that theme's markup with another theme's stylesheet.
    await loadWidgetConfig();

    const theme = getActiveTheme();
    const htmlPath = path.join(THEMES_DIR, theme, "index.html");

    if (!fs.existsSync(htmlPath)) {
        return res.status(404).send("Theme HTML not found");
    }

    try {
        const html = await fsPromises.readFile(htmlPath, "utf8");
        res.type("html").send(withRenderScale(html, getRenderScale()));
    } catch (err) {
        console.error("Failed to read theme HTML:", err.message);
        res.status(500).send("Theme HTML could not be read");
    }
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/assets",
    express.static(path.join(__dirname, "..", "assets"))
);

app.use(
    "/themes",
    express.static(THEMES_DIR)
);

const widgetSongCache = {
    expiresAt: 0,
    value: null,
    pending: null
};

app.get("/api/widget/song", async (req, res) => {
    try {
        const now = Date.now();
        if (widgetSongCache.expiresAt > now && widgetSongCache.value) {
            return res.json(widgetSongCache.value);
        }

        if (widgetSongCache.pending) {
            const cached = await widgetSongCache.pending;
            return res.json(cached);
        }

        widgetSongCache.pending = (async () => {
            try {
                const track = await getCurrentTrack();

                let payload;
                if (!track || !track.isPlaying) {
                    payload = {
                        title: null,
                        artist: null,
                        cover: null,
                        durationMs: 0,
                        progressMs: 0,
                        isPlaying: false,
                        fetchedAt: Date.now()
                    };
                } else {
                    payload = {
                        title: track.name,
                        artist: track.artists,
                        cover: track.cover,
                        media: track.media,
                        durationMs: track.durationMs,
                        progressMs: track.progressMs,
                        isPlaying: track.isPlaying,
                        fetchedAt: track.fetchedAt,
                        palette: track.palette
                    };
                }

                widgetSongCache.value = payload;
                widgetSongCache.expiresAt = Date.now() + 2000;
                return payload;
            } finally {
                widgetSongCache.pending = null;
            }
        })();

        const data = await widgetSongCache.pending;
        res.json(data);
    } catch (err) {
        console.error("Widget API failed:", err);

        res.status(500).json({
            error: err.message
        });
    }
});


function startWidgetServer() {
    // Overridable so a test never binds the port a running Queueify is using -
    // on Windows a second bind succeeds and the two fight over requests. Note
    // that 0 is a real answer (pick a free port), so `||` will not do here.
    const configured = Number(process.env.QUEUEIFY_WIDGET_PORT);
    const port = Number.isInteger(configured) && configured >= 0 ? configured : 3001;

    // Resolves with the server so a caller (a test, mostly) can ask which port
    // it landed on and shut it down again.
    return new Promise((resolve, reject) => {
        const server = app.listen(port);

        server.once('listening', () => {
            // address() is null if the socket never came up, so it is only read
            // once listening has actually happened.
            const address = server.address();
            console.log(`Widget running on http://localhost:${address ? address.port : port}`);
            resolve(server);
        });

        server.once('error', err => {
            if (err.code === 'EADDRINUSE') {
                const busy = new Error(
                    `Port ${port} is already in use, so the widget could not start. ` +
                    'Queueify is probably already running in another window.'
                );
                busy.code = 'EADDRINUSE';
                busy.port = port;
                reject(busy);
                return;
            }

            reject(err);
        });
    });
}

module.exports = startWidgetServer;