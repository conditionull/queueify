const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-play-'));
const historyFile = path.join(sandbox, 'queue-history.jsonl');

// syncQueue reaches history.js, which resolves its path at load.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = historyFile;

const spotifyPath = require.resolve('../spotify.js');
const historyPath = require.resolve('../services/history');
const syncQueuePath = require.resolve('../services/syncQueue.js');

for (const module of [spotifyPath, historyPath, syncQueuePath]) delete require.cache[module];

// syncQueue destructures these at require time, so the stubs stay the same
// functions throughout and a test changes what they *return*, not which
// function is bound.
let queueFails = false;

const spotify = {
    getUserQueue: async () => (queueFails ? false : { queue: [] }),
    getCurrentTrack: async () => ({ id: 'whatever' })
};

require.cache[spotifyPath] = { id: spotifyPath, filename: spotifyPath, loaded: true, exports: spotify };

const history = require('../services/history');
const syncQueue = require('../services/syncQueue');

test.after(() => {
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_HISTORY_FILE;
    for (const module of [spotifyPath, historyPath, syncQueuePath]) delete require.cache[module];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

// A state stub whose updateActiveTrack just hands back whatever the test set,
// so this exercises syncQueue's once-only logging rather than core/state's
// progress tracking, which has its own tests.
function stateReturning(...activeTracks) {
    const queue = [...activeTracks];
    return {
        updateActiveTrack: () => (queue.length > 1 ? queue.shift() : queue[0]),
        reconcileWithSpotifyQueue: () => {}
    };
}

const playing = {
    id: 'TRACK1',
    name: 'Around the World',
    artists: 'Daft Punk',
    durationMs: 429000,
    queuedBy: 'NyxTheCat',
    queuedAt: '2026-09-16T20:00:00.000Z',
    startedAt: '2026-09-16T20:04:00.000Z'
};

// syncQueue hands the append over without waiting for it - a log write must
// never hold up a request - so the test waits where production does not.
async function plays() {
    await history.flush();
    return history.readEvents().filter(event => event.type === 'play');
}

test('a song starting is logged once, however often the queue is synced', async () => {
    fs.writeFileSync(historyFile, '');

    const state = stateReturning(playing);
    await syncQueue(state);
    await syncQueue(state);
    await syncQueue(state);

    const logged = await plays();
    assert.strictEqual(logged.length, 1, 'three syncs of the same song is still one play');
    assert.strictEqual(logged[0].trackId, 'TRACK1');
    assert.strictEqual(logged[0].queuedBy, 'nyxthecat');
    assert.strictEqual(logged[0].queuedAt, '2026-09-16T20:00:00.000Z');
});

test('the same song played again later is logged again', async () => {
    fs.writeFileSync(historyFile, '');

    // Its own track id: the once-only check spans the process, not the file,
    // so reusing the one above would correctly be treated as already logged.
    const replayed = { ...playing, id: 'TRACK2' };

    // Same track id, new startedAt - which is what core/state mints when it
    // sees the progress bar jump backwards.
    await syncQueue(stateReturning(replayed));
    await syncQueue(stateReturning({ ...replayed, startedAt: '2026-09-16T21:30:00.000Z' }));

    assert.strictEqual((await plays()).length, 2);
});

test('nothing playing logs nothing', async () => {
    fs.writeFileSync(historyFile, '');

    await syncQueue(stateReturning(null));

    assert.strictEqual((await plays()).length, 0);
});

test('a failed Spotify call still reports failure and logs nothing', async () => {
    fs.writeFileSync(historyFile, '');
    queueFails = true;

    const synced = await syncQueue(stateReturning(playing));

    assert.strictEqual(synced, false);
    assert.strictEqual((await plays()).length, 0);

    queueFails = false;
});
