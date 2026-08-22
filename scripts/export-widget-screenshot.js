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

async function exportWidgetScreenshot(url, outputPath) {
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: WIDGET_WIDTH, height: WIDGET_HEIGHT }
    });

    await page.goto(url);
    await page.waitForTimeout(1500);

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
