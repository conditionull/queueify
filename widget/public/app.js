let THEME = "default";
let RENDER_SCALE = 1;

// Bumped by the widget server every time the theme is written, even when the
// name has not changed. Saving edits to the theme already on screen is the
// common case, and without this the widget kept the stylesheet it had - which
// is why a design only "woke up" once the source was nudged in OBS.
let REVISION = null;

// The theme's own stylesheet, and nothing else. A theme can pull in web fonts
// with their own <link>, and grabbing "the first stylesheet" used to overwrite
// one of those - the font then vanished, because its @font-face rules went
// with it.
const themeLink = document.getElementById("theme")
    || document.querySelector('link[rel="stylesheet"][href*="/themes/"]');

function applyTheme(theme) {
    THEME = theme || "default";

    if (themeLink) {
        themeLink.href = `/themes/${THEME}/style.css`;
    }
}

/**
 * Lays the widget out larger instead of letting OBS stretch it.
 *
 * OBS rasterizes a browser source at its configured pixel size, so a source
 * enlarged in the scene is an upscaled bitmap - soft edges, mushy text. `zoom`
 * re-runs layout at the bigger size, so every pixel is drawn rather than
 * interpolated; the scene item is scaled back down to keep the same footprint.
 * The browser source must be sized to match (680 x 192 times the scale).
 */
function applyRenderScale(scale) {
    const next = Number(scale) || 1;
    RENDER_SCALE = next;

    // OBS zeroes the body margin through its own injected CSS; a normal
    // browser does not, and at 2x that gap is doubled too.
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.documentElement.style.zoom = next === 1 ? "" : String(next);
}

async function refreshThemeFromServer() {
    try {
        const res = await fetch("/api/widget/config");
        if (!res.ok) return;

        const config = await res.json();
        if (config.effectiveTheme || config.theme) {
            applyTheme(config.effectiveTheme || config.theme);
        }

        REVISION = config.revision ?? null;
        applyRenderScale(config.renderScale);
    } catch (err) {
        console.error("Failed to refresh theme config:", err);
    }
}

const themeEvents = new EventSource("/api/widget/theme-events");

themeEvents.onmessage = (event) => {
    try {
        const { theme, renderScale, revision } = JSON.parse(event.data);

        const changedTheme = Boolean(theme) && theme !== THEME;

        // The theme's files were rewritten. Same name, new design - which the
        // check above cannot see, because the name did not move.
        const rewritten = revision != null && REVISION != null && revision !== REVISION;

        REVISION = revision ?? REVISION;

        // A zoom change used to reload too, on the grounds that the layout is
        // rebuilt at the new size. It is - but `zoom` rebuilds it on its own,
        // so the reload only bought a second of blank browser source every
        // time a theme of a different size came up. Re-measuring the scrolling
        // text is the one thing that does have to be redone by hand.
        if (Number(renderScale) && Number(renderScale) !== RENDER_SCALE) {
            applyRenderScale(renderScale);
            if (!changedTheme && !rewritten) {
                requestAnimationFrame(() => updateSong());
                return;
            }
        }

        if (changedTheme || rewritten) {
            if (theme) applyTheme(theme);
            setTimeout(() => {
                window.location.reload();
            }, 250);
        }
    } catch (err) {
        console.error("Theme change update failed:", err);
    }
};

let themeProperties;
let hideTimeout;
let isPlaying = false;
let currentSong = null;

// Whether the first answer about what is playing has come back yet.
let ready = false;

/**
 * Nothing is drawn until there is something to draw.
 *
 * A reload - a theme change, or OBS resizing the browser source - leaves the
 * page up before the song is known: an empty panel, no artwork, no text, laid
 * out at whatever size the stylesheet has loaded so far. On a scene switch
 * that is a second or two of visibly wrong widget. Starting hidden turns that
 * into the widget simply arriving, which is what the fade was always for.
 */
document.querySelector(".widget").classList.add("hidden");

function showWidget() {
    const widget = document.querySelector(".widget");

    // The page is served hidden so it cannot paint an empty panel before this
    // script has run. Lifting that here means the theme's own fade is what
    // brings the widget in, exactly as it does at every other moment.
    const boot = document.getElementById("queueify-boot");
    if (boot) boot.remove();

    clearTimeout(hideTimeout);
    widget.classList.remove("hidden");
}


function scheduleHide() {
    const hideAfter = themeProperties.hideAfter;

    // -1 = never hide
    if (hideAfter === -1) {
        return;
    }

    clearTimeout(hideTimeout);

    hideTimeout = setTimeout(() => {

        document
            .querySelector(".widget")
            .classList.add("hidden");

    }, hideAfter * 1000);

}

async function loadThemeProperties() {
    const res = await fetch(`/themes/${THEME}/properties.json`);
    const props = await res.json();

    for (const [key, value] of Object.entries(props)) {
        if (typeof value !== "object") {
            const cssName = key.replace(
                /[A-Z]/g,
                letter => `-${letter.toLowerCase()}`
            );

            document.documentElement.style.setProperty(
                `--${cssName}`,
                value
            );
        }
    }

    if (props.scroll?.speed) {
        // Keep the high-level duration available to CSS animations.
        // More precise distances are computed per-song in `updateSong()`.
        const pauseDuration = props.scroll.pauseDuration || 0;
        // Default behavior: treat `speed` as a nominal time value used
        // as a baseline for total animation duration when distance is unknown.
        const baseline = props.scroll.speed;
        const totalDuration = baseline + pauseDuration + baseline;

        document.documentElement.style.setProperty(
            "--scroll-duration",
            `${totalDuration}s`
        );
    }

    return props;
}



async function updateSong() {
    let song;

    try {
        const res = await fetch("/api/widget/song");
        song = await res.json();
    } catch (err) {
        // Queueify restarting, or Spotify not answering. The interval tries
        // again shortly; until then the widget keeps whatever it had rather
        // than throwing on every tick.
        console.error("Could not read what is playing:", err);
        return;
    }

    console.log("SONG:", song);

    currentSong = song;

    if (song.palette) {

        const root = document.documentElement;

        root.style.setProperty(
            "--album-vibrant",
            song.palette.vibrant || "#1DB954"
        );

        root.style.setProperty(
            "--album-dark",
            song.palette.darkMuted || "#141419"
        );

        root.style.setProperty(
            "--album-light",
            song.palette.lightVibrant || "#ffffff"
        );

        root.style.setProperty(
            "--album-muted",
            song.palette.muted || "rgba(255,255,255,.7)"
        );

    }

    if (!song.isPlaying) {
        if (isPlaying) {
            isPlaying = false;
            scheduleHide();
        }

        // A theme that never hides still wants to be on screen with nothing
        // playing - but only once, and only after the first answer, so the
        // page cannot flash an empty panel while it waits for one.
        if (!ready && themeProperties.hideAfter === -1) showWidget();

        ready = true;
        return;
    }

    if (!isPlaying || !ready) {
        isPlaying = true;
        showWidget();
    }

    ready = true;


    if (!themeProperties.showProgress) {
        document.querySelector(".progress-container").style.display = "none";
    }

    const title = document.querySelector(".title");
    const titleContainer = document.querySelector(".title-container");

    title.textContent = song.title;

    document.querySelector(".artist").textContent =
        song.artist;

    const cover = document.querySelector(".cover");
    const canvas = document.querySelector(".canvas");

    const useCanvas =
        themeProperties.media?.mode === "canvas" &&
        song.media?.type === "video";


    if (useCanvas) {
        if (canvas) {
            canvas.src = song.media.url;
            canvas.style.display = "block";
        }

        if (cover) {
            cover.style.display = "none";
        }
    } else {
        if (cover) {
            cover.src = song.cover;
            cover.style.display = "block";
        }

        if (canvas) {
            canvas.style.display = "none";
        }
    }

    requestAnimationFrame(() => {

        const wrapper = title.closest(".title-wrapper");
        const container = title.closest(".title-container");

        const titleWidth = contentBox(container).width;

        const titleShouldScroll = title.scrollWidth > titleWidth;
        const scrollDistance = Math.max(
            title.scrollWidth - titleWidth,
            0
        );

        document.documentElement.style.setProperty(
            "--scroll-distance",
            `${scrollDistance}px`
        );

        const artistEl = document.querySelector('.artist');
        const artistWrapper = artistEl?.closest('.artist-wrapper');
        let artistDistance = 0;
        let artistShouldScroll = false;

        if (artistEl && artistWrapper) {
            const wrapperRect = contentBox(artistWrapper);
            const progressRect = document.querySelector('.progress-container')?.getBoundingClientRect();

            let visibleWidth = wrapperRect.width;

            // Some themes sit the progress bar on the same line as the artist,
            // where it eats into the space the text has. Only then does it
            // count: a bar on its own row below (as themes made in the editor
            // have) shares no space at all, and treating it as an overlap left
            // the artist with zero width - so it scrolled a line that fitted
            // perfectly well.
            const sharesTheLine = progressRect &&
                progressRect.top < wrapperRect.bottom - 1 &&
                progressRect.bottom > wrapperRect.top + 1;

            if (sharesTheLine && progressRect.left < wrapperRect.right) {
                visibleWidth = Math.max(0, progressRect.left - wrapperRect.left);
            }

            artistDistance = Math.max(artistEl.scrollWidth - visibleWidth, 0);
            artistShouldScroll = artistDistance > 0;
        }

        document.documentElement.style.setProperty(
            "--artist-distance",
            `${artistDistance}px`
        );

        const pxPerSecond = (themeProperties?.scroll?.speed) || 120;
        const titleMoveSeconds = titleShouldScroll ? Math.max(scrollDistance / pxPerSecond, 0.5) : 0;
        const artistMoveSeconds = artistShouldScroll ? Math.max(artistDistance / pxPerSecond, 0.5) : 0;
        const pauseSeconds = (themeProperties?.scroll?.pauseDuration) || 1;
        const titleDuration = titleShouldScroll ? pauseSeconds + titleMoveSeconds + pauseSeconds + titleMoveSeconds : 0;
        const artistDuration = artistShouldScroll ? pauseSeconds + artistMoveSeconds + pauseSeconds + artistMoveSeconds : 0;
        const totalDuration = Math.max(titleDuration, artistDuration, 8);

        document.documentElement.style.setProperty(
            "--scroll-duration",
            `${totalDuration}s`
        );

        // Straight away, unlike `scrolling` below: it puts a centered or
        // right-aligned title back at its start on browsers without `safe`
        // alignment, and a quarter of a second late shows the middle of the
        // title on the first frames of every song.
        container.classList.toggle("overflowing", titleShouldScroll);

        if (titleShouldScroll) {
            title.classList.add("scroll");
            setTimeout(() => {
                wrapper.classList.add("scrolling");
            }, 250);
        } else {
            title.classList.remove("scroll");
            wrapper.classList.remove("scrolling");
        }

        if (artistShouldScroll) {
            artistEl.classList.add('scroll');
            artistWrapper.classList.add('scrolling');
        } else if (artistEl) {
            artistEl.classList.remove('scroll');
            artistWrapper?.classList.remove('scrolling');
        }

        const existing = document.getElementById('scroll-keyframes');
        if (existing) existing.remove();

        if (titleShouldScroll || artistShouldScroll) {
            const tPause1End = pauseSeconds;
            const tMove1End = tPause1End + Math.max(titleMoveSeconds, artistMoveSeconds);
            const tPause2End = tMove1End + pauseSeconds;

            const pctPause1End = (tPause1End / totalDuration) * 100;
            const pctMove1End = (tMove1End / totalDuration) * 100;
            const pctPause2End = (tPause2End / totalDuration) * 100;

            const keyframes = `
                @keyframes scroll-title {
                    0% { transform: translateX(0); }
                    ${pctPause1End}% { transform: translateX(0); }
                    ${pctMove1End}% { transform: translateX(calc(-1 * var(--scroll-distance))); }
                    ${pctPause2End}% { transform: translateX(calc(-1 * var(--scroll-distance))); }
                    100% { transform: translateX(0); }
                }

                @keyframes scroll-artist {
                    0% { transform: translateX(0); }
                    ${pctPause1End}% { transform: translateX(0); }
                    ${pctMove1End}% { transform: translateX(calc(-1 * var(--artist-distance))); }
                    ${pctPause2End}% { transform: translateX(calc(-1 * var(--artist-distance))); }
                    100% { transform: translateX(0); }
                }
            `;

            const style = document.createElement('style');
            style.id = 'scroll-keyframes';
            style.textContent = keyframes;
            document.head.appendChild(style);
        } else {
            document.documentElement.style.setProperty("--scroll-distance", `0px`);
            document.documentElement.style.setProperty("--artist-distance", `0px`);
        }
    });
}



async function init() {
    await refreshThemeFromServer();
    themeProperties = await loadThemeProperties();

    updateSong();

    const updateInterval = themeProperties.updateInterval || 5000;

    setInterval(updateSong, updateInterval);
    setInterval(updateProgress, 100);
}

/**
 * m:ss, or h:mm:ss once a track runs past the hour. Spotify shows the same
 * shape, so the widget reads the way the app people are looking at does.
 *
 * `longestMs` is the song's length, and the elapsed time takes its shape:
 * 07:19 against 17:05, 0:07:19 against 1:02:05. The digits are tabular, so
 * the two clocks are then the same width, and a theme can line elapsed up
 * with the text above it *and* keep both gaps to the bar even. Unpadded,
 * 7:19 is a digit narrower, so one of those has to give. Under ten minutes
 * nothing changes: both are already m:ss.
 */
function clock(ms, longestMs = ms) {
    const fields = value => {
        const total = Math.max(0, Math.round(value / 1000));
        return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    };

    const [hours, minutes, seconds] = fields(ms);
    const [longestHours, longestMinutes] = fields(longestMs);

    const pad = (value, width = 2) => String(value).padStart(width, "0");

    return longestHours
        ? `${pad(hours, String(longestHours).length)}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes, String(longestMinutes).length)}:${pad(seconds)}`;
}

/**
 * The rectangle a box actually offers its contents.
 *
 * A generated theme pads a text box by the width of its outline and pulls it
 * back by the same amount, so the clip falls outside the stroke instead of
 * through it (services/themeStore.js). That padding is not room for text, so
 * anything working out whether a line fits has to measure the content box
 * rather than the padding box `clientWidth` and `getBoundingClientRect()`
 * report. A theme with no padding is unaffected: the two are the same box.
 */
function contentBox(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const pad = side => parseFloat(style["padding" + side]) || 0;

    const left = rect.left + el.clientLeft + pad("Left");
    const top = rect.top + el.clientTop + pad("Top");
    const width = Math.max(0, el.clientWidth - pad("Left") - pad("Right"));
    const height = Math.max(0, el.clientHeight - pad("Top") - pad("Bottom"));

    return { left, top, right: left + width, bottom: top + height, width, height };
}

/** Themes generated before the clocks existed have no element to write to. */
function setText(selector, text) {
    const el = document.querySelector(selector);
    if (el && el.textContent !== text) el.textContent = text;
}

function updateProgress() {

    // The clocks are their own parts of a theme, shown or hidden in the
    // editor, so they are not tied to whether the bar is drawn.
    if (!currentSong || !currentSong.durationMs) {
        setText(".elapsed", "");
        setText(".duration", "");
        return;
    }

    let progressMs = currentSong.progressMs;

    if (currentSong.isPlaying) {
        progressMs += Date.now() - currentSong.fetchedAt;
    }

    // Spotify is polled every few seconds and the clock runs on in between, so
    // without this the elapsed time sails past the end of a finished track.
    progressMs = Math.min(Math.max(progressMs, 0), currentSong.durationMs);

    setText(".elapsed", clock(progressMs, currentSong.durationMs));
    setText(".duration", clock(currentSong.durationMs));

    if (!themeProperties.showProgress) {
        return;
    }

    const percent =
        (progressMs / currentSong.durationMs) * 100;


    document.querySelector(".progress").style.width =
        `${Math.min(percent, 100)}%`;
}


init();
