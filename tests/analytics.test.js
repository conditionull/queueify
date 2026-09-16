const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-analytics-'));

// analytics reaches history for the file path, and history reads it at load.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'queue-history.jsonl');

const historyPath = require.resolve('../services/history');
const analyticsPath = require.resolve('../services/analytics');
for (const module of [historyPath, analyticsPath]) delete require.cache[module];

const analytics = require('../services/analytics');

test.after(() => {
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_HISTORY_FILE;
    for (const module of [historyPath, analyticsPath]) delete require.cache[module];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const base = Date.parse('2026-09-01T20:00:00.000Z');

function at(offsetMs) {
    return new Date(base + offsetMs).toISOString();
}

function track(overrides = {}) {
    return {
        id: 'T1',
        isrc: 'ISRC1',
        name: 'Around the World',
        artists: [{ id: 'ART1', name: 'Daft Punk' }],
        albumId: 'ALB1',
        albumName: 'Homework',
        releaseDate: '1997-01-20',
        durationMs: 240000,
        explicit: false,
        popularity: 70,
        ...overrides
    };
}

function request(offsetMs, user, overrides = {}) {
    return {
        v: 1,
        t: at(offsetMs),
        type: 'request',
        outcome: 'ok',
        source: 'chat',
        user,
        track: track(),
        ...overrides
    };
}

const nyxNamed = { id: null, login: 'nyx', display: 'Nyx' };
const nyxWithId = { id: '111', login: 'nyx', display: 'NyxTheCat' };
const kip = { id: '222', login: 'kip', display: 'Kip' };

test('an empty log gives zeroes and never a NaN', () => {
    const summary = analytics.summarise([]);

    assert.strictEqual(summary.empty, true);
    assert.strictEqual(summary.totals.requests, 0);
    assert.strictEqual(summary.acceptanceRate, 0);
    assert.strictEqual(summary.explicitRatio, 0);
    assert.strictEqual(summary.obscurity, null);

    // Ratios over an empty log are where a NaN would sneak onto the page.
    const serialised = JSON.stringify(summary);
    assert.ok(!serialised.includes('null,"acceptanceRate":null'), 'ratios should be numbers');
    assert.ok(!/NaN/.test(serialised), `NaN leaked into the summary: ${serialised}`);
});

test('a line written before ids existed folds into the same person', () => {
    const summary = analytics.summarise([
        request(0, nyxNamed),
        request(HOUR, nyxWithId)
    ]);

    assert.strictEqual(summary.totals.viewers, 1, 'the same login is one person');
    assert.strictEqual(summary.topRequesters[0].accepted, 2);
    assert.strictEqual(summary.topRequesters[0].name, 'NyxTheCat', 'the newest name wins');
    assert.deepStrictEqual(summary.topRequesters[0].aliases, ['Nyx'], 'the older one is kept as an alias');
});

test('the same recording under two Spotify ids counts once', () => {
    const summary = analytics.summarise([
        request(0, kip, { track: track({ id: 'T1', isrc: 'ISRC1' }) }),
        // A remaster: different id, same recording.
        request(HOUR, kip, { track: track({ id: 'T2-remaster', isrc: 'ISRC1' }) })
    ]);

    assert.strictEqual(summary.topTracks.length, 1);
    assert.strictEqual(summary.topTracks[0].count, 2);
});

test('a collaboration counts for every artist on it', () => {
    const summary = analytics.summarise([
        request(0, kip, {
            track: track({
                artists: [{ id: 'ART1', name: 'Daft Punk' }, { id: 'ART2', name: 'Pharrell Williams' }]
            })
        })
    ]);

    const names = summary.topArtists.map(artist => artist.name).sort();
    assert.deepStrictEqual(names, ['Daft Punk', 'Pharrell Williams']);
    assert.ok(summary.topArtists.every(artist => artist.count === 1));
});

test('streams are split on a long gap, not on the calendar', () => {
    const summary = analytics.summarise([
        request(0, kip),
        request(HOUR, kip),
        // Four hours later, past the three-hour gap.
        request(5 * HOUR, kip),
        request(5 * HOUR + 60000, kip)
    ]);

    assert.strictEqual(summary.totals.sessions, 2);
    assert.strictEqual(summary.sessions.length, 2);
    // Newest first.
    assert.ok(Date.parse(summary.sessions[0].startedAt) > Date.parse(summary.sessions[1].startedAt));
});

test('events are sorted before being split, so a late write cannot make a stream', () => {
    // Written out of order, as parallel requests finishing can do.
    const summary = analytics.summarise([
        request(HOUR, kip),
        request(0, kip)
    ]);

    assert.strictEqual(summary.totals.sessions, 1);
});

test('rejections are counted by reason and are not counted as accepted', () => {
    const summary = analytics.summarise([
        request(0, kip),
        request(HOUR, kip, { outcome: 'cooldown', track: undefined }),
        request(2 * HOUR, kip, { outcome: 'cooldown', track: undefined }),
        request(3 * HOUR - 1, kip, { outcome: 'tooLong' })
    ]);

    assert.strictEqual(summary.totals.requests, 4);
    assert.strictEqual(summary.totals.accepted, 1);
    assert.strictEqual(summary.acceptanceRate, 0.25);

    const cooldown = summary.rejections.find(row => row.outcome === 'cooldown');
    assert.strictEqual(cooldown.count, 2);
});

test('a signature track prefers the one nobody else asks for', () => {
    const shared = track({ id: 'POP', isrc: 'POPISRC', name: 'Popular Song' });
    const mine = track({ id: 'MINE', isrc: 'MINEISRC', name: 'Only Mine' });

    const summary = analytics.summarise([
        // Nyx queues the popular one twice, and the obscure one twice.
        request(0, nyxWithId, { track: shared }),
        request(60000, nyxWithId, { track: shared }),
        request(120000, nyxWithId, { track: mine }),
        request(180000, nyxWithId, { track: mine }),
        // Everybody else piles onto the popular one.
        request(240000, kip, { track: shared }),
        request(300000, { id: '333', login: 'ash', display: 'Ash' }, { track: shared })
    ]);

    const nyx = summary.signatures.find(row => row.viewer === 'NyxTheCat');
    assert.strictEqual(nyx.name, 'Only Mine');
    assert.strictEqual(nyx.exclusive, true);
});

test('streaks count streams in a row, and end when one is missed', () => {
    const events = [];
    // Kip turns up to all four streams, Nyx misses the last one.
    for (let stream = 0; stream < 4; stream += 1) {
        events.push(request(stream * DAY, kip));
        if (stream < 3) events.push(request(stream * DAY + 60000, nyxWithId));
    }

    const summary = analytics.summarise(events);

    const kipRow = summary.streaks.find(row => row.name === 'Kip');
    const nyxRow = summary.streaks.find(row => row.name === 'NyxTheCat');

    assert.strictEqual(kipRow.longest, 4);
    assert.strictEqual(kipRow.current, 4);
    assert.strictEqual(nyxRow.longest, 3);
    assert.strictEqual(nyxRow.current, 0, 'a streak that stopped is not still running');
});

test('taste overlap is reported between two people who share artists', () => {
    const artistTrack = (id, name) =>
        track({ id, isrc: `${id}-isrc`, artists: [{ id, name }] });

    const summary = analytics.summarise([
        request(0, kip, { track: artistTrack('A', 'One') }),
        request(1000, kip, { track: artistTrack('B', 'Two') }),
        request(2000, kip, { track: artistTrack('C', 'Three') }),
        request(3000, nyxWithId, { track: artistTrack('A', 'One') }),
        request(4000, nyxWithId, { track: artistTrack('B', 'Two') }),
        request(5000, nyxWithId, { track: artistTrack('C', 'Three') })
    ]);

    assert.strictEqual(summary.twins.length, 1);
    assert.strictEqual(summary.twins[0].shared, 3);
    assert.strictEqual(summary.twins[0].overlap, 1, 'identical taste is a perfect overlap');
});

test('the longest and the most obscure track are picked out', () => {
    const summary = analytics.summarise([
        request(0, kip, { track: track({ id: 'SHORT', isrc: 'S', durationMs: 90000, popularity: 90 }) }),
        request(1000, kip, { track: track({ id: 'LONG', isrc: 'L', durationMs: 600000, popularity: 5 }) })
    ]);

    assert.strictEqual(summary.extremes.longest.durationMs, 600000);
    assert.strictEqual(summary.extremes.shortest.durationMs, 90000);
    assert.strictEqual(summary.extremes.obscurest.popularity, 5);
    assert.strictEqual(summary.extremes.mainstream.popularity, 90);
});

test('a track cut short repeatedly shows up as skipped', () => {
    const play = (offsetMs, id, durationMs) => ({
        v: 1, t: at(offsetMs), type: 'play', trackId: id, name: id, artists: 'x', durationMs
    });

    const summary = analytics.summarise([
        // Cut off after 30s of a 4 minute track, twice.
        play(0, 'SKIPME', 240000),
        play(30000, 'FINE', 240000),
        play(30000 + 240000, 'SKIPME', 240000),
        play(30000 + 240000 + 30000, 'FINE', 240000)
    ]);

    const skipped = summary.mostSkipped.map(row => row.trackId);
    assert.deepStrictEqual(skipped, ['SKIPME'], 'a track heard right through is not a skip');
});

test('a decade breakdown copes with Spotify only giving a year', () => {
    const summary = analytics.summarise([
        request(0, kip, { track: track({ id: 'A', isrc: 'A', releaseDate: '1997' }) }),
        request(1000, kip, { track: track({ id: 'B', isrc: 'B', releaseDate: '2003-05' }) }),
        request(2000, kip, { track: track({ id: 'C', isrc: 'C', releaseDate: '2008-05-02' }) })
    ]);

    assert.deepStrictEqual(summary.decades, [
        { decade: 1990, count: 1 },
        { decade: 2000, count: 2 }
    ]);
});
