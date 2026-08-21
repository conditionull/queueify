const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'qon',
    aliases: ['queueon', 'openqueue'],
    modOnly: true,

    execute({ client, channel, username, state }) {
        if (state.queueEnabled) {
            sayMessage(client, channel, 'settings.queueAlreadyOpen');
            return;
        }

        state.queueEnabled = true;
        state.saveQueueState();

        sayMessage(client, channel, 'settings.queueOpened');
    }
};
