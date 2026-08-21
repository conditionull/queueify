const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'unblockartist',
    aliases: ['allowartist'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const artist = args.join(' ').trim().toLowerCase();

        if (!artist) {
            sayMessage(client, channel, 'moderation.usageUnblockArtist');
            return;
        }

        const wasBlocked = state.blockedArtists.delete(artist);

        if (!wasBlocked) {
            sayMessage(client, channel, 'moderation.artistNotBlocked', { artist });
            return;
        }

        state.saveBlacklist();
        sayMessage(client, channel, 'moderation.artistUnblocked', { artist });
    }
};