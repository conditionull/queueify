const THEME = "default";

document.getElementById("theme").href =
    `/themes/${THEME}/style.css`;


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
        const scrollSpeed = props.scroll.speed;
        const pauseDuration = props.scroll.pauseDuration || 0;
        const totalDuration = scrollSpeed + pauseDuration + scrollSpeed;

        document.documentElement.style.setProperty(
            "--scroll-duration",
            `${totalDuration}s`
        );

        // Calculate keyframe percentages
        const scrollOutEnd = (scrollSpeed / totalDuration) * 100;
        const pauseEnd = ((scrollSpeed + pauseDuration) / totalDuration) * 100;

        // Generate dynamic keyframes
        const keyframes = `
            @keyframes scroll-title {
                0% {
                    transform: translateX(0);
                }
                15% {
                    transform: translateX(0);
                }
                ${scrollOutEnd}% {
                    transform: translateX(calc(-100% + 200px));
                }
                ${pauseEnd}% {
                    transform: translateX(calc(-100% + 200px));
                }
                100% {
                    transform: translateX(0);
                }
            }

            @keyframes shadow-fade {
                0% {
                    opacity: 0;
                }
                15% {
                    opacity: 0;
                }
                ${Math.max(scrollOutEnd - 5, 15)}% {
                    opacity: 1;
                }
                ${pauseEnd}% {
                    opacity: 1;
                }
                ${Math.min(pauseEnd + 5, 100)}% {
                    opacity: 0;
                }
                100% {
                    opacity: 0;
                }
            }
        `;

        const style = document.createElement("style");
        style.textContent = keyframes;
        document.head.appendChild(style);
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
        canvas.src = song.media.url;
        canvas.style.display = "block";
        cover.style.display = "none";
    } else {
        cover.src = song.cover;
        cover.style.display = "block";
        canvas.style.display = "none";
    }

    requestAnimationFrame(() => {

        const wrapper = title.closest(".title-wrapper");
        const container = title.closest(".title-container");


        if (title.scrollWidth > container.clientWidth) {

            title.classList.add("scroll");

            // wait until the title has sat still before fading edges
            setTimeout(() => {
                wrapper.classList.add("scrolling");
            }, 500);


        } else {

            title.classList.remove("scroll");

            wrapper.classList.remove("scrolling");

        }
    });
}



async function init() {
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
