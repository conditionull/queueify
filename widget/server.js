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
let themeTakeover = null;
let themeTakeoverTimer;

function getActiveTheme() {
    return themeTakeover?.theme || widgetConfig.theme || 'default';
}

async function loadWidgetConfig() {
    if (widgetConfigLoaded) return;

    try {
        const contents = await fsPromises.readFile(
            path.join(__dirname, "config.json"),
            "utf8"
        );
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
        themeTakeoverExpiresAt: themeTakeover?.expiresAt || null
    });
});

app.get("/api/widget/themes", async (req, res) => {
    const themesPath = path.join(__dirname, "themes");

    try {
        const entries = await fsPromises.readdir(themesPath, { withFileTypes: true });
        const themes = entries
            .filter(entry => entry.isDirectory())
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

function notifyThemeChange(theme) {
    for (const client of themeClients) {
        client.write(
            `data: ${JSON.stringify({ theme })}\n\n`
        );
    }
}

function clearThemeTakeover() {
    clearTimeout(themeTakeoverTimer);
    themeTakeover = null;
    notifyThemeChange(getActiveTheme());
}

app.post("/api/widget/theme", express.json(), async (req, res) => {
    const { theme } = req.body;
    widgetConfig.theme = theme;

    try {
        await fsPromises.writeFile(
            path.join(__dirname, "config.json"),
            JSON.stringify(widgetConfig, null, 4)
        );
    } catch (err) {
        console.error("Failed to save widget config:", err.message);
        return res.status(500).json({ error: "Unable to save theme" });
    }

    notifyThemeChange(theme);

    res.json({
        success: true,
        theme
    });
});

app.post('/api/widget/theme-takeover', express.json(), async (req, res) => {
    const { theme, durationSeconds } = req.body;
    const duration = Number(durationSeconds);

    if (typeof theme !== 'string' || !Number.isInteger(duration) || duration < 60 || duration > 86400) {
        return res.status(400).json({ error: 'Invalid theme takeover request' });
    }

    const themesPath = path.join(__dirname, 'themes');
    const htmlPath = path.join(themesPath, theme, 'index.html');

    if (!fs.existsSync(htmlPath)) {
        return res.status(400).json({ error: 'Unknown widget theme' });
    }

    clearTimeout(themeTakeoverTimer);
    themeTakeover = {
        theme,
        expiresAt: Date.now() + duration * 1000
    };
    themeTakeoverTimer = setTimeout(clearThemeTakeover, duration * 1000);
    themeTakeoverTimer.unref?.();
    notifyThemeChange(theme);

    res.json({
        theme,
        expiresAt: themeTakeover.expiresAt
    });
});

app.use(nocache());

app.get("/", (req, res) => {
    const theme = getActiveTheme();

    const htmlPath = path.join(
        __dirname,
        "themes",
        theme,
        "index.html"
    );

    if (!fs.existsSync(htmlPath)) {
        return res.status(404).send("Theme HTML not found");
    }

    res.sendFile(htmlPath);
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/assets",
    express.static(path.join(__dirname, "..", "assets"))
);

app.use(
    "/themes",
    express.static(path.join(__dirname, "themes"))
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
    app.listen(3001, () => {
        console.log("Widget running on http://localhost:3001");
    });
}

module.exports = startWidgetServer;