const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'chatoff',
    aliases: ['disablechat'],
    modOnly: true,

    execute({ client, channel, state }) {
        if (!state.chatEnabled) {
            sayMessage(client, channel, 'settings.chatAlreadyDisabled');
            return;
        }

        state.chatEnabled = false;
        state.saveSettings();

        sayMessage(client, channel, 'settings.chatDisabled');
    }
};