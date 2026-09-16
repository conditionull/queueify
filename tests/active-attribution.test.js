const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-active-'));

// syncQueue reaches the request log, which resolves its path at load.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'queue-history.jsonl');

const spotifyPath = require.resolve('../spotify.js');
const messagesPath = require.resolve('../services/messages');
const historyPath = require.resolve('../services/history');
const syncQueuePath = require.resolve('../services/syncQueue.js');
const activePath = require.resolve('../commands/active.js');

const stubbed = [spotifyPath, messagesPath, historyPath, syncQueuePath, activePath];
for (const module of stubbed) delete require.cache[module];

let nowPlaying = null;
let queueFails = false;

const spotify = {
    getCurrentTrack: async () => (queueFails ? false : nowPlaying),
    getUserQueue: async () => (queueFails ? false : { queue: [] })
};

const said = [];

require.cache[spotifyPath] = { id: spotifyPath, filename: spotifyPath, loaded: true, exports: spotify };
require.cache[messagesPath] = {
    id: messagesPath, filename: messagesPath, loaded: true,
    exports: {
        sayMessage: (client, channel, key, values) => said.push({ key, values }),
        message: key => key
    }
};

const active = require('../commands/active.js');

test.after(async () => {
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_HISTORY_FILE;
    for (const module of stubbed) delete require.cache[module];

    // core/state debounces its writes by 100ms and chains them; removing the
    // sandbox first makes them fail noisily against a directory that has gone.
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const playing = { id: 'TRACK1', name: 'Clocks', artists: 'Coldplay' };

/**
 * A state stub standing in for core/state.
 *
 * `pending` is what Queueify believes it queued. updateActiveTrack mirrors the
 * real rule: attribution only survives if the playing track is the head of the
 * pending queue.
 */
function stateWith(pending) {
    return {
        activeTrack: null,
        pendingQueue: pending ? [pending] : [],
        updateActiveTrack(currentlyPlaying) {
            const next = this.pendingQueue[0];
            this.activeTrack = next && currentlyPlaying && next.id === currentlyPlaying.id
                ? { ...next, startedAt: new Date().toISOString() }
                : null;
            return this.activeTrack;
        },
        reconcileWithSpotifyQueue() {}
    };
}

async function run(state, extra = {}) {
    said.length = 0;
    await active.execute({ client: {}, channel: '#test', state, username: 'viewer', ...extra });
    return said[0];
}

test('the song it queued is credited to whoever asked for it', async () => {
    nowPlaying = playing;
    queueFails = false;

    const spoken = await run(stateWith({ id: 'TRACK1', name: 'Clocks', queuedBy: 'nyxthecat' }));

    assert.strictEqual(spoken.key, 'playback.currentSongQueuedBy');
    assert.strictEqual(spoken.values.queuedBy, 'nyxthecat');
    assert.strictEqual(spoken.values.name, 'Clocks');
});

test('a song nobody requested is named without crediting anyone', async () => {
    nowPlaying = playing;
    queueFails = false;

    // The streamer put this on themselves: nothing is pending.
    const spoken = await run(stateWith(null));

    assert.strictEqual(spoken.key, 'playback.currentSong');
    assert.strictEqual(spoken.values.queuedBy, null);
});

test('a different song playing is never credited to the last requester', async () => {
    nowPlaying = { id: 'SOMETHING-ELSE', name: 'Teardrop', artists: 'Massive Attack' };
    queueFails = false;

    // This is the bug that made the feature wrong before: state still knows
    // about a song Nyx queued, but it is not what is playing.
    const spoken = await run(stateWith({ id: 'TRACK1', name: 'Clocks', queuedBy: 'nyxthecat' }));

    assert.strictEqual(spoken.key, 'playback.currentSong');
    assert.strictEqual(spoken.values.name, 'Teardrop');
    assert.strictEqual(spoken.values.queuedBy, null, 'crediting the wrong person is worse than crediting nobody');
});

test('a stale requester is not used when Spotify could not be reached', async () => {
    const state = stateWith({ id: 'TRACK1', name: 'Clocks', queuedBy: 'nyxthecat' });

    // Something set earlier in the session, which nothing has refreshed since.
    state.activeTrack = { id: 'TRACK1', name: 'Clocks', queuedBy: 'stale-person' };

    nowPlaying = playing;
    queueFails = true;

    const spoken = await run(state);

    assert.strictEqual(spoken.key, 'playback.currentLookupFailed');
});

test('scrubbing back inside a song keeps the credit and is not a second play', () => {
    // The real core/state, not the stub above: this pins the rule the changelog
    // promises, which lives in updateActiveTrack's replay detection.
    const statePath = require.resolve('../core/state');
    delete require.cache[statePath];

    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'settings.json');
    const state = require('../core/state');

    try {
        state.pendingQueue = [{ id: 'T1', name: 'Clocks', queuedBy: 'nyxthecat' }];
        const at = progressMs => ({ id: 'T1', progressMs });

        const started = state.updateActiveTrack(at(1000));
        assert.strictEqual(started?.queuedBy, 'nyxthecat');
        const startedAt = started.startedAt;

        assert.strictEqual(state.updateActiveTrack(at(120000))?.queuedBy, 'nyxthecat');

        // A small nudge, inside the grace.
        assert.strictEqual(state.updateActiveTrack(at(117000))?.queuedBy, 'nyxthecat');

        // A real drag backwards, but landing in the middle of the song rather
        // than at its start: the same play, so the same person keeps it.
        const scrubbed = state.updateActiveTrack(at(45000));
        assert.strictEqual(scrubbed?.queuedBy, 'nyxthecat',
            'scrubbing back should not cost the requester their credit');
        assert.strictEqual(scrubbed.startedAt, startedAt,
            'and startedAt must not move, or it is logged as a second play');

        assert.strictEqual(state.updateActiveTrack(at(60000))?.queuedBy, 'nyxthecat',
            'still the same play afterwards');
    } finally {
        delete process.env.QUEUEIFY_SETTINGS_FILE;
        delete require.cache[statePath];
    }
});

test('the same song queued twice credits the second person when it comes round', () => {
    const statePath = require.resolve('../core/state');
    delete require.cache[statePath];

    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'settings2.json');
    const state = require('../core/state');

    try {
        // Two people asked for the same track, so it is in the queue twice.
        state.pendingQueue = [
            { id: 'T1', name: 'Clocks', queuedBy: 'nyxthecat' },
            { id: 'T1', name: 'Clocks', queuedBy: 'kip' }
        ];
        const at = progressMs => ({ id: 'T1', progressMs });

        assert.strictEqual(state.updateActiveTrack(at(500))?.queuedBy, 'nyxthecat');
        assert.strictEqual(state.updateActiveTrack(at(200000))?.queuedBy, 'nyxthecat');

        // Kip's copy now starts: same track id, but the playhead is back at the
        // beginning. This is why the rewind check exists, and it has to keep
        // working now that a mid-song scrub no longer triggers it.
        const second = state.updateActiveTrack(at(400));
        assert.strictEqual(second?.queuedBy, 'kip',
            'the second copy belongs to whoever asked for it');
    } finally {
        delete process.env.QUEUEIFY_SETTINGS_FILE;
        delete require.cache[statePath];
    }
});

test('every placeholder in the credited message gets a value', async () => {
    delete require.cache[messagesPath];
    const { message } = require('../services/messages');

    const text = message('playback.currentSongQueuedBy', {
        name: 'Clocks', artists: 'Coldplay', queuedBy: 'nyxthecat'
    });

    assert.ok(!text.includes('{{'), `a placeholder was left unfilled: ${text}`);
    assert.match(text, /nyxthecat/);

    require.cache[messagesPath] = {
        id: messagesPath, filename: messagesPath, loaded: true,
        exports: {
            sayMessage: (client, channel, key, values) => said.push({ key, values }),
            message: key => key
        }
    };
});
