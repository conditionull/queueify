/**
 * Keeps an eye on what Spotify is playing, all the time, so who asked for the
 * song playing is already known before anybody types !np.
 *
 * Before this, the queue was only looked at when somebody requested a song,
 * ran !queue or !np, or the widget happened to be on screen. A request could
 * start, play and finish in a quiet stretch with nothing noticing, and what
 * Queueify believed afterwards was a guess. Now every song change is seen
 * within a few seconds of happening, whatever chat is doing.
 *
 * Each tick is the cheap read the widget already shares (spotify.js keeps it
 * for two seconds). Only when the song might have changed does it read the
 * queue as well and let core/state.js decide who the new song belongs to -
 * plus after every new request, and whenever half a minute has gone by with
 * nothing else reading it, so the pending list never drifts far from Spotify's.
 */

const TICK_MS = 3000;
const FULL_SYNC_MS = 30000;
// While Spotify cannot be reached (not set up yet, offline) the watcher asks
// less and less often, up to this, instead of every few seconds.
const MAX_BACKOFF_MS = 60000;

function createPlaybackWatcher({ state, getCurrentTrack, syncWithQueue, now = Date.now, tickMs = TICK_MS }) {
    let lastFullSync = -Infinity;
    let lastPendingLength = -1;
    let failures = 0;
    let timer = null;
    let stopped = false;

    async function fullSync() {
        const result = await syncWithQueue(state);
        if (result === false) return false;

        lastFullSync = now();
        lastPendingLength = state.pendingQueue.length;
        return true;
    }

    /** One look. Resolves to whether Spotify answered. */
    async function tick() {
        const current = await getCurrentTrack({ quiet: true });
        if (current === false) return false;

        // Any read of the queue counts - the widget's and !np's too - so with
        // the widget open this hardly ever reads it itself.
        const lastRead = Math.max(lastFullSync, Number.isFinite(state.lastSpotifyQueueAt) ? state.lastSpotifyQueueAt : -Infinity);
        const due = now() - lastRead >= FULL_SYNC_MS || state.pendingQueue.length !== lastPendingLength;
        if (due || !state.notePlayback(current, now())) return fullSync();

        return true;
    }

    function schedule() {
        if (stopped) return;

        const delay = Math.min(tickMs * 2 ** failures, MAX_BACKOFF_MS);
        timer = setTimeout(async () => {
            let answered = false;
            try {
                answered = await tick();
            } catch (err) {
                console.error('Watching Spotify failed:', err.message);
            }
            failures = answered ? 0 : Math.min(failures + 1, 10);
            schedule();
        }, delay);
        timer.unref?.();
    }

    return {
        tick,
        start() {
            stopped = false;
            schedule();
            return this;
        },
        stop() {
            stopped = true;
            clearTimeout(timer);
        }
    };
}

function start(deps) {
    return createPlaybackWatcher(deps).start();
}

module.exports = { createPlaybackWatcher, start, TICK_MS, FULL_SYNC_MS, MAX_BACKOFF_MS };
