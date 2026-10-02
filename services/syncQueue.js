const { getCurrentTrack, getUserQueue } = require("../spotify");
const { sameTrack } = require("../core/sameTrack");
const history = require("./history");

// How many times to read again when the song playing and the queue disagree
// about what is on. They come from two requests, so one can land either side
// of a song changing; twice in a row is all but impossible.
const SNAPSHOT_ATTEMPTS = 3;

// The last track we logged as started, keyed by id *and* the time it started.
// A replay mints a fresh startedAt (see core/state.js's updateActiveTrack), so
// this logs somebody hearing the same song twice while never logging the same
// play twice.
let lastPlayKey = null;

// The sync running now for each state, if one is. Everyone asking meanwhile
// shares it.
const inFlight = new WeakMap();

// Requests being added right now, per state - see beginPlacement.
const placements = new WeakMap();

/**
 * Record a requested song starting, once.
 *
 * This lives here rather than in `core/state.js` on purpose: state has no
 * service dependencies and is required standalone by several tests, and adding
 * one to it would drag the whole log into those.
 *
 * Only requests: activeTrack also holds songs nobody asked for, and the log
 * has only ever been about what chat got to hear.
 */
function notePlay(activeTrack) {
    if (!activeTrack?.id || !activeTrack.queuedBy) return;

    const key = `${activeTrack.id}:${activeTrack.startedAt}`;
    if (key === lastPlayKey) return;
    lastPlayKey = key;

    history.recordPlay({
        track: activeTrack,
        queuedBy: activeTrack.queuedBy,
        queuedAt: activeTrack.queuedAt
    });
}

/**
 * Whether the song playing and the queue were read at the same moment.
 *
 * The queue answer names the song playing too, so the two can be checked
 * against each other. A stub queue with no `currentlyPlaying` at all has
 * nothing to check.
 */
function agree(currentTrack, spotifyQueue) {
    if (spotifyQueue.currentlyPlaying === undefined) return true;

    const playing = currentTrack?.id ? currentTrack : null;
    const queued = spotifyQueue.currentlyPlaying?.id ? spotifyQueue.currentlyPlaying : null;

    if (!playing || !queued) return !playing && !queued;
    return sameTrack(playing, queued);
}

/**
 * The song playing and the queue, read so they describe the same moment - or
 * false.
 *
 * This is what every name rests on. The song playing used to come out of a
 * two-second cache while the queue was read fresh, so a sync just after a song
 * changed saw the new queue (the request gone from it) next to the old song,
 * and the request was dropped as if it had already played. Its name never
 * appeared. Both are read fresh now, and checked against each other.
 */
async function readSnapshot() {
    for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
        const currentTrack = await getCurrentTrack({ fresh: true });
        const spotifyQueue = await getUserQueue();

        if (spotifyQueue === false || currentTrack === false) return false;
        if (agree(currentTrack, spotifyQueue)) return { currentTrack, spotifyQueue };
    }

    console.warn("Spotify kept changing songs mid-read - skipping this queue check.");
    return false;
}

/** Requests half added right now, other than `own`. */
function othersPlacing(state, own) {
    return [...(placements.get(state) || [])].filter(placed => placed !== own);
}

/** Wait until no request other than `own` is half added. */
async function placementsSettled(state, own = null) {
    while (othersPlacing(state, own).length) await Promise.all(othersPlacing(state, own));
}

async function runSync(state, own = null) {
    let snapshot;
    do {
        await placementsSettled(state, own);
        const epoch = placements.get(state)?.epoch ?? 0;
        snapshot = await readSnapshot();
        if (!snapshot) return false;
        // A request went into Spotify while this was reading: the read may
        // hold it before Queueify has written it down. Read again after.
        if ((placements.get(state)?.epoch ?? 0) !== epoch || othersPlacing(state, own).length) snapshot = null;
    } while (!snapshot);

    const { currentTrack, spotifyQueue } = snapshot;
    notePlay(state.updateActiveTrack(currentTrack, spotifyQueue.queue));

    // readAt: which read the pending list's positions are in - the widget
    // names its Up next row by them (services/upNext.js).
    return { ...spotifyQueue, currentTrack, readAt: state.lastSpotifyQueueAt ?? null };
}

/**
 * The same sync, handing back the Spotify queue it read - or false. The
 * widget's Up next row shows that queue, so reading it here saves asking
 * Spotify for it twice. `currentTrack` is the song playing in the same read,
 * which is what !np names.
 *
 * One at a time. Two overlapping syncs could finish in either order, and an
 * older answer applied last would take the state back to a song that has
 * already ended - losing whoever asked for the one now playing.
 */
function syncWithQueue(state) {
    if (!inFlight.has(state)) {
        inFlight.set(state, runSync(state).finally(() => {
            inFlight.delete(state);
        }));
    }

    return inFlight.get(state);
}

async function syncQueue(state) {
    return (await syncWithQueue(state)) !== false;
}

/**
 * Hold every read of the queue back while a request is added. Call it just
 * before the song goes into Spotify's queue, and call what it returns once it
 * is written down in the pending list (or turned out not to go in at all).
 *
 * In between, the song is in Spotify's queue but not in Queueify's list, and a
 * read taken then - by the watcher, the widget, !np - would file it as a song
 * nobody asked for and follow it as one from then on. A read waits a second at
 * most for this.
 */
function beginPlacement(state) {
    if (!placements.has(state)) {
        const set = new Set();
        set.epoch = 0;
        placements.set(state, set);
    }

    const set = placements.get(state);
    set.epoch += 1;
    let finish;
    const placed = new Promise(resolve => { finish = resolve; });
    set.add(placed);

    const done = () => {
        set.delete(placed);
        finish();
    };
    done.placed = placed;
    return done;
}

/**
 * A request's turn to go into Spotify's queue: waits for any other request
 * being added to finish, then holds reads back (beginPlacement) and reads the
 * queue once more. Resolves to `{ placed, before }` - call `placed` as with
 * beginPlacement; `before` is that read, or false.
 *
 * One at a time because two songs put in at once both show up in the next
 * read, and then neither one's place can be told from the other's - a burst
 * of chat requests for songs already in the playlist used to come out with no
 * names. Each waits about a second for the one before it.
 */
async function takeTurn(state) {
    while (othersPlacing(state, null).length) await Promise.all(othersPlacing(state, null));

    const placed = beginPlacement(state);
    try {
        return { placed, before: await runSync(state, placed.placed) };
    } catch (err) {
        placed();
        throw err;
    }
}

/**
 * How many copies of a song just added to Spotify's queue are ahead of it
 * that are not requests themselves - or null when that cannot be told - and
 * the place it went in at, when that is known.
 *
 * Spotify's queue is just tracks. If the streamer queued a song and a viewer
 * asks for the same one straight after, the queue shows it twice, and nothing
 * Spotify says later tells the two apart when the first one starts. Where
 * Spotify put the new copy can, though: `before` is the queue read just before
 * adding it, `after` the queue now, and the copy is wherever the two first
 * differ. core/state.js uses the count to let the copies ahead go by without
 * crediting anyone.
 */
function countCopiesAhead(before, after, track, requestAt = () => false) {
    const isCopy = item => sameTrack(item, track);
    before = Array.isArray(before) ? before : null;
    after = Array.isArray(after) ? after : null;

    // No copy in sight to be confused with. (One further down than Spotify
    // shows would have to come into sight first, and core/state.js follows
    // each song by position as it does.)
    const nothingAhead = before && !before.some(isCopy);

    const unplaced = { copiesAhead: nothingAhead ? 0 : null, insertedAt: null };
    if (!before || !after) return unplaced;

    let at = 0;
    while (at < after.length && at < before.length && sameTrack(after[at], before[at])) at += 1;

    const placed = at < after.length && isCopy(after[at]) &&
        after.slice(at + 1).every((item, index) => index + at >= before.length || sameTrack(item, before[index + at]));
    if (!placed) return unplaced;

    const others = before.slice(0, at).filter((item, index) => isCopy(item) && !requestAt(index)).length;

    // Put down next to a copy that is not a known request, it could be on
    // either side of it: [A, A] reads the same whichever one is new, and the
    // other one may be the playlist's, which comes after. Then it cannot be
    // told. Next to requests it does not matter - a request goes in after
    // every one already there.
    for (let index = at - 1; index >= 0 && isCopy(before[index]); index -= 1) {
        if (!requestAt(index)) return { copiesAhead: null, insertedAt: null };
    }
    return { copiesAhead: others, insertedAt: at };
}

/**
 * Read Spotify's queue after adding a request, and count the copies ahead of
 * it. See countCopiesAhead.
 */
async function placeRequest(state, before, track) {
    const after = await getUserQueue();

    // Which places in `before` hold a request for this song - known only if
    // `before` is the read the pending list's positions are in.
    const last = state.lastSpotifyQueue;
    const sameRead = Array.isArray(before) && Array.isArray(last) && last.length === before.length &&
        last.every((item, index) => sameTrack(item, before[index]));
    const requestAt = index => sameRead && state.pendingQueue.some(item =>
        item.queueAt === index && item.queueReadAt === state.lastSpotifyQueueAt && sameTrack(item, track));

    const placed = countCopiesAhead(before, after ? after.queue : null, track, requestAt);
    // A place in `before` only means something to core/state.js if that is
    // the read its positions are in.
    return { ...placed, insertedAt: sameRead ? placed.insertedAt : null, insertedInto: sameRead ? state.lastSpotifyQueueAt : null };
}

module.exports = syncQueue;
module.exports.syncWithQueue = syncWithQueue;
module.exports.placeRequest = placeRequest;
module.exports.beginPlacement = beginPlacement;
module.exports.takeTurn = takeTurn;
module.exports.countCopiesAhead = countCopiesAhead;
