/**
 * Where `!tr` and `!bc` put the widget, and how to put it back.
 *
 * A preset used to be stored as OBS handed it over, scale included - and a
 * scale only means anything against the browser source size it was measured
 * at. Queueify recomputes that size whenever the theme changes, so a preset
 * framed under one theme was later applied against a different number of
 * pixels: the widget came back the wrong size, and being anchored by its
 * top-left corner, in the wrong place.
 *
 * That was patched by multiplying every saved scale by the factor the source
 * had just changed by. Which compounded, and across two themes' worth of
 * factors it compounded unevenly - real saved presets ended up with scaleX and
 * scaleY 30% apart, visibly stretching the widget.
 *
 * So the scale is not what a preset is any more. A preset is the rectangle the
 * widget occupied on the OBS canvas, which is true no matter how many pixels
 * the browser source is currently rendering; the scale that reproduces it is
 * worked out at the moment it is recalled.
 */

// OBS packs alignment into bits: 1 left, 2 right, 4 top, 8 bottom, 0 centre.
// 5 is top-left, which is what a scene item has unless somebody changed it.
const TOP_LEFT = 5;

/**
 * Which edges each command is named for.
 *
 * Only used when a design's shape has changed since it was framed, and the
 * widget can no longer be exactly the size it was: `!bc` then keeps its bottom
 * edge and its centre line, `!tr` its top and right. Anchoring by the top-left
 * corner instead - which is what OBS does on its own - is what makes a widget
 * appear to wander off the bottom of the screen.
 */
const KINDS = {
    topright: { command: '!tr', holds: 'the top-right corner', x: 'end', y: 'start' },
    bottomcenter: { command: '!bc', holds: 'the bottom centre', x: 'center', y: 'end' }
};

function kindOf(name) {
    return KINDS[name] ? name : 'topright';
}

/** The name a theme's preset is saved under. */
function nameFor(kind, theme) {
    return theme ? `${kindOf(kind)}:${theme}` : kindOf(kind);
}

function positive(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The rectangle a saved preset put the widget in, on the OBS canvas.
 *
 * `width` and `height` are what OBS records for the item's size on the canvas,
 * and they are the numbers to trust. The scale beside them is relative to a
 * browser source size that has since moved on - and, in presets saved before
 * this, was actively corrupted.
 */
function footprintOf(preset) {
    if (!preset || typeof preset !== 'object') return null;

    const bounded = Boolean(preset.boundsType && preset.boundsType !== 'OBS_BOUNDS_NONE');

    const width = bounded
        ? positive(preset.boundsWidth)
        : positive(preset.width) || positive(preset.sourceWidth) * (positive(preset.scaleX) || 1);

    const height = bounded
        ? positive(preset.boundsHeight)
        : positive(preset.height) || positive(preset.sourceHeight) * (positive(preset.scaleY) || 1);

    if (!width || !height) return null;

    return {
        x: Number.isFinite(preset.positionX) ? preset.positionX : 0,
        y: Number.isFinite(preset.positionY) ? preset.positionY : 0,
        width,
        height,
        bounded,
        alignment: Number.isFinite(preset.alignment) ? preset.alignment : TOP_LEFT
    };
}

// A rectangle nobody has claimed an edge of keeps its top-left corner, which
// is what OBS does on its own.
const NO_ANCHOR = { x: 'start', y: 'start' };

/**
 * Where a rectangle's top-left corner goes when the widget cannot be exactly
 * the size it was framed at.
 *
 * `!bc` holds the bottom edge and the centre line, `!tr` the top and the
 * right. Without this the widget keeps its top-left corner and shrinks away
 * from the bottom of the screen, which is what "it moved" looks like.
 */
function anchorAt(framed, width, height, kind) {
    // Any alignment other than top-left means OBS is already holding a corner
    // or an edge still for us, and the saved position refers to that point -
    // so moving it would be undoing OBS's own anchoring.
    if (framed.alignment !== undefined && framed.alignment !== TOP_LEFT) {
        return { x: framed.x, y: framed.y };
    }

    const anchor = KINDS[kind] || NO_ANCHOR;

    return {
        x: anchor.x === 'end' ? framed.x + framed.width - width
            : anchor.x === 'center' ? framed.x + (framed.width - width) / 2
            : framed.x,
        y: anchor.y === 'end' ? framed.y + framed.height - height
            : anchor.y === 'center' ? framed.y + (framed.height - height) / 2
            : framed.y
    };
}

/**
 * The transform that puts the widget back in a preset's rectangle, given the
 * size the browser source is - or is about to become.
 *
 * One scale for both axes, always: a preset must never be the thing that
 * stretches a widget. When the design still has the shape it was framed at -
 * the ordinary case, because a preset belongs to one theme - the two agree
 * exactly and the widget comes back precisely as it was.
 */
function transformFor(preset, current, kind) {
    const framed = footprintOf(preset);
    if (!framed) return null;

    const sourceWidth = positive(current && current.sourceWidth);
    const sourceHeight = positive(current && current.sourceHeight);
    if (!sourceWidth || !sourceHeight) return null;

    // `min` rather than either axis on its own, so a design whose shape has
    // changed since it was framed shrinks to fit the space rather than
    // spilling out of it.
    const scale = Math.min(framed.width / sourceWidth, framed.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;

    const { x, y } = anchorAt(framed, width, height, kindOf(kind));

    return {
        positionX: x,
        positionY: y,
        scaleX: scale,
        scaleY: scale,
        width,
        height,
        bounded: Boolean(current.boundsType && current.boundsType !== 'OBS_BOUNDS_NONE')
    };
}

/**
 * Whether a preset can still frame a design exactly.
 *
 * A preset survives the browser source being resized - that is the whole point
 * of storing a rectangle rather than a scale. What it cannot survive is the
 * design changing *shape*: a theme made twice as tall no longer fits the space
 * it was framed in, so it is anchored instead, at a size the person who framed
 * it did not choose. That is worth mentioning; a resize is not.
 */
const SHAPE_TOLERANCE = 0.02;

function fitsShape(preset, design) {
    const framed = footprintOf(preset);
    if (!framed || !design || !positive(design.width) || !positive(design.height)) return true;

    const framedRatio = framed.width / framed.height;
    const designRatio = design.width / design.height;

    return Math.abs(framedRatio - designRatio) <= designRatio * SHAPE_TOLERANCE;
}

module.exports = {
    KINDS,
    TOP_LEFT,
    kindOf,
    nameFor,
    footprintOf,
    anchorAt,
    transformFor,
    fitsShape
};
