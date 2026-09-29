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

const LIMIT = 5;
const QUEUE_TTL_MS = 10000;

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
    const at = currentId ? list.findIndex(item => item && item.id === currentId) : -1;

    return list.slice(at + 1, at + 1 + limit);
}

/**
 * Who asked for the song playing, or null.
 *
 * The same caution as !np (commands/active.js): a name is only given when the
 * song playing is the one Queueify queued for that person. Either it has
 * already been carried onto activeTrack, or it is the very next request -
 * the head of the list - and has just begun.
 */
function requesterOf(state, currentId) {
    const item = requestPlaying(state, currentId);
    return item ? item.queuedBy || null : null;
}

/** The queued request that is the song playing, by the same rule, or null. */
function requestPlaying(state, currentId) {
    if (!currentId) return null;
    if (state.activeTrack && state.activeTrack.id === currentId) return state.activeTrack;

    const head = state.pendingQueue && state.pendingQueue[0];
    return head && head.id === currentId ? head : null;
}

/**
 * Spotify's queue, each song carrying who requested it, if chat did.
 *
 * Matched by track in order: the same song queued twice by two people is two
 * entries in both lists, and the first one in Spotify's queue is the first
 * one requested. A song nobody requested gets no name.
 */
function withRequesters(queue, pendingQueue) {
    const waiting = new Map();
    for (const item of Array.isArray(pendingQueue) ? pendingQueue : []) {
        if (!item || !item.id) continue;
        if (!waiting.has(item.id)) waiting.set(item.id, []);
        waiting.get(item.id).push(item.queuedBy || null);
    }

    return (Array.isArray(queue) ? queue : []).filter(Boolean).map(item => {
        const names = waiting.get(item.id);
        return { ...item, queuedBy: names && names.length ? names.shift() : null };
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
    let cache = { key: null, at: 0, queue: null };
    let asking = null;

    // What the queue depends on. Either changing means the saved answer is
    // out of date, however new it is.
    const keyFor = currentId => `${currentId}|${state.pendingQueue.length}`;

    function spotifyQueue(currentId) {
        if (cache.queue && cache.key === keyFor(currentId) && now() - cache.at < QUEUE_TTL_MS) {
            return Promise.resolve(cache.queue);
        }

        if (!asking) {
            asking = Promise.resolve()
                .then(() => syncWithQueue(state))
                .then(result => {
                    // Keyed after the sync, which can move a request off the
                    // list - otherwise that alone would ask again straight away.
                    cache = { key: keyFor(currentId), at: now(), queue: result ? result.queue || [] : null };
                    return cache.queue;
                })
                .catch(() => null)
                .finally(() => { asking = null; });
        }

        return asking;
    }

    return async function read(currentTrack) {
        const currentId = currentTrack && currentTrack.id;
        const queue = await spotifyQueue(currentId);

        // Spotify's queue when it answered, Queueify's own list when it did not.
        const songs = queue
            ? withRequesters(queue, state.pendingQueue).slice(0, LIMIT)
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
