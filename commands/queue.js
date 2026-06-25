const { addToQueue, getCurrentTrack, getTrackId, getUserQueue } = require('../spotify');

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

        if (!state.queueEnabled) {
            client.say(channel, `@${username} the queue is currently closed Sadge`);
            return;
        }

        if (state.blacklist.has(username)) {
            client.say(channel, `@${username} you're not allowed to queue songs. wuh`);
            return;
        }

        const lastUsed = cooldowns.get(username);
        const cooldownMs = state.cooldownSeconds * 1000;
        if (lastUsed) {
            const remaining = cooldownMs - (Date.now() - lastUsed);
            if (remaining > 0) {
                const seconds = Math.ceil(remaining / 1000);
                client.say(channel, `@${username} wait ${seconds}s before queuing again Clocking`);
                return;
            }
        }

        const url = cleanedArgs.find(a => a.includes('spotify.com/track/')) ?? cleanedArgs[0];
        const trackId = getTrackId(url);

        if (!trackId) {
            client.say(channel, `@${username} that doesn't look right. Use a Spotify track link, e.g. https://open.spotify.com/track/... Enough`);
            return;
        }

        const recentRequest = state.getRecentRequest(username, trackId);
        if (recentRequest) {
            const requestedAt = Date.parse(recentRequest.requestedAt);
            const remaining = state.repeatBlockSeconds * 1000 - (Date.now() - requestedAt);
            const seconds = Math.max(1, Math.ceil(remaining / 1000));
            client.say(channel, `@${username} you already queued that song recently. Try again in ${seconds}s.`);
            return;
        }

        const result = await addToQueue(url, state.maxSongLength);
        const status = typeof result === 'string' ? result : result.status;

        setTimeout(() => {
            if (status === 'ok') {
                cooldowns.set(username, Date.now());
                state.addPendingTrack(result.track, username);
                state.rememberRecentRequest(username, result.track.id);
                client.say(channel, `@${username} song added to queue!! DinoDance`);
            } else if (status === 'noinput') {
                client.say(channel, `@${username} usage: !q <spotify track url> - e.g. !q https://open.spotify.com/track/... Enough`);
            } else if (status === 'invalid') {
                client.say(channel, `@${username} that doesn't look right. Use a Spotify track link, e.g. https://open.spotify.com/track/... Enough`);
            } else if (status === 'toolong') {
                client.say(
                    channel,
                    `@${username} song is too long, max length is ${state.maxSongLength} seconds. umm`
                );
            } else if (status === 'failed') {
                client.say(channel, `@${username} couldn't add to queue - is Spotify playing? umm`);
            }
        }, 1000);
    }
};
