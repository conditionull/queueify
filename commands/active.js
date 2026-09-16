const { getCurrentTrack } = require('../spotify');
const { sayMessage } = require('../services/messages');
const syncQueue = require('../services/syncQueue');

/**
 * Who asked for the song that is playing, if anyone did.
 *
 * Spotify has no idea who queued anything - its queue is just tracks - so the
 * attribution is Queueify's own bookkeeping in `state.pendingQueue`, carried
 * onto `state.activeTrack` when the song starts.
 *
 * Two things have to be true before it is safe to say a name, and both have
 * bitten this before:
 *
 * 1. `state.activeTrack` is only refreshed by syncQueue, which is not a poller
 *    - it runs when somebody requests a song or asks for the queue. Reading it
 *    without syncing first reports whoever was playing last time that happened,
 *    which can be an hour ago.
 * 2. Even then it only means anything if it is the *same* track: the streamer
 *    can put a song on themselves, and a song Queueify queued earlier can come
 *    round again from a playlist.
 *
 * Getting either wrong credits the wrong viewer, which is worse than saying
 * nothing, so this says nothing unless both hold.
 */
function requesterOf(state, currentTrack) {
    const active = state?.activeTrack;
    if (!active || active.id !== currentTrack.id) return null;

    return active.queuedBy || null;
}

module.exports = {
    name: 'active',
    aliases: ['nowqueued', 'np', 'current', 'playing', 'now', 'song'],

    async execute({ client, channel, state }) {
        // How often this may be run is handled centrally before it gets here -
        // see services/commandCooldowns.js.

        // Brings activeTrack up to date, the same way !queue does before it
        // reads the pending list. A failure here is not fatal: the song can
        // still be named, just without crediting anyone.
        const synced = state ? await syncQueue(state) : false;

        const currentTrack = await getCurrentTrack();

        if (currentTrack === false) {
            sayMessage(client, channel, 'playback.currentLookupFailed');
            return;
        }

        if (!currentTrack) {
            sayMessage(client, channel, 'playback.nothingPlaying');
            return;
        }

        const queuedBy = synced ? requesterOf(state, currentTrack) : null;

        sayMessage(client, channel, queuedBy ? 'playback.currentSongQueuedBy' : 'playback.currentSong', {
            name: currentTrack.name,
            artists: currentTrack.artists,
            queuedBy
        });
    }
};