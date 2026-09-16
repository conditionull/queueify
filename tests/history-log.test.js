const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-history-'));
const historyFile = path.join(sandbox, 'queue-history.jsonl');

// Before the require: history.js resolves its path at load, so an assignment
// after this line would append to the user's own log.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = historyFile;

const historyPath = require.resolve('../services/history');
delete require.cache[historyPath];
const history = require('../services/history');

test.after(() => {
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_HISTORY_FILE;
    delete require.cache[historyPath];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function lines() {
    if (!fs.existsSync(historyFile)) return [];
    return fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean);
}

function reset() {
    fs.writeFileSync(historyFile, '');
}

// A raw Spotify track, trimmed to the shape the real API returns - including
// the bulk this module is supposed to throw away.
const rawTrack = {
    id: '0BCPKOYdS2jbQ8iyB56Zns',
    name: 'Clocks',
    artists: [
        { id: '4gzpq5DPGxSnKTe4SA8HAU', name: 'Coldplay' },
        { id: '1uNFoZAHBGtllmzznpCI3s', name: 'Justin Bieber' }
    ],
    album: {
        id: '0LtOwyZoScZjFqSwFWfqKA',
        name: 'A Rush of Blood to the Head',
        release_date: '2002-08-26',
        images: [{ url: 'https://i.scdn.co/image/rotates-eventually' }]
    },
    duration_ms: 307879,
    explicit: false,
    popularity: 76,
    external_ids: { isrc: 'GBAAA0200788' },
    available_markets: new Array(180).fill('GB'),
    external_urls: { spotify: 'https://open.spotify.com/track/0BCPKOYdS2jbQ8iyB56Zns' }
};

test('appends one newline-terminated line per event', async () => {
    reset();

    await history.recordRequest({ outcome: 'ok', source: 'chat', username: 'Nyx', track: rawTrack });
    await history.recordRequest({ outcome: 'cooldown', source: 'chat', username: 'Nyx' });

    const written = fs.readFileSync(historyFile, 'utf8');
    assert.ok(written.endsWith('\n'), 'file should end with a newline');
    assert.strictEqual(lines().length, 2);
});

test('keeps the fields worth keeping and drops the bulk', async () => {
    reset();
    await history.recordRequest({ outcome: 'ok', source: 'chat', username: 'Nyx', track: rawTrack });

    const event = JSON.parse(lines()[0]);

    assert.strictEqual(event.v, 1);
    assert.strictEqual(event.type, 'request');
    assert.strictEqual(event.outcome, 'ok');
    assert.strictEqual(event.source, 'chat');
    assert.ok(Date.parse(event.t), 't should be a parseable timestamp');

    // The decision the whole feature rests on: artists stay a list of objects,
    // so a collaboration can count for both of them.
    assert.deepStrictEqual(event.track.artists, [
        { id: '4gzpq5DPGxSnKTe4SA8HAU', name: 'Coldplay' },
        { id: '1uNFoZAHBGtllmzznpCI3s', name: 'Justin Bieber' }
    ]);

    assert.strictEqual(event.track.isrc, 'GBAAA0200788');
    assert.strictEqual(event.track.releaseDate, '2002-08-26');
    assert.strictEqual(event.track.durationMs, 307879);
    assert.strictEqual(event.track.popularity, 76);
    assert.strictEqual(event.track.albumId, '0LtOwyZoScZjFqSwFWfqKA');

    // The bulk, and the cover URL that would stop being true.
    assert.strictEqual(event.track.available_markets, undefined);
    assert.strictEqual(event.track.external_urls, undefined);
    assert.strictEqual(event.track.cover, undefined);
    assert.strictEqual(event.track.album, undefined);
});

test('records the three identity facts and lowercases the login', async () => {
    reset();
    await history.recordRequest({
        outcome: 'ok',
        source: 'chat',
        username: 'NyxTheCat',
        requester: { userId: '12345678', userLogin: 'NyxTheCat', userName: 'NyxTheCat', sub: true, mod: false },
        track: rawTrack
    });

    const { user } = JSON.parse(lines()[0]);

    assert.strictEqual(user.id, '12345678');
    assert.strictEqual(user.login, 'nyxthecat');
    assert.strictEqual(user.display, 'NyxTheCat');
    assert.strictEqual(user.sub, true);
});

test('falls back to the username when no requester is passed', async () => {
    reset();
    await history.recordRequest({ outcome: 'cooldown', source: 'redeem', username: 'GlorySynex' });

    const { user } = JSON.parse(lines()[0]);

    assert.strictEqual(user.id, null);
    assert.strictEqual(user.login, 'glorysynex', 'a redeem sends the display name, so it has to be lowered');
    assert.strictEqual(user.display, 'GlorySynex');
});

test('stores what was pasted when the track is unknown', async () => {
    reset();
    await history.recordRequest({
        outcome: 'invalidUrl',
        source: 'chat',
        username: 'Nyx',
        input: '  not a spotify link  '
    });

    const event = JSON.parse(lines()[0]);
    assert.strictEqual(event.input, 'not a spotify link');
    assert.strictEqual(event.track, undefined);
});

test('truncates a very long input', async () => {
    reset();
    await history.recordRequest({
        outcome: 'notFound', source: 'chat', username: 'Nyx', input: 'x'.repeat(500)
    });

    assert.strictEqual(JSON.parse(lines()[0]).input.length, 200);
});

test('concurrent appends never interleave', async () => {
    reset();

    await Promise.all(
        Array.from({ length: 25 }, (unused, index) =>
            history.recordRequest({ outcome: 'ok', source: 'chat', username: `viewer${index}`, track: rawTrack })
        )
    );

    const parsed = lines();
    assert.strictEqual(parsed.length, 25);

    // Every line has to be whole JSON on its own - a torn write shows up here
    // as a parse failure, not as a missing line.
    for (const line of parsed) {
        assert.doesNotThrow(() => JSON.parse(line));
    }
});

test('readEvents skips a torn last line instead of throwing', () => {
    reset();
    fs.appendFileSync(historyFile, '{"v":1,"type":"request","outcome":"ok"}\n');
    fs.appendFileSync(historyFile, 'not json at all\n');
    fs.appendFileSync(historyFile, '{"v":1,"type":"request","outcome":"cool');

    const events = history.readEvents();

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].outcome, 'ok');
});

test('a missing file reads as no events', () => {
    fs.rmSync(historyFile, { force: true });
    assert.deepStrictEqual(history.readEvents(), []);
});

test('records a play with the time it was queued, not the wait', async () => {
    reset();
    await history.recordPlay({
        track: { id: 'abc', name: 'Clocks', artists: 'Coldplay', durationMs: 307879 },
        queuedBy: 'NyxTheCat',
        queuedAt: '2026-09-16T20:00:00.000Z'
    });

    const event = JSON.parse(lines()[0]);

    assert.strictEqual(event.type, 'play');
    assert.strictEqual(event.queuedBy, 'nyxthecat');
    assert.strictEqual(event.queuedAt, '2026-09-16T20:00:00.000Z');
    assert.strictEqual(event.waitMs, undefined, 'the wait is derived, not stored');
});

test('a write failure is swallowed rather than thrown at the caller', async () => {
    reset();

    // A directory where the file should be: appendFile cannot win.
    const brokenPath = path.join(sandbox, 'broken');
    fs.rmSync(brokenPath, { recursive: true, force: true });
    fs.mkdirSync(brokenPath);

    process.env.QUEUEIFY_HISTORY_FILE = brokenPath;
    delete require.cache[historyPath];
    const broken = require('../services/history');

    await assert.doesNotReject(() =>
        broken.recordRequest({ outcome: 'ok', source: 'chat', username: 'Nyx', track: rawTrack })
    );

    process.env.QUEUEIFY_HISTORY_FILE = historyFile;
    delete require.cache[historyPath];
});
