module.exports = {
    name: 'qoff',
    aliases: ['queueoff', 'closequeue'],
    modOnly: true,

    execute({ client, channel, username, state }) {
        if (!state.queueEnabled) {
            client.say(channel, 'Queue is already closed');
            return;
        }

        state.queueEnabled = false;
        state.saveQueueState();

        client.say(channel, 'Song queue is now closed! DinoDance');
    }
};
