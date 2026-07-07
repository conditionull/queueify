const { getCurrentTrack } = require('../spotify');

module.exports = {
    name: 'active',
    aliases: ['nowqueued', 'np', 'current', 'playing', 'now', 'song'],

    async execute({ client, channel }) {
        const currentTrack = await getCurrentTrack();

        if (currentTrack === false) {
            client.say(channel, "Couldn't check the current Spotify song. Is Spotify running?");
            return;
        }

        if (!currentTrack) {
            client.say(channel, 'No Spotify track is currently playing.');
            return;
        }

        client.say(channel, `Current song: ${currentTrack.name} - ${currentTrack.artists}`);
    }
};