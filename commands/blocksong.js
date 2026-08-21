const { getTrackId } = require('../spotify');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'blocksong',
    aliases: ['denysong'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const url = args[0];
        const trackId = getTrackId(url);

        if (!trackId) {
            sayMessage(client, channel, 'moderation.usageBlockSong');
            return;
        }

        state.blockedSongs.add(trackId);
        state.saveBlacklist();
        sayMessage(client, channel, 'moderation.blockedSong');
    }
};