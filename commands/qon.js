module.exports = {
    name: 'qon',
    aliases: ['queueon', 'openqueue'],
    modOnly: true,

    execute({ client, channel, username, state }) {
        if (state.queueEnabled) {
            client.say(channel, 'Queue is already open');
            return;
        }

        state.queueEnabled = true;
        state.saveQueueState();

        client.say(channel, 'Song queue is now open! DinoDance');
    }
};
