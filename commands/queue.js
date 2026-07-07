const { addToQueue, getCurrentTrack, getTrackId, getUserQueue } = require('../spotify');
const queueSong = require("../services/queueSong");

function cleanArg(arg) {
    return arg.replace(/[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

function formatQueueItem(item, index) {
    return `${index + 1}. ${item.name} (@${item.queuedBy})`;
}

function sendQueueList(client, channel, queueItems) {
    for (let i = 0; i < queueItems.length; i += 5) {
        client.say(channel, queueItems.slice(i, i + 5).map(formatQueueItem).join(' | '));
    }
}

module.exports = {
    name: 'queue',
    aliases: ['q', 'sr', 'add'],

    async execute({ client, channel, username, args, state, cooldowns }) {
        if (!state.chatEnabled) {
            const status = state.redeemsEnabled
                ? "Chat requests are disabled. Use the channel point redeem instead :)"
                : "Both chat and channel point redeems are disabled Sadge";

            client.say(channel, `@${username} ${status}`);
            return;
        }

        const cleanedArgs = args.map(cleanArg).filter(arg => arg.trim());

        if (cleanedArgs.length === 0) {
            const spotifyQueue = await getUserQueue();
            const currentTrack = await getCurrentTrack();

            if (spotifyQueue === false || currentTrack === false) {
                client.say(channel, "Couldn't check the Spotify queue. umm");
                return;
            }

            state.updateActiveTrack(currentTrack);
            const pendingQueue = state.reconcileWithSpotifyQueue(spotifyQueue.queue);
            const visibleQueue = pendingQueue.slice(0, 10);

            if (visibleQueue.length === 0) {
                client.say(channel, 'No queued songs are currently pending Aware');
                return;
            }

            sendQueueList(client, channel, visibleQueue);
            return;
        }

        const url =
            cleanedArgs.find(a => a.includes("spotify.com/track/")) ??
            cleanedArgs[0];

        await queueSong({
            client,
            channel,
            username,
            url,
            state,
            cooldowns
        });
    }
};
