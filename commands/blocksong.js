const { getTrackId } = require('../spotify');

module.exports = {
    name: 'blocksong',
    aliases: ['denysong'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const url = args[0];
        const trackId = getTrackId(url);

        if (!trackId) {
            client.say(channel, 'usage: !blocksong <spotify_track_url>');
            return;
        }

        state.blockedSongs.add(trackId);
        state.saveBlacklist();
        client.say(channel, 'song blocked');
    }
};