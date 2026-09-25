/*
   One-off dev tool: captures a transparent screenshot of the OBS widget to display in the README etc.
   Requires: npm install --save-dev playwright && npx playwright install chromium
   Usage: npm run screenshot -- http://localhost:3001 widget-screenshot.png
        - to use default URL and output path, just run: npm run screenshot

   Make sure the bot (`npm start`) is running first to capture the widget
*/

const { chromium } = require('playwright');

const WIDGET_WIDTH = 680;
const WIDGET_HEIGHT = 192;

// Long enough for a Canvas video to come off Spotify's CDN on a slow line.
// Past it the shot is taken anyway, with a warning, rather than hanging.
const MEDIA_TIMEOUT_MS = 15000;

/**
 * Resolves once whichever of the cover or the Canvas video is on show has
 * something to draw.
 *
 * A fixed wait is not enough: the widget hides the cover the moment a song has
 * a Canvas video, and the video's first frame can take seconds to arrive. Shot
 * in between, the art is simply missing - just the canvas behind where it
 * should be.
 *
 * Runs in the page.
 */
function mediaReady(timeoutMs) {
    const shown = el => el && getComputedStyle(el).display !== 'none' && el.getAttribute('src');
    const video = document.querySelector('.canvas');
    const cover = document.querySelector('.cover');

    let ready;
    let what;

    if (shown(video)) {
        what = 'Canvas video';
        // HAVE_CURRENT_DATA: there is a frame to paint, not just metadata.
        ready = video.readyState >= 2
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                video.addEventListener('loadeddata', resolve, { once: true });
                video.addEventListener('error', () => reject(new Error('the Canvas video failed to load')), { once: true });
            });
    } else if (shown(cover)) {
        what = 'album cover';
        ready = cover.decode();
    } else {
        return Promise.resolve('no album art on show');
    }

    const timeout = new Promise(resolve =>
        setTimeout(() => resolve(`gave up waiting for the ${what} after ${timeoutMs / 1000}s`), timeoutMs));

    return Promise.race([ready.then(() => null), timeout])
        .catch(err => err.message);
}

async function exportWidgetScreenshot(url, outputPath) {
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: WIDGET_WIDTH, height: WIDGET_HEIGHT }
    });

    await page.goto(url);

    // The song arrives from a fetch after load; until then there is no
    // title, and the art has no source to wait on.
    await page.waitForFunction(() => {
        const title = document.querySelector('.title');
        return title && title.textContent.trim() !== '';
    }, null, { timeout: 10000 }).catch(() => {
        console.warn('Nothing is playing, so the widget is captured empty.');
    });

    const problem = await page.evaluate(mediaReady, MEDIA_TIMEOUT_MS);
    if (problem) console.warn(`Album art: ${problem}.`);

    await page.evaluate(() => document.fonts.ready);

    // The widget fades in, and a video's first frame still has to be painted.
    await page.waitForTimeout(1000);

    // screenshot just the widget element
    await page.locator('.widget').screenshot({
        path: outputPath,
        omitBackground: true
    });

    await browser.close();
    console.log(`Saved transparent screenshot to ${outputPath}`);
}

const [, , url = 'http://localhost:3001', outputPath = 'widget-screenshot.png'] = process.argv;

exportWidgetScreenshot(url, outputPath).catch(err => {
    console.error('Failed to export widget screenshot:', err.message);
    process.exit(1);
});
