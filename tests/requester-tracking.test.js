const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Who queued the song playing, checked against a fake Spotify that knows the
 * answer.
 *
 * FakeSpotify below is a small player: a queue, a playlist behind it, a
 * playhead and a clock. Every entry carries who really put it there, so after
 * any step the test knows the true requester of the song playing and can hold
 * Queueify's answer up against it. Each named test is a way this used to come
 * out wrong; the random ones at the end throw thousands of mixed-up sessions
 * at it.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-requester-'));

process.env.QUEUEIFY_DATA_DIR = path.join(sandbox, 'boot');
process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'settings.json');
process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'queue-history.jsonl');
fs.mkdirSync(process.env.QUEUEIFY_DATA_DIR);

const spotifyPath = require.resolve('../spotify.js');
const historyPath = require.resolve('../services/history');
const messagesPath = require.resolve('../services/messages');
const statePath = require.resolve('../core/state');
const syncQueuePath = require.resolve('../services/syncQueue.js');
const activePath = require.resolve('../commands/active.js');
const watcherPath = require.resolve('../services/playbackWatcher.js');

const touched = [spotifyPath, historyPath, messagesPath, statePath, syncQueuePath, activePath, watcherPath];
for (const module of touched) delete require.cache[module];

// The clock everything reads. Spotify answers, the state's timing checks and
// the watcher all go through Date.now, so the test can play an hour of music
// in a moment.
const realNow = Date.now;
let clock = 1_800_000_000_000;
Date.now = () => clock;

let fake = null;
const spotify = {
    getCurrentTrack: async options => fake.getCurrentTrack(options),
    getUserQueue: async () => fake.getUserQueue()
};
const plays = [];
const said = [];

const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
stub(spotifyPath, spotify);
stub(historyPath, { recordPlay: play => plays.push(play) });
stub(messagesPath, { sayMessage: (client, channel, key, values) => said.push({ key, values }) });

const { syncWithQueue, placeRequest, takeTurn } = require('../services/syncQueue');
const active = require('../commands/active');
const { createPlaybackWatcher } = require('../services/playbackWatcher');
const { sameTrack } = require('../core/sameTrack');

test.after(async () => {
    Date.now = realNow;
    for (const module of touched) delete require.cache[module];
    delete process.env.QUEUEIFY_DATA_DIR;
    delete process.env.QUEUEIFY_SETTINGS_FILE;
    delete process.env.QUEUEIFY_HISTORY_FILE;

    // core/state debounces its writes by 100ms, and the random sessions never
    // give those timers a turn - every one of them fires here. Let them land
    // (with their retries) before the folder goes.
    await new Promise(resolve => setTimeout(resolve, 1500));
    fs.rmSync(sandbox, { recursive: true, force: true });
});

/* ------------------------------------------------------------ the player */

const QUEUE_WINDOW = 20;

function song(id, { length = 180000, relinkedTo = null } = {}) {
    return { id, name: 'Song ' + id, artists: 'Artist ' + id, durationMs: length, relinkedTo };
}

class FakeSpotify {
    constructor({ playlist = [], queueShowsAskedForId = false } = {}) {
        this.userQueue = [];
        this.playlist = playlist;
        this.playlistAt = 0;
        this.current = null;
        this.paused = false;
        this.idle = false;
        this.cache = null;
        // Which id Spotify's queue lists for a relinked song. Not documented,
        // so both are tested.
        this.queueShowsAskedForId = queueShowsAskedForId;
    }

    static playedId(track) {
        return track.relinkedTo || track.id;
    }

    nowPlaying() {
        if (this.idle || !this.current) return { isPlaying: false };

        const track = this.current.track;
        const id = FakeSpotify.playedId(track);
        return {
            id,
            ids: [...new Set([id, track.id])],
            name: track.name,
            artists: track.artists,
            durationMs: track.durationMs,
            progressMs: this.current.progressMs,
            isPlaying: !this.paused,
            fetchedAt: clock
        };
    }

    // The real one shares an answer for two seconds unless asked for a fresh one.
    getCurrentTrack({ fresh = false } = {}) {
        if (!fresh && this.cache && clock - this.cache.at < 2000) return this.cache.value;

        const value = this.nowPlaying();
        this.cache = { at: clock, value };
        return value;
    }

    listed(track) {
        const id = this.queueShowsAskedForId ? track.id : FakeSpotify.playedId(track);
        return { id, ids: [id], name: track.name, artists: track.artists, durationMs: track.durationMs };
    }

    upcomingPlaylist(count) {
        if (!this.playlist.length) return [];
        return Array.from({ length: count }, (_, at) => this.playlist[(this.playlistAt + at) % this.playlist.length]);
    }

    getUserQueue() {
        if (this.idle) return { currentlyPlaying: null, queue: [] };

        const upcoming = [...this.userQueue.map(entry => entry.track), ...this.upcomingPlaylist(QUEUE_WINDOW)];
        return {
            currentlyPlaying: this.current ? this.listed(this.current.track) : null,
            queue: upcoming.slice(0, QUEUE_WINDOW).map(track => this.listed(track))
        };
    }

    startNext() {
        let entry = this.userQueue.shift();
        if (!entry && this.playlist.length) {
            entry = { track: this.playlist[this.playlistAt % this.playlist.length], by: this.nextPlaylistBy || null };
            this.playlistAt += 1;
        }
        this.nextPlaylistBy = null;
        this.current = entry ? { ...entry, progressMs: 0 } : null;
    }

    /** Let `ms` of music play, songs ending and the next starting as they would. */
    advance(ms) {
        clock += ms;
        if (this.paused || this.idle) return;

        while (ms > 0) {
            if (!this.current) {
                this.startNext();
                if (!this.current) return;
            }

            const remaining = this.current.track.durationMs - this.current.progressMs;
            if (ms < remaining) {
                this.current.progressMs += ms;
                return;
            }

            ms -= remaining;
            this.startNext();
        }
    }

    // What the streamer can do from the Spotify app - with Spotify open. With
    // no device playing there is nothing to do it to.
    skip() {
        if (this.idle) return;
        const before = this.current;
        this.startNext();
        // The streamer's rule, the other way round: skipping a viewer's song
        // that has only just started onto a copy of the same song nobody asked
        // for still plays that viewer's song straight away - it stays theirs.
        if (before && before.by && this.current && !this.current.by &&
            this.current.track.id === before.track.id && before.progressMs <= 1000) {
            this.current.by = before.by;
        }
    }
    restart() { if (this.current && !this.idle) this.current.progressMs = 0; }
    seek(progressMs) { if (this.current && !this.idle) this.current.progressMs = progressMs; }
    remove(index) {
        if (this.idle) return;
        const [gone] = this.userQueue.splice(index, 1);
        // The streamer's rule: taking out the queued copy of the song that has
        // only just started means that viewer's song is playing straight away,
        // so it is theirs - the same as if the streamer had skipped to it.
        const current = this.current;
        if (index === 0 && gone && gone.by && current && current.track.id === gone.track.id && current.progressMs <= 1000) {
            current.by = gone.by;
            return;
        }

        // Taking any copy out of a run of the same song at the front of the
        // queue, with that song only just started and one viewer's copy in the
        // run: nothing tells which copy went, so the song on now is theirs, and
        // their queued copy is credited once - here - not again later.
        if (gone && current && !current.by && current.progressMs <= 1000 && current.track.id === gone.track.id) {
            const run = [];
            for (const entry of this.userQueue) {
                if (entry.track.id !== gone.track.id) break;
                run.push(entry);
            }
            const viewers = run.filter(entry => entry.by);
            if (index <= run.length && viewers.length === 1) {
                current.by = viewers[0].by;
                viewers[0].by = null;
                return;
            }
        }

        // And with the same song right beside it in the queue - the playlist's
        // next song counts - the first copy of that run is theirs: the song
        // they asked for still plays, straight after where theirs would have.
        if (!gone || !gone.by) return;
        const same = entry => entry && entry.track.id === gone.track.id;
        let first = index;
        while (first > 0 && same(this.userQueue[first - 1])) first -= 1;
        if (first < index || same(this.userQueue[index])) {
            if (!this.userQueue[first].by) this.userQueue[first].by = gone.by;
        } else if (index === this.userQueue.length && this.playlist.length &&
            this.playlist[this.playlistAt % this.playlist.length].id === gone.track.id) {
            this.nextPlaylistBy = gone.by;
        }
    }
    playNow(track) {
        if (this.idle) return;
        // Picking the song already on just starts it again - to Spotify, and
        // to anyone listening, a restart.
        if (this.current && this.current.track.id === track.id) this.current.progressMs = 0;
        else this.current = { track, by: null, progressMs: 0 };
    }
    streamerQueues(track) { if (!this.idle) this.userQueue.push({ track, by: null }); }

    /** Who really queued the song playing - null for nobody, undefined for no song. */
    truth() {
        if (this.idle || !this.current) return undefined;
        return this.current.by;
    }
}

/* --------------------------------------------------------------- the bot */

let sandboxes = 0;

/** A fresh core/state in its own directory, or the same directory after a restart. */
function boot(dir = null) {
    if (!dir) {
        sandboxes += 1;
        dir = path.join(sandbox, 'run-' + sandboxes);
        fs.mkdirSync(dir);
    }

    process.env.QUEUEIFY_DATA_DIR = dir;
    delete require.cache[statePath];
    const state = require('../core/state');
    state.dataDir = dir;
    return state;
}

/** What getTrack (market=from_token) and formatTrack make of a request. */
function asRequested(track) {
    const id = FakeSpotify.playedId(track);
    return { id, ids: [...new Set([id, track.id])], name: track.name, artists: track.artists, durationMs: track.durationMs };
}

const sync = state => syncWithQueue(state);

// Whether request() turns away songs already in the queue - see request().
let turnAwayQueued = false;

/**
 * A viewer's request, the way services/queueSong.js takes one: read Spotify
 * first, add it to Spotify's queue, see where it went, then write it down.
 * `meanwhile` starts between Spotify taking it and Queueify writing it down,
 * and runs alongside - a read it makes waits, as the watcher's would.
 */
async function request(state, by, track, meanwhile = null) {
    await sync(state);
    // Spotify refuses to queue anything with no device playing.
    if (fake.idle) return;
    const { placed, before } = await takeTurn(state);
    // The setting on by default in services/queueSong.js: a song Spotify's
    // queue already has is turned away.
    if (turnAwayQueued && before && before.queue.some(item => sameTrack(item, asRequested(track)))) {
        placed();
        return;
    }
    fake.userQueue.push({ track, by });
    const alongside = meanwhile ? meanwhile() : null;
    const where = await placeRequest(state, before ? before.queue : null, asRequested(track));
    state.addPendingTrack(asRequested(track), by, where);
    placed();
    await alongside;
}

/** Who Queueify would credit for the song playing right now, by !np's rule. */
function credited(state) {
    const playing = fake.nowPlaying();
    if (!playing.id) return undefined;

    const track = state.activeTrack;
    return track && sameTrack(track, playing) ? track.queuedBy || null : null;
}

async function np(state) {
    said.length = 0;
    await active.execute({ client: {}, channel: '#test', state });
    return said[0];
}

/** Play `ms` of music, looking every `every` ms as the watcher does. */
async function playFor(state, ms, every = 3000) {
    while (ms > 0) {
        const step = Math.min(every, ms);
        fake.advance(step);
        ms -= step;
        await sync(state);
    }
}

/* ------------------------------------------- each way it used to go wrong */

test('a request that played while nobody was looking does not cost the next one its name', async () => {
    fake = new FakeSpotify({ playlist: [song('p1'), song('p2'), song('p3')] });
    const state = boot();

    fake.startNext();
    await sync(state);
    await request(state, 'ada', song('A', { length: 60000 }));
    await request(state, 'ben', song('B'));
    await sync(state);

    // The song on finishes, Ada's plays right through, Ben's starts - and
    // nothing asked Spotify anything throughout.
    fake.advance(180000 + 60000 + 10000);
    assert.strictEqual(fake.truth(), 'ben');

    const spoken = await np(state);
    assert.strictEqual(spoken.key, 'playback.currentSongQueuedBy');
    assert.strictEqual(spoken.values.queuedBy, 'ben');
});

test('a read landing as a song changes does not drop the request that just started', async () => {
    fake = new FakeSpotify({ playlist: [song('p1')] });
    const state = boot();

    fake.startNext();
    await request(state, 'ada', song('A'));
    await sync(state);

    // Warm the two-second answer with the old song, then let Ada's begin.
    fake.advance(179500);
    fake.getCurrentTrack();
    fake.advance(1500);
    assert.strictEqual(fake.truth(), 'ada');

    await sync(state);
    fake.advance(3000);
    assert.strictEqual((await np(state)).values.queuedBy, 'ada');
});

test('a request paused long enough for Spotify to let go of the device keeps its name', async () => {
    fake = new FakeSpotify();
    const state = boot();

    await request(state, 'ada', song('A'));
    fake.startNext();
    await playFor(state, 30000);

    fake.paused = true;
    await playFor(state, 60000);
    fake.idle = true;
    await playFor(state, 15 * 60000);
    fake.idle = false;
    fake.paused = false;

    await playFor(state, 6000);
    assert.strictEqual((await np(state)).values.queuedBy, 'ada');
});

test('a link from another country, played as the local copy, is still credited', async () => {
    for (const queueShowsAskedForId of [false, true]) {
        fake = new FakeSpotify({ playlist: [song('p1')], queueShowsAskedForId });
        const state = boot();

        fake.startNext();
        await sync(state);
        await request(state, 'ada', song('A-jp', { relinkedTo: 'A-us' }));
        await sync(state);

        await playFor(state, 180000 + 6000);
        assert.strictEqual(fake.truth(), 'ada');
        assert.strictEqual((await np(state)).values.queuedBy, 'ada', `queue lists the ${queueShowsAskedForId ? 'asked-for' : 'local'} id`);
    }
});

test('requests behind more than twenty songs are not thrown away', async () => {
    fake = new FakeSpotify();
    const state = boot();

    for (let at = 0; at < 22; at += 1) fake.streamerQueues(song('s' + at, { length: 30000 }));
    await request(state, 'ada', song('A', { length: 30000 }));
    fake.startNext();
    await sync(state);

    assert.strictEqual(state.pendingQueue.length, 1, 'out of sight is not gone');

    await playFor(state, 22 * 30000 + 6000);
    assert.strictEqual(fake.truth(), 'ada');
    assert.strictEqual(credited(state), 'ada');
});

test('a request for a song that is also further down the playlist is credited', async () => {
    const wanted = song('A');
    fake = new FakeSpotify({ playlist: [song('p1'), song('p2'), wanted, song('p3')] });
    const state = boot();

    fake.startNext();
    await sync(state);
    await request(state, 'ada', wanted);
    await sync(state);

    await playFor(state, 180000 + 6000);
    assert.strictEqual(fake.truth(), 'ada');
    assert.strictEqual(credited(state), 'ada');

    // And the playlist's own copy, when it comes round, is nobody's.
    await playFor(state, 2 * 180000);
    assert.strictEqual(fake.current.track.id, 'A');
    assert.strictEqual(fake.truth(), null);
    assert.strictEqual(credited(state), null);
});

test('restarting the bot mid-song keeps the name', async () => {
    fake = new FakeSpotify();
    let state = boot();

    await request(state, 'ada', song('A'));
    fake.startNext();
    await playFor(state, 60000);

    await new Promise(resolve => setTimeout(resolve, 250));
    state = boot(state.dataDir);
    fake.advance(20000);

    assert.strictEqual((await np(state)).values.queuedBy, 'ada');
});

test('after a long blind spot, the playlist playing a requested song again is not credited', async () => {
    const wanted = song('A');
    fake = new FakeSpotify({ playlist: [song('p1'), song('p2'), wanted, song('p3')] });
    let state = boot();

    fake.startNext();
    await request(state, 'ada', wanted);
    await playFor(state, 180000 + 30000);
    assert.strictEqual(fake.truth(), 'ada');
    assert.strictEqual(credited(state), 'ada');

    // Queueify is down while Ada's finishes, p2 plays, and the playlist's own
    // copy of the same song gets 40 seconds in.
    await new Promise(resolve => setTimeout(resolve, 250));
    fake.advance(150000 + 180000 + 40000);
    state = boot(state.dataDir);

    assert.strictEqual(fake.truth(), null);
    const spoken = await np(state);
    assert.strictEqual(spoken.key, 'playback.currentSong', 'it could be either, so nobody is named');
});

test('the streamer playing a requested song early by hand is not credited to the viewer', async () => {
    const wanted = song('A');
    fake = new FakeSpotify();
    const state = boot();

    fake.playNow(song('x'));
    await request(state, 'ada', wanted);
    await sync(state);

    fake.playNow(wanted);
    await playFor(state, 3000);
    assert.strictEqual(fake.truth(), null);
    assert.strictEqual(credited(state), null);

    // Her own copy, when it gets there, is hers.
    await playFor(state, 180000 + 3000);
    assert.strictEqual(fake.truth(), 'ada');
    assert.strictEqual(credited(state), 'ada');
});

test('a request that went in just after its song began is credited on the next look', async () => {
    fake = new FakeSpotify();
    const state = boot();

    // Spotify takes the song and starts it before Queueify writes it down.
    await request(state, 'ada', song('A'), async () => {
        fake.startNext();
        await sync(state);
    });

    await playFor(state, 3000);
    assert.strictEqual(credited(state), 'ada');
});

test('the first request after starting with Spotify closed is credited', async () => {
    fake = new FakeSpotify();
    fake.idle = true;
    const state = boot();
    await playFor(state, 9000);

    fake.idle = false;
    await request(state, 'ada', song('A'));
    fake.startNext();
    await playFor(state, 3000);

    assert.strictEqual(credited(state), 'ada');
});

test('two people asking for the same song back to back are each credited', async () => {
    fake = new FakeSpotify();
    const state = boot();

    await request(state, 'ada', song('A'));
    await request(state, 'ben', song('A'));
    fake.startNext();

    await playFor(state, 3000);
    assert.strictEqual(credited(state), 'ada');
    await playFor(state, 180000);
    assert.strictEqual(fake.truth(), 'ben');
    assert.strictEqual(credited(state), 'ben');
});

test('a burst of requests at once - two for one song, one for the song on - each gets the right name', async () => {
    const [p1, p2, p3, p4] = ['p1', 'p2', 'p3', 'p4'].map(id => song(id));
    fake = new FakeSpotify({ playlist: [p1, p2, p3, p4] });
    const state = boot();
    fake.startNext();
    await sync(state);

    // All in the playlist too, and all at the same moment. (Not p2: that is
    // next in the playlist, and a request landing right beside the playlist's
    // own copy is the one case that cannot be told - see countCopiesAhead.)
    await Promise.all([
        request(state, 'ada', p3),
        request(state, 'ben', p4),
        request(state, 'cy', p3),
        request(state, 'dot', p1)
    ]);

    assert.strictEqual(credited(state), null, 'the song already on is nobody\'s');
    const heard = [];
    for (let at = 0; at < 4; at += 1) {
        fake.skip();
        await playFor(state, 3000);
        assert.strictEqual(credited(state), fake.truth(), `play ${at + 1}, ${fake.current.track.id}`);
        heard.push(fake.truth());
    }
    assert.deepStrictEqual([...heard].sort(), ['ada', 'ben', 'cy', 'dot']);
});

test('taking out a queued copy of the song playing leaves the one playing its name', async () => {
    for (const into of [61000, 3000]) {
        const wanted = song('A');
        fake = new FakeSpotify({ playlist: [song('p1')] });
        const state = boot();
        await request(state, 'ada', wanted);
        fake.startNext();
        await playFor(state, 3000);
        // Ben asks for the same song again while Ada's plays.
        await request(state, 'ben', wanted);
        fake.seek(into);
        await sync(state);

        fake.remove(0);
        await sync(state);
        assert.strictEqual(fake.truth(), 'ada');
        assert.strictEqual(credited(state), 'ada', `taken out ${into / 1000}s in`);
    }
});

test('a viewer\'s song playing straight away is theirs, whether you skipped to it or took their copy out', async () => {
    for (const howItGoes of ['skip', 'take out']) {
        const wanted = song('A');
        fake = new FakeSpotify({ playlist: [song('p1')] });
        const state = boot();
        fake.startNext();
        await request(state, 'ada', wanted);

        // You put the same song on by hand, and straight away either skip to
        // Ada's copy or take it out of the queue.
        fake.playNow(wanted);
        await sync(state);
        if (howItGoes === 'skip') fake.skip();
        else fake.remove(0);
        await sync(state);

        assert.strictEqual(fake.truth(), 'ada');
        assert.strictEqual(credited(state), 'ada', howItGoes);
    }
});

test('skipping to the next copy of the song playing credits whoever asked for that copy', async () => {
    const wanted = song('A');
    fake = new FakeSpotify({ playlist: [song('p1')] });
    const state = boot();
    await request(state, 'ada', wanted);
    fake.startNext();
    await playFor(state, 3000);
    await request(state, 'ben', wanted);

    fake.skip();
    await sync(state);
    assert.strictEqual(fake.truth(), 'ben');
    assert.strictEqual(credited(state), 'ben');
});

test('each request is logged as played exactly once', async () => {
    fake = new FakeSpotify({ playlist: [song('p1')] });
    const state = boot();
    plays.length = 0;

    await request(state, 'ada', song('A'));
    await request(state, 'ben', song('B'));
    fake.startNext();
    await playFor(state, 2 * 180000 + 60000);

    assert.deepStrictEqual(plays.map(play => play.queuedBy), ['ada', 'ben']);
});

test('reads that overlap share one answer instead of racing', () => {
    fake = new FakeSpotify();
    const state = boot();

    const first = syncWithQueue(state);
    assert.strictEqual(syncWithQueue(state), first);
    return first;
});

test('!np with nothing playing says so, rather than naming an empty song', async () => {
    fake = new FakeSpotify();
    const state = boot();

    assert.strictEqual((await np(state)).key, 'playback.nothingPlaying');
});

/* ------------------------------------------------------------ the watcher */

test('the watcher only reads the queue when the song may have changed', async () => {
    fake = new FakeSpotify();
    const state = boot();
    let syncs = 0;
    const watcher = createPlaybackWatcher({
        state,
        getCurrentTrack: options => spotify.getCurrentTrack(options),
        syncWithQueue: s => { syncs += 1; return syncWithQueue(s); }
    });

    await request(state, 'ada', song('A', { length: 60000 }));
    fake.startNext();
    await watcher.tick();
    assert.strictEqual(syncs, 1, 'the first look reads everything');

    for (let at = 0; at < 5; at += 1) {
        fake.advance(3000);
        await watcher.tick();
    }
    assert.strictEqual(syncs, 1, 'the same song carrying on needs no queue');

    fake.advance(50000);
    await watcher.tick();
    assert.strictEqual(syncs, 2, 'a new song does');

    await request(state, 'ben', song('B'));
    fake.advance(1000);
    await watcher.tick();
    assert.strictEqual(syncs, 3, 'and so does a new request');

    fake.advance(31000);
    await watcher.tick();
    assert.strictEqual(syncs, 4, 'and every half minute regardless');
});

test('the watcher alone keeps the name right with nobody typing anything', async () => {
    fake = new FakeSpotify({ playlist: [song('p1', { length: 45000 })] });
    const state = boot();
    const watcher = createPlaybackWatcher({ state, getCurrentTrack: options => spotify.getCurrentTrack(options), syncWithQueue });

    fake.startNext();
    await request(state, 'ada', song('A', { length: 50000 }));
    await request(state, 'ben', song('B', { length: 40000 }));

    let checked = 0;
    for (let at = 0; at < 80; at += 1) {
        fake.advance(3000);
        await watcher.tick();
        if (fake.truth() !== undefined) {
            assert.strictEqual(credited(state), fake.truth(), `at ${at * 3}s, playing ${fake.current.track.id}`);
            checked += 1;
        }
    }
    assert.ok(checked > 70);
});

/* ------------------------------------------------------- random sessions */

// A small seeded generator, so a failure prints a seed that reproduces it.
function random(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6D2B79F5) >>> 0;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const VIEWERS = ['ada', 'ben', 'cy', 'dot'];

/**
 * One made-up stream. `look` decides when Queueify gets to read Spotify.
 * Returns what was checked, for the caller to judge.
 *
 * With `repeats`, songs come from a catalog of `catalogSize` - six by default
 * - so the same song keeps turning up twice in the queue, in the playlist and
 * played by hand. Without, every song is a new one - a stream where no song is
 * queued twice.
 */
async function session(seed, { steps, actions, look, repeats = true, catalogSize = 6, turnAway = false, trace = null }) {
    turnAwayQueued = turnAway;
    const rand = random(seed);
    const pick = list => list[Math.floor(rand() * list.length)];

    const catalog = Array.from({ length: catalogSize }, (_, at) => song('t' + at, {
        length: 20000 + Math.floor(rand() * 60000),
        relinkedTo: at === 0 ? 't0-local' : null
    }));
    let made = 0;
    const another = () => {
        made += 1;
        return song('n' + made, {
            length: 20000 + Math.floor(rand() * 60000),
            relinkedTo: made % 5 === 0 ? 'n' + made + '-local' : null
        });
    };
    const anySong = () => (repeats ? pick(catalog) : another());

    fake = new FakeSpotify({
        playlist: Array.from({ length: 1 + Math.floor(rand() * 8) }, anySong),
        queueShowsAskedForId: rand() < 0.5
    });
    let state = boot();
    const results = [];
    const log = [];

    fake.startNext();
    for (let step = 0; step < steps; step += 1) {
        const action = pick(actions);
        log.push(action);

        switch (action) {
            case 'request': await request(state, pick(VIEWERS), anySong()); break;
            case 'late request': {
                // Into Spotify now, written down only after the next look.
                await request(state, pick(VIEWERS), anySong(), async () => {
                    fake.advance(1000);
                    if (look(rand)) await sync(state);
                });
                break;
            }
            case 'streamer queues': fake.streamerQueues(anySong()); break;
            case 'play': fake.advance(Math.floor(rand() * 3000)); break;
            case 'long play': fake.advance(Math.floor(rand() * 240000)); break;
            case 'skip': fake.skip(); break;
            case 'restart':
                // Not in the last few seconds, where a restart and the next
                // copy starting look the same - see the README for that limit.
                if (fake.current && fake.current.track.durationMs - fake.current.progressMs > 10000) fake.restart();
                break;
            case 'scrub':
                if (fake.current) fake.seek(Math.floor(rand() * (fake.current.track.durationMs - 10000)));
                break;
            case 'remove': if (fake.userQueue.length) fake.remove(Math.floor(rand() * fake.userQueue.length)); break;
            case 'play by hand': fake.playNow(anySong()); break;
            case 'pause': fake.paused = !fake.paused; break;
            case 'close Spotify': fake.idle = !fake.idle; break;
            case 'restart bot':
                // No waiting for the debounced writes: what is on disk may be
                // a step behind, like after a crash, and that must not make a
                // name wrong either.
                state = boot(state.dataDir);
                break;
        }

        if (look(rand)) {
            await sync(state);
            if (trace) trace({ step, action, fake, state });
            const truth = fake.truth();
            if (truth !== undefined) results.push({ truth, credited: credited(state), step, log: log.slice(-12) });
        }
    }

    turnAwayQueued = false;
    return results;
}

const EVERYTHING = ['request', 'request', 'late request', 'streamer queues', 'play', 'play', 'play', 'skip',
    'restart', 'scrub', 'remove', 'play by hand', 'pause', 'close Spotify'];

const wrong = (seed, result) =>
    `seed ${seed}, step ${result.step}: credited ${result.credited}, really ${result.truth}\n  ${result.log.join(' > ')}`;

test('random streams, looked at as often as the watcher looks: always exactly right', async () => {
    let checks = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
        for (const result of await session(seed, { steps: 120, actions: EVERYTHING, look: () => true, repeats: false })) {
            checks += 1;
            assert.strictEqual(result.credited, result.truth, wrong(seed, result));
        }
    }
    assert.ok(checks > 7500, `only ${checks} checks`);
});

// How often a request playing gets its name, at least, with songs drawn from
// catalogs this size. Two copies of one song in Spotify's queue can be
// impossible to tell apart - [A, A] reads the same whichever one a viewer
// asked for - and then it says nothing. The fewer songs there are, the more
// often that happens; it must never guess.
//
// With "Turn away songs already in the queue" on - the default - viewers
// cannot make those copies, and the copies the streamer makes are settled by
// the streamer's rule (a viewer's song playing straight away is theirs), so
// every request playing gets its name.
const NAMED_AT_LEAST = [
    { catalogSize: 6, share: 0.5, turnAway: false },
    { catalogSize: 12, share: 0.8, turnAway: false },
    { catalogSize: 25, share: 0.85, turnAway: false },
    { catalogSize: 50, share: 0.9, turnAway: false },
    { catalogSize: 6, share: 1, turnAway: true },
    { catalogSize: 25, share: 1, turnAway: true }
];

for (const { catalogSize, share, turnAway } of NAMED_AT_LEAST) {
    const setting = turnAway ? 'turning away songs already queued' : 'letting copies in';
    test(`random streams drawing on ${catalogSize} songs, ${setting}: never a wrong name, and named ${share * 100}% of the time`, async () => {
        let requested = 0;
        let named = 0;
        for (let seed = 1; seed <= 100; seed += 1) {
            const options = { steps: 120, actions: EVERYTHING, look: () => true, catalogSize, turnAway };
            for (const result of await session(seed, options)) {
                if (result.credited !== null) assert.strictEqual(result.credited, result.truth, wrong(seed, result));
                if (result.truth !== null) {
                    requested += 1;
                    if (result.credited !== null) named += 1;
                }
            }
        }
        assert.ok(requested > 1000, `only ${requested} checks of a request playing`);
        assert.ok(named / requested >= share, `named ${named} of ${requested}`);
    });
}

test('random streams with long blind spots: a name, when given, is always the right one', async () => {
    // Everything that can be told apart after the fact. Skipping, removing
    // and playing by hand are left out: in a blind spot those can leave
    // Spotify looking exactly as if the queue had played normally.
    const actions = ['request', 'request', 'late request', 'streamer queues', 'play', 'long play', 'long play',
        'restart', 'scrub', 'pause', 'close Spotify', 'restart bot'];

    let checks = 0;
    let named = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
        for (const [repeats, catalogSize] of [[true, 6], [true, 25], [false, 6]]) {
            for (const result of await session(seed, { steps: 60, actions, look: rand => rand() < 0.3, repeats, catalogSize })) {
                checks += 1;
                if (result.credited !== null) {
                    named += 1;
                    assert.strictEqual(result.credited, result.truth, wrong(seed, result) + (repeats ? '' : ' (no repeats)'));
                }
            }
        }
    }
    // Few, on purpose: after minutes unseen, a request has usually had time to
    // play right through, and the copy on now could be the playlist's.
    assert.ok(checks > 2000 && named > 30, `${checks} checks, ${named} named`);
});
