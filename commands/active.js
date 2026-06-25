const { getCurrentTrack, getUserQueue } = require('../spotify');

module.exports = {
    name: 'active',
    aliases: ['nowqueued'],

    async execute({ client, channel, state }) {
        const spotifyQueue = await getUserQueue();
        const currentTrack = await getCurrentTrack();

        if (spotifyQueue === false || currentTrack === false) {
            client.say(channel, "Couldn't check the current Spotify song. umm");
            return;
        }

        if (!currentTrack) {
            client.say(channel, 'No Spotify track is currently playing.');
            return;
        }

        const queuedTrack = state.updateActiveTrack(currentTrack);
        state.reconcileWithSpotifyQueue(spotifyQueue.queue);

        if (!queuedTrack) {
            client.say(channel, `Current song: ${currentTrack.name} - ${currentTrack.artists}`);
            return;
        }

        client.say(channel, `Current song queued by @${queuedTrack.queuedBy}: ${currentTrack.name} - ${currentTrack.artists}`);
    }
};
