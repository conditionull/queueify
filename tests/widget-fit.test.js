const assert = require('assert');
const test = require('node:test');

const obs = require('../services/obs');

/**
 * Sizing a widget for OBS, in the design's own proportions.
 *
 * The bugs these cover all looked different and were all the same thing: the
 * two axes were sized independently against a footprint left behind by
 * whatever theme was there before. A tall theme dropped into a wide slot got a
 * wide, short browser source, and OBS squashed the design to fit it.
 */

const ratio = size => size.width / size.height;

test('a design keeps its shape when it lands in a footprint of another shape', () => {
    // A 300 x 406 theme where a 680 x 192 one used to be.
    const fit = obs.renderSizeFor({
        displayedWidth: 680,
        displayedHeight: 192,
        designWidth: 300,
        designHeight: 406
    });

    assert.ok(fit.refitted, 'the footprint was the wrong shape and should say so');
    assert.strictEqual(fit.width, 300);
    assert.strictEqual(fit.height, 406);

    // Inside the space it had, never spilling past it.
    assert.ok(fit.displayedWidth <= 680 + 0.5);
    assert.ok(fit.displayedHeight <= 192 + 0.5);
    assert.ok(Math.abs(ratio(fit) - 300 / 406) < 0.001);
});

test('the scene item scale that goes with it is the same on both axes', () => {
    const fit = obs.renderSizeFor({
        displayedWidth: 680,
        displayedHeight: 192,
        designWidth: 300,
        designHeight: 406
    });

    const scaleX = fit.displayedWidth / fit.width;
    const scaleY = fit.displayedHeight / fit.height;

    assert.ok(Math.abs(scaleX - scaleY) < 0.001, 'an uneven scale is the squash itself');
});

test('a footprint of the right shape is left exactly as it is', () => {
    const fit = obs.renderSizeFor({
        displayedWidth: 850,
        displayedHeight: 240,
        designWidth: 680,
        designHeight: 192
    });

    assert.strictEqual(fit.refitted, false);
    assert.strictEqual(fit.displayedWidth, 850);
    assert.strictEqual(fit.displayedHeight, 240);
    // Shown bigger than designed, so the page renders bigger rather than
    // being stretched by OBS.
    assert.strictEqual(fit.width, 850);
    assert.strictEqual(fit.height, 240);
});

test('a widget shown small still renders the whole design, never a cropped one', () => {
    const fit = obs.renderSizeFor({
        displayedWidth: 100,
        displayedHeight: 135,
        designWidth: 300,
        designHeight: 406
    });

    // The page is zoomed by width/designWidth, so the design always fills the
    // source exactly - which is what stops anything being cut off.
    assert.ok(Math.abs(fit.width / 300 - fit.height / 406) < 0.005);
    assert.ok(fit.width >= 40 && fit.height >= 40, 'OBS will not take a smaller source');
});

test('a design taller than OBS allows is scaled down whole, not clipped on one axis', () => {
    const fit = obs.renderSizeFor({
        displayedWidth: 8000,
        displayedHeight: 3000,
        designWidth: 1920,
        designHeight: 1080
    });

    assert.ok(fit.width <= 4096 && fit.height <= 4096);
    assert.ok(Math.abs(ratio(fit) - 1920 / 1080) < 0.001);
});
