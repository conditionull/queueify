const queueSong = require("../services/queueSong");
const syncQueue = require("../services/syncQueue");
const { sayMessage, message } = require('../services/messages');

function cleanArg(arg) {
    return arg.replace(/[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

function formatQueueItem(item, index) {
    return message('queue.item', {
        position: index + 1,
        name: item.name,
        queuedBy: item.queuedBy
    });
}

function sendQueueList(client, channel, queueItems) {
    for (let i = 0; i < queueItems.length; i += 5) {
        sayMessage(client, channel, 'queue.itemList', {
            items: queueItems.slice(i, i + 5).map((item, index) => formatQueueItem(item, i + index)).join(' | ')
        });
    }
}

module.exports = {
    name: 'queue',
    aliases: ['q', 'sr', 'add'],

    async execute({ client, channel, username, args, state, cooldowns }) {
        const cleanedArgs = args.map(cleanArg).filter(arg => arg.trim());

        if (cleanedArgs.length > 0 && !state.chatEnabled) {
            sayMessage(client, channel, state.redeemsEnabled
                ? 'queue.chatDisabledRedeemEnabled'
                : 'queue.chatAndRedeemDisabled', { username });
            return;
        }

        if (cleanedArgs.length === 0) {
            const synced = await syncQueue(state);

            if (!synced) {
                sayMessage(client, channel, 'queue.spotifyQueueCheckFailed');
                return;
            }

            const visibleQueue = state.pendingQueue.slice(0, 10);

            if (visibleQueue.length === 0) {
                sayMessage(client, channel, 'queue.empty');
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
