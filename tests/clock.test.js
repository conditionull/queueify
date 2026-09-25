const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

/**
 * The song times, as the widget and the editor preview draw them.
 *
 * Elapsed takes the song length's shape - 07:19 against 17:05 - so the two
 * clocks are the same width and a theme can line elapsed up with the text
 * above it while keeping both gaps to the bar even.
 *
 * Both files are browser scripts with nothing to require, so the function is
 * lifted out of each and run on its own. The editor carries a copy so a box
 * sized there fits on stream; the last test keeps the two from drifting.
 */

const lift = (file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const match = source.match(/function clock\(ms, longestMs = ms\) \{[\s\S]*?\n\}/);
    assert.ok(match, `${file} has no clock(ms, longestMs)`);
    return new Function(`${match[0]}; return clock;`)();
};

const widget = lift('widget/public/app.js');
const editor = lift('setup/public/editor.html');

const s = (seconds) => seconds * 1000;
const hms = (h, m, sec) => s(h * 3600 + m * 60 + sec);

test('a song under ten minutes looks the way it always did', () => {
    assert.strictEqual(widget(s(214), s(252)), '3:34');
    assert.strictEqual(widget(s(4), s(252)), '0:04');
    assert.strictEqual(widget(s(252)), '4:12');
});

test('elapsed takes the length\'s digits once a song runs past ten minutes', () => {
    assert.strictEqual(widget(hms(0, 7, 19), hms(0, 17, 5)), '07:19');
    assert.strictEqual(widget(s(5), hms(0, 10, 0)), '00:05');
    assert.strictEqual(widget(hms(0, 12, 0), hms(0, 17, 5)), '12:00');
    assert.strictEqual(widget(hms(0, 17, 5)), '17:05');
});

test('past the hour, elapsed shows hours too', () => {
    assert.strictEqual(widget(hms(0, 7, 19), hms(1, 2, 5)), '0:07:19');
    assert.strictEqual(widget(hms(1, 0, 0), hms(1, 2, 5)), '1:00:00');
    assert.strictEqual(widget(hms(1, 2, 5)), '1:02:05');
});

test('elapsed and length are always the same number of characters', () => {
    for (const length of [s(59), s(252), hms(0, 10, 0), hms(0, 17, 5), hms(1, 2, 5), hms(10, 0, 0)]) {
        const width = widget(length).length;

        for (let at = 0; at <= length; at += Math.max(s(1), Math.floor(length / 97))) {
            assert.strictEqual(widget(at, length).length, width, `${widget(at, length)} against ${widget(length)}`);
        }
    }
});

test('the editor preview draws exactly what the widget draws', () => {
    for (const [at, length] of [[s(214), s(252)], [hms(0, 7, 19), hms(0, 17, 5)], [hms(0, 7, 19), hms(1, 2, 5)], [s(0), s(0)]]) {
        assert.strictEqual(editor(at, length), widget(at, length));
        assert.strictEqual(editor(length), widget(length));
    }
});
