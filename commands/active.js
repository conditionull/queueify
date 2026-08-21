const { getCurrentTrack } = require('../spotify');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'active',
    aliases: ['nowqueued', 'np', 'current', 'playing', 'now', 'song'],

    async execute({ client, channel }) {
        const currentTrack = await getCurrentTrack();

        if (currentTrack === false) {
            sayMessage(client, channel, 'playback.currentLookupFailed');
            return;
        }

        if (!currentTrack) {
            sayMessage(client, channel, 'playback.nothingPlaying');
            return;
        }

        sayMessage(client, channel, 'playback.currentSong', {
            name: currentTrack.name,
            artists: currentTrack.artists
        });
    }
};