const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-queuesong-'));
const historyFile = path.join(sandbox, 'queue-history.jsonl');

// Set before anything is required. queueSong pulls in history.js, which
// resolves its path at load.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = historyFile;

const spotifyPath = require.resolve('../spotify.js');
const syncQueuePath = require.resolve('../services/syncQueue.js');
const messagesPath = require.resolve('../services/messages');
const refundPath = require.resolve('../services/refundRedeem');
const historyPath = require.resolve('../services/history');
const queueSongPath = require.resolve('../services/queueSong');

const stubbed = [spotifyPath, syncQueuePath, messagesPath, refundPath, historyPath, queueSongPath];
for (const module of stubbed) delete require.cache[module];

// Stand-ins for everything queueSong reaches for. Loading the real spotify.js
// would read a token file and try to talk to the network.
const spotify = {
    getTrackId: url => (String(url).includes('spotify.com/track/') ? 'TRACKID0000000000000A' : null),
    getTrack: async () => spotify.nextTrack,
    addToQueue: async () => spotify.nextAddResult,
    nextTrack: null,
    nextAddResult: { status: 'ok', track: { id: 'TRACKID0000000000000A' } }
};

const said = [];
let refundResult = true;

require.cache[spotifyPath] = { id: spotifyPath, filename: spotifyPath, loaded: true, exports: spotify };
require.cache[syncQueuePath] = { id: syncQueuePath, filename: syncQueuePath, loaded: true, exports: async () => syncResult };
require.cache[messagesPath] = {
    id: messagesPath, filename: messagesPath, loaded: true,
    exports: { sayMessage: (client, channel, key) => said.push(key), message: key => key }
};
require.cache[refundPath] = {
    id: refundPath, filename: refundPath, loaded: true,
    exports: async () => refundResult
};

let syncResult = true;

const history = require('../services/history');
const queueSong = require('../services/queueSong');

test.after(() => {
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_HISTORY_FILE;
    for (const module of stubbed) delete require.cache[module];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const rawTrack = {
    id: 'TRACKID0000000000000A',
    name: 'Around the World',
    artists: [
        { id: 'ART1', name: 'Daft Punk' },
        { id: 'ART2', name: 'Pharrell Williams' }
    ],
    album: { id: 'ALB1', name: 'Homework', release_date: '1997-01-20' },
    duration_ms: 429000,
    explicit: false,
    popularity: 71,
    external_ids: { isrc: 'GBDUW9700018' },
    available_markets: new Array(180).fill('GB')
};

function freshState(overrides = {}) {
    return {
        queueEnabled: true,
        cooldownSeconds: 0,
        repeatBlockSeconds: 600,
        maxSongLength: 600,
        allowExplicit: true,
        blockedArtists: new Set(),
        blockedSongs: new Set(),
        broadcasterId: 'B1',
        spotifyRewardId: 'R1',
        cooldowns: new Map(),
        pendingQueue: [],
        addPendingTrack() { this.pendingQueue.push({}); },
        rememberRecentRequest() {},
        getRecentRequest: () => null,
        ...overrides
    };
}

async function run(args = {}, state = freshState()) {
    fs.writeFileSync(historyFile, '');
    said.length = 0;
    syncResult = true;
    refundResult = true;
    spotify.nextTrack = rawTrack;
    spotify.nextAddResult = { status: 'ok', track: { id: rawTrack.id } };

    Object.assign(spotify, args.spotify || {});
    if (args.sync === false) syncResult = false;

    await queueSong({
        client: {},
        channel: '#test',
        username: args.username ?? 'NyxTheCat',
        url: args.url ?? 'https://open.spotify.com/track/TRACKID0000000000000A',
        state,
        isRedeem: args.isRedeem ?? false,
        redemptionId: args.redemptionId ?? null,
        requester: args.requester
    });

    // The success and post-add branches sit behind a deliberate 1s timeout in
    // queueSong (it is what stops a burst of requests racing the cooldown).
    // Production timing is not changed to suit the test; the test waits.
    await new Promise(resolve => setTimeout(resolve, 1100));

    return history.readEvents();
}

test('a successful request is logged once, with the whole track', async () => {
    const events = await run({
        requester: { userId: '9001', userLogin: 'nyxthecat', userName: 'NyxTheCat', sub: true, mod: false }
    });

    assert.strictEqual(events.length, 1);
    const [event] = events;

    assert.strictEqual(event.outcome, 'ok');
    assert.strictEqual(event.source, 'chat');
    assert.strictEqual(event.user.id, '9001');
    assert.strictEqual(event.user.login, 'nyxthecat');
    assert.strictEqual(event.user.sub, true);

    // A collaboration keeps both artists, which is the whole reason the raw
    // track is used here rather than formatTrack's joined string.
    assert.deepStrictEqual(event.track.artists.map(a => a.name), ['Daft Punk', 'Pharrell Williams']);
    assert.strictEqual(event.track.isrc, 'GBDUW9700018');
    assert.strictEqual(event.track.available_markets, undefined);

    // Only true at the moment it was queued, so it is stored rather than derived.
    assert.strictEqual(event.queuePosition, 1);
});

test('a request Spotify refuses is not logged as a success', async () => {
    const events = await run({ spotify: { nextAddResult: { status: 'toolong' } } });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].outcome, 'tooLong');
    assert.strictEqual(events[0].track.id, rawTrack.id, 'the track is known here, so it is kept');
});

test('every rejection branch records its own outcome', async () => {
    const cases = [
        ['queueClosed', { }, freshState({ queueEnabled: false })],
        ['cooldown', { }, freshState({ cooldownSeconds: 60, cooldowns: new Map([['nyxthecat', Date.now()]]) })],
        ['invalidUrl', { url: 'banana' }, freshState()],
        ['notFound', { spotify: { nextTrack: null } }, freshState()],
        ['blockedArtist', { }, freshState({ blockedArtists: new Set(['daft punk']) })],
        ['blockedSong', { }, freshState({ blockedSongs: new Set(['TRACKID0000000000000A']) })],
        ['recentlyRequested', { }, freshState({ getRecentRequest: () => ({ requestedAt: new Date().toISOString() }) })],
        ['explicit', { spotify: { nextAddResult: { status: 'explicit' } } }, freshState()],
        ['addFailed', { spotify: { nextAddResult: { status: 'failed' } } }, freshState()],
        ['syncFailed', { sync: false }, freshState()]
    ];

    for (const [expected, args, state] of cases) {
        const events = await run(args, state);
        assert.strictEqual(events.length, 1, `${expected} should log exactly one event`);
        assert.strictEqual(events[0].outcome, expected);
    }
});

test('a blocked artist names which artist it was', async () => {
    const events = await run({}, freshState({ blockedArtists: new Set(['pharrell williams']) }));

    assert.strictEqual(events[0].outcome, 'blockedArtist');
    assert.strictEqual(events[0].blockedArtistName, 'Pharrell Williams',
        'a track has several artists and only one of them is the reason');
});

test('a rejected redeem records whether the points came back', async () => {
    const events = await run(
        { isRedeem: true, redemptionId: 'RD1' },
        freshState({ queueEnabled: false })
    );

    assert.strictEqual(events[0].source, 'redeem');
    assert.strictEqual(events[0].refunded, true);
});

test('what was pasted is kept when the track could not be identified', async () => {
    const events = await run({ url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' });

    assert.strictEqual(events[0].outcome, 'invalidUrl');
    assert.strictEqual(events[0].input, 'https://youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(events[0].track, undefined);
});
