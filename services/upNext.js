/**
 * What the widget knows about the queue: who asked for the song playing, and
 * what plays after it.
 *
 * "What plays after it" is the streamer's own Spotify queue - requests, songs
 * they queued themselves, and the rest of the playlist - because that is what
 * will actually play. Songs chat asked for are matched back to Queueify's own
 * list, so each one knows who asked for it. A theme can choose to show only
 * those (see the Up next part's "Show" setting, applied in app.js).
 *
 * Asking Spotify costs a request, so the answer is kept for a few seconds and
 * only asked again sooner when something changed that the queue depends on:
 * a new song started, or chat queued one. The same call brings Queueify's own
 * list up to date (services/syncQueue.js), which is what makes the requester
 * right as soon as a request starts playing.
 */

const perks = require('./perks');
const { sameTrack } = require('../core/sameTrack');

const LIMIT = 5;
// Half a minute: a song changing or a request going in asks again straight
// away, so this only bounds how long the streamer's own queue edits take to
// show. Every ask is two Spotify calls, and they add up against its limit.
const QUEUE_TTL_MS = 30000;

/**
 * The requests still to come after the song playing - what is shown when
 * Spotify's queue cannot be read.
 *
 * The song playing can still be at the head of the list - syncQueue moves it
 * off only when it runs - so everything up to and including it is skipped.
 * When it is not in the list at all, none of the list has started yet.
 */
function upcoming(pendingQueue, currentId, limit = LIMIT) {
    const list = Array.isArray(pendingQueue) ? pendingQueue : [];
    const at = currentId ? list.findIndex(item => item && sameTrack(item, { id: currentId })) : -1;

    return list.slice(at + 1, at + 1 + limit);
}

/**
 * Who asked for the song playing, or null.
 *
 * The same rule as !np (commands/active.js), read from the same place: the
 * name core/state.js settled on for activeTrack. read() below syncs whenever
 * the song changes, so activeTrack is already about this song. There used to
 * be a second way in here - "the head of the pending list, just begun" - and
 * two rules meant the widget and !np could disagree about the same song.
 */
function requesterOf(state, currentId) {
    const item = requestPlaying(state, currentId);
    return item ? item.queuedBy || null : null;
}

/** The queued request that is the song playing, by the same rule, or null. */
function requestPlaying(state, currentId) {
    if (!currentId) return null;

    const active = state.activeTrack;
    return active && active.queuedBy && sameTrack(active, { id: currentId }) ? active : null;
}

/**
 * Spotify's queue, each song carrying who requested it, if chat did.
 *
 * Given `readAt` - the read this queue came from - each request is matched by
 * its place in that read, worked out in core/state.js: the same name !np will
 * give when the song starts, and none for a copy that could be anyone's. A
 * request placed by a later read than this queue gets no name until the
 * widget asks again, rather than a name off by one.
 *
 * Without it, matched by track in order: the same song queued twice by two
 * people is two entries in both lists, and the first one in Spotify's queue
 * is the first one requested. A song nobody requested gets no name.
 */
function withRequesters(queue, pendingQueue, readAt = null) {
    const list = Array.isArray(queue) ? queue : [];

    if (readAt !== null) {
        const byPlace = new Map();
        for (const request of Array.isArray(pendingQueue) ? pendingQueue : []) {
            if (request && request.creditable !== false && request.queueReadAt === readAt && Number.isInteger(request.queueAt)) {
                byPlace.set(request.queueAt, request.queuedBy || null);
            }
        }
        return list.map((item, index) => item && { ...item, queuedBy: byPlace.get(index) || null }).filter(Boolean);
    }

    const waiting = (Array.isArray(pendingQueue) ? pendingQueue : []).filter(item => item && item.id);

    return list.filter(Boolean).map(item => {
        const at = waiting.findIndex(request => sameTrack(request, item));
        const request = at === -1 ? null : waiting.splice(at, 1)[0];
        return { ...item, queuedBy: request ? request.queuedBy || null : null };
    });
}

/** The shape the widget gets. Only what it draws - nothing else leaves. */
function forWidget(item) {
    return {
        title: String(item.name || ''),
        artist: String(item.artists || ''),
        cover: item.thumb || item.cover || null,
        requester: item.queuedBy || null
    };
}

function createUpNext({ state, syncWithQueue, now = Date.now }) {
    let cache = { key: null, at: 0, queue: null, readAt: null };
    let asking = null;

    // What the queue depends on. Either changing means the saved answer is
    // out of date, however new it is.
    const keyFor = currentId => `${currentId}|${state.pendingQueue.length}`;

    function spotifyQueue(currentId) {
        if (cache.queue && cache.key === keyFor(currentId) && now() - cache.at < QUEUE_TTL_MS) {
            return Promise.resolve(cache);
        }

        if (!asking) {
            asking = Promise.resolve()
                .then(() => syncWithQueue(state))
                .then(result => {
                    // Keyed after the sync, which can move a request off the
                    // list - otherwise that alone would ask again straight away.
                    cache = {
                        key: keyFor(currentId),
                        at: now(),
                        queue: result ? result.queue || [] : null,
                        readAt: result && Number.isFinite(result.readAt) ? result.readAt : null
                    };
                    return cache;
                })
                .catch(() => ({ queue: null, readAt: null }))
                .finally(() => { asking = null; });
        }

        return asking;
    }

    return async function read(currentTrack) {
        const currentId = currentTrack && currentTrack.id;
        const { queue, readAt } = await spotifyQueue(currentId);

        // Spotify's queue when it answered, Queueify's own list when it did not.
        const songs = queue
            ? withRequesters(queue, state.pendingQueue, readAt).slice(0, LIMIT)
            : upcoming(state.pendingQueue, currentId);

        return {
            requester: requesterOf(state, currentId),
            // What the widget plays as this song starts. app.js plays it once.
            perk: state.perks ? perks.forSong(requestPlaying(state, currentId), state.perks) : null,
            upNext: songs.map(forWidget)
        };
    };
}

module.exports = { createUpNext, upcoming, requesterOf, requestPlaying, withRequesters, LIMIT, QUEUE_TTL_MS };
