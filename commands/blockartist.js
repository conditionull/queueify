const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'blockartist',
    aliases: ['denyartist'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const artist = args.join(' ').trim().toLowerCase();

        if (!artist) {
            sayMessage(client, channel, 'moderation.usageBlockArtist');
            return;
        }

        state.blockedArtists.add(artist);
        state.saveBlacklist();
        sayMessage(client, channel, 'moderation.blockedArtist', { artist });
    }
};