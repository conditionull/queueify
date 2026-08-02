let THEME = "default";

const themeLink = document.getElementById("theme")
    || document.querySelector('link[rel="stylesheet"]');

function applyTheme(theme) {
    THEME = theme || "default";

    if (themeLink) {
        themeLink.href = `/themes/${THEME}/style.css`;
    }
}

async function refreshThemeFromServer() {
    try {
        const res = await fetch("/api/widget/config");
        if (!res.ok) return;

        const config = await res.json();
        if (config.theme) {
            applyTheme(config.theme);
        }
    } catch (err) {
        console.error("Failed to refresh theme config:", err);
    }
}

const themeEvents = new EventSource("/api/widget/theme-events");

themeEvents.onmessage = (event) => {
    try {
        const { theme } = JSON.parse(event.data);

        if (theme && theme !== THEME) {
            applyTheme(theme);
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

function showWidget() {
    const widget = document.querySelector(".widget");

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
        // Default behaviour: treat `speed` as a nominal time value used
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
    const res = await fetch("/api/widget/song");
    const song = await res.json();
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

    const widget = document.querySelector(".widget");

    if (!song.isPlaying) {
        if (isPlaying) {
            isPlaying = false;
            scheduleHide();
        }
        return;
    }


    if (!isPlaying) {
        isPlaying = true;
        showWidget();
    }


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

        const titleShouldScroll = title.scrollWidth > container.clientWidth;
        const scrollDistance = Math.max(
            title.scrollWidth - container.clientWidth,
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
            const wrapperRect = artistWrapper.getBoundingClientRect();
            const progressRect = document.querySelector('.progress-container')?.getBoundingClientRect();

            let visibleWidth = artistWrapper.clientWidth;

            if (progressRect && progressRect.left < wrapperRect.right) {
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

function updateProgress() {

    if (!themeProperties.showProgress) {
        return;
    }

    if (!currentSong || !currentSong.durationMs) {
        return;
    }


    let progressMs = currentSong.progressMs;

    if (currentSong.isPlaying) {
        progressMs += Date.now() - currentSong.fetchedAt;
    }

    const percent =
        (progressMs / currentSong.durationMs) * 100;


    document.querySelector(".progress").style.width =
        `${Math.min(percent, 100)}%`;
}


init();
