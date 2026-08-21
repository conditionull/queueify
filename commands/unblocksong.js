const { getTrackId } = require('../spotify');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'unblocksong',
    aliases: ['allowsong'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const trackId = getTrackId(args[0]);

        if (!trackId) {
            sayMessage(client, channel, 'moderation.usageUnblockSong');
            return;
        }

        state.blockedSongs.delete(trackId);
        state.saveBlacklist();
        sayMessage(client, channel, 'moderation.songUnblocked');
    }
};