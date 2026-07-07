module.exports = {
    name: 'chatoff',
    aliases: ['disablechat'],
    modOnly: true,

    execute({ client, channel, state }) {
        if (!state.chatEnabled) {
            client.say(channel, 'Chat queue is already disabled');
            return;
        }

        state.chatEnabled = false;
        state.saveSettings();

        client.say(channel, 'Chat song requests disabled');
    }
};