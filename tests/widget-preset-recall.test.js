const assert = require('assert');
const test = require('node:test');

const presets = require('../services/widgetPresets');

/**
 * Putting the widget back where `!tr` / `!bc` framed it.
 *
 * The reported bug: theme "x" framed with `!bc`, switch to a scene using
 * another theme, switch back, and "x" was noticeably out of place - `!bc` had
 * to be typed again. Two causes, both here.
 *
 * The saved scale was measured against the browser source size of the day, and
 * Queueify resizes that source every time the theme changes. And every resize
 * used to multiply every saved scale by the factor it had just changed by,
 * which compounded across themes - unevenly, so saved positions ended up
 * stretching the widget as well as misplacing it.
 */

/** Framed filling a 680 x 192 source at 1:1, bottom-centred on a 1920 canvas. */
const framed = {
    positionX: 620, positionY: 888,
    width: 680, height: 192,
    sourceWidth: 680, sourceHeight: 192,
    scaleX: 1, scaleY: 1,
    alignment: 5,
    boundsType: 'OBS_BOUNDS_NONE'
};

const source = (width, height) => ({
    sourceWidth: width,
    sourceHeight: height,
    boundsType: 'OBS_BOUNDS_NONE'
});

test('the same rectangle comes back however many pixels the source now has', () => {
    // The source was resized for another theme and back; a different number.
    const placed = presets.transformFor(framed, source(1360, 384), 'bottomcenter');

    assert.strictEqual(placed.positionX, 620);
    assert.strictEqual(placed.positionY, 888);
    assert.strictEqual(placed.width, 680);
    assert.strictEqual(placed.height, 192);
    assert.strictEqual(placed.scaleX, 0.5);
    assert.strictEqual(placed.scaleY, 0.5);
});

test('the saved scale is ignored, because it is the part that goes wrong', () => {
    // What compounding rescales left behind in real saved settings: scaleX and
    // scaleY far apart, and neither matching the source any more.
    const corrupted = { ...framed, scaleX: 2.4856, scaleY: 2.5038 };
    const placed = presets.transformFor(corrupted, source(680, 192), 'bottomcenter');

    assert.strictEqual(placed.scaleX, 1);
    assert.strictEqual(placed.scaleY, 1);
    assert.strictEqual(placed.width, 680);
});

test('a widget is never stretched by being put back', () => {
    for (const [width, height] of [[1360, 384], [400, 113], [900, 254], [680, 192]]) {
        const placed = presets.transformFor(framed, source(width, height), 'bottomcenter');
        assert.strictEqual(placed.scaleX, placed.scaleY, `${width} x ${height} came back stretched`);
    }
});

test('a shape that no longer fits is anchored by the edges the command names', () => {
    // The design is now tall, so it cannot be the size it was framed at.
    const bottom = presets.transformFor(framed, source(300, 406), 'bottomcenter');

    // Bottom edge and centre line held, which is what "bottom centre" means.
    assert.ok(Math.abs((bottom.positionY + bottom.height) - (888 + 192)) < 0.001);
    assert.ok(Math.abs((bottom.positionX + bottom.width / 2) - (620 + 340)) < 0.001);

    const top = presets.transformFor(framed, source(300, 406), 'topright');

    // Top edge and right edge held.
    assert.strictEqual(top.positionY, 888);
    assert.ok(Math.abs((top.positionX + top.width) - (620 + 680)) < 0.001);
});

test('a shape that no longer fits stays inside the space it was framed in', () => {
    const placed = presets.transformFor(framed, source(300, 406), 'bottomcenter');

    assert.ok(placed.width <= 680.001);
    assert.ok(placed.height <= 192.001);
});

test('an item OBS is already anchoring is left where OBS put it', () => {
    // Anything but top-left means OBS holds that point still on its own, and
    // the saved position refers to it - moving it would undo that.
    const centred = { ...framed, alignment: 0 };
    const placed = presets.transformFor(centred, source(300, 406), 'bottomcenter');

    assert.strictEqual(placed.positionX, 620);
    assert.strictEqual(placed.positionY, 888);
});

test('a bounded item is put back by its box, not by a scale', () => {
    const placed = presets.transformFor(framed, {
        sourceWidth: 300, sourceHeight: 406,
        boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1, boundsHeight: 1
    }, 'bottomcenter');

    assert.strictEqual(placed.bounded, true);
    assert.ok(placed.width > 0 && placed.height > 0);
});

test('a position saved before the size was recorded is read from its scale', () => {
    const old = {
        positionX: 100, positionY: 200,
        sourceWidth: 680, sourceHeight: 192,
        scaleX: 2, scaleY: 2,
        alignment: 5
    };

    const footprint = presets.footprintOf(old);
    assert.strictEqual(footprint.width, 1360);
    assert.strictEqual(footprint.height, 384);
});

test('a position with nothing usable in it is refused rather than guessed at', () => {
    assert.strictEqual(presets.footprintOf(null), null);
    assert.strictEqual(presets.footprintOf({}), null);
    assert.strictEqual(presets.transformFor({}, source(680, 192), 'topright'), null);
    assert.strictEqual(presets.transformFor(framed, source(0, 0), 'topright'), null);
});

test('each command is named for the edges it holds', () => {
    assert.strictEqual(presets.KINDS.topright.command, '!tr');
    assert.strictEqual(presets.KINDS.bottomcenter.command, '!bc');
    // An unknown kind must not silently become a different corner.
    assert.strictEqual(presets.kindOf('nonsense'), 'topright');
    assert.strictEqual(presets.nameFor('bottomcenter', 'swag'), 'bottomcenter:swag');
});

/**
 * The exact round trip from the report: theme x framed, away to another
 * theme's size, back again. It has to land where it started.
 */
test('a scene switch away and back lands the widget exactly where it was', () => {
    const away = presets.transformFor(framed, source(1360, 384), 'bottomcenter');
    const back = presets.transformFor(framed, source(680, 192), 'bottomcenter');

    for (const placed of [away, back]) {
        assert.strictEqual(placed.positionX, 620);
        assert.strictEqual(placed.positionY, 888);
        assert.strictEqual(placed.width, 680);
        assert.strictEqual(placed.height, 192);
    }
});

/**
 * A browser source is a whole number of pixels, so it can only ever be
 * *nearly* the design's shape. The rectangle is always recomputed from what
 * was saved rather than from the last result, so that rounding cannot build up
 * over a stream's worth of scene changes.
 */
test('rounding in the source size never accumulates into a visible drift', () => {
    let placed = null;

    for (const [width, height] of [[1137, 321], [680, 192], [341, 96], [1137, 321], [853, 241]]) {
        placed = presets.transformFor(framed, source(width, height), 'bottomcenter');

        assert.ok(Math.abs(placed.positionX - 620) < 0.5, 'x drifted to ' + placed.positionX);
        assert.ok(Math.abs((placed.positionY + placed.height) - 1080) < 0.5,
            'the bottom edge drifted to ' + (placed.positionY + placed.height));
    }
});
