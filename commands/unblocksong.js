const { getTrackId } = require('../spotify');

module.exports = {
    name: 'unblocksong',
    aliases: ['allowsong'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const trackId = getTrackId(args[0]);

        if (!trackId) {
            client.say(channel, 'usage: !unblocksong <spotify_track_url>');
            return;
        }

        state.blockedSongs.delete(trackId);
        state.saveBlacklist();
        client.say(channel, 'song unblocked');
    }
};