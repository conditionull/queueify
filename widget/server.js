const express = require("express");
const path = require("path");
const nocache = require("nocache");
const app = express();
const { getCurrentTrack } = require("../spotify");


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