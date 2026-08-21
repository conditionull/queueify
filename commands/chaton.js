const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'chaton',
    aliases: ['enablechat'],
    modOnly: true,

    execute({ client, channel, state }) {
        if (state.chatEnabled) {
            sayMessage(client, channel, 'settings.chatAlreadyEnabled');
            return;
        }

        state.chatEnabled = true;
        state.saveSettings();

        sayMessage(client, channel, 'settings.chatEnabled');
    }
};