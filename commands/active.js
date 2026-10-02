const { getCurrentTrack } = require('../spotify');
const { sayMessage } = require('../services/messages');
const { syncWithQueue } = require('../services/syncQueue');
const { sameTrack } = require('../core/sameTrack');

/**
 * Who asked for the song that is playing, if anyone did.
 *
 * Spotify has no idea who queued anything - its queue is just tracks - so the
 * attribution is Queueify's own bookkeeping, worked out in core/state.js's
 * updateActiveTrack. This only reads the answer, and only when it is about the
 * song actually being named: the same read, the same track.
 *
 * Getting it wrong credits the wrong viewer, which is worse than saying
 * nothing, so this says nothing unless both hold.
 */
function requesterOf(state, currentTrack) {
    const active = state?.activeTrack;
    if (!active || !sameTrack(active, currentTrack)) return null;

    return active.queuedBy || null;
}

module.exports = {
    name: 'active',
    aliases: ['nowqueued', 'np', 'current', 'playing', 'now', 'song'],

    async execute({ client, channel, state }) {
        // How often this may be run is handled centrally before it gets here -
        // see services/commandCooldowns.js.

        // Brings activeTrack up to date and hands back the song playing from
        // the same read, so the song named and the name given always belong
        // together. A failure here is not fatal: the song can still be named,
        // just without crediting anyone.
        const synced = state ? await syncWithQueue(state) : false;

        const currentTrack = synced ? synced.currentTrack : await getCurrentTrack();

        if (currentTrack === false) {
            sayMessage(client, channel, 'playback.currentLookupFailed');
            return;
        }

        if (!currentTrack?.id) {
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
