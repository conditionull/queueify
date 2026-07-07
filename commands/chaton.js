module.exports = {
    name: 'chaton',
    aliases: ['enablechat'],
    modOnly: true,

    execute({ client, channel, state }) {
        if (state.chatEnabled) {
            client.say(channel, 'Chat queue is already enabled');
            return;
        }

        state.chatEnabled = true;
        state.saveSettings();

        client.say(channel, 'Chat song requests enabled');
    }
};