const express = require("express");
const path = require("path");
const nocache = require("nocache");
const app = express();
const { getCurrentTrack } = require("../spotify");
const fs = require("fs");

let widgetConfig = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "config.json"),
        "utf8"
    )
);

const themeClients = [];


app.get("/api/widget/config", (req, res) => {
    res.json(widgetConfig);
});

app.get("/api/widget/themes", (req, res) => {
    const themesPath = path.join(__dirname, "themes");

    const themes = fs.readdirSync(themesPath)
        .filter(name => {
            return fs.statSync(
                path.join(themesPath, name)
            ).isDirectory();
        });

    res.json(themes);
});

app.get("/api/widget/theme-events", (req, res) => {
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


app.post("/api/widget/theme", express.json(), (req, res) => {
    const { theme } = req.body;
    widgetConfig.theme = theme;

    fs.writeFileSync(
        path.join(__dirname, "config.json"),
        JSON.stringify(widgetConfig, null, 4)
    );

    notifyThemeChange(theme);

    res.json({
        success: true,
        theme
    });
});

app.use(nocache());

app.use(express.static(path.join(__dirname, "public")));

app.use("/assets",
    express.static(path.join(__dirname, "..", "assets"))
);

app.use(
    "/themes",
    express.static(path.join(__dirname, "themes"))
);

app.get("/api/widget/song", async (req, res) => {
    try {
        const track = await getCurrentTrack();

        if (!track || !track.isPlaying) {
            return res.json({
                title: null,
                artist: null,
                cover: null,

                durationMs: 0,
                progressMs: 0,

                isPlaying: false,
                fetchedAt: Date.now()
            });
        }

        res.json({
            title: track.name,
            artist: track.artists,
            cover: track.cover,

            media: track.media,

            durationMs: track.durationMs,
            progressMs: track.progressMs,

            isPlaying: track.isPlaying,
            fetchedAt: track.fetchedAt,

            palette: track.palette
        });

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