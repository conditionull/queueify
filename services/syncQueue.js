const { getCurrentTrack, getUserQueue } = require("../spotify");
const history = require("./history");

// The last track we logged as started, keyed by id *and* the time it started.
// A replay mints a fresh startedAt (see core/state.js's progress-rewind check),
// so this logs somebody hearing the same song twice while never logging the
// same play twice.
let lastPlayKey = null;

/**
 * Record a song starting, once.
 *
 * This lives here rather than in `core/state.js` on purpose: state has no
 * service dependencies and is required standalone by several tests, and adding
 * one to it would drag the whole log into those.
 *
 * Note this is not a poller - syncQueue only runs when somebody makes a
 * request or asks for the queue, so a song played during a quiet stretch can
 * go unseen. Good enough for "what got heard", not good enough to quote a
 * completion rate off.
 */
function notePlay(activeTrack) {
    if (!activeTrack?.id) return;

    const key = `${activeTrack.id}:${activeTrack.startedAt}`;
    if (key === lastPlayKey) return;
    lastPlayKey = key;

    history.recordPlay({
        track: activeTrack,
        queuedBy: activeTrack.queuedBy,
        queuedAt: activeTrack.queuedAt
    });
}

async function syncQueue(state) {
    const spotifyQueue = await getUserQueue();
    const currentTrack = await getCurrentTrack();

    if (spotifyQueue === false || currentTrack === false) {
        return false;
    }

    notePlay(state.updateActiveTrack(currentTrack));
    state.reconcileWithSpotifyQueue(spotifyQueue.queue);

    return true;
}

module.exports = syncQueue;
