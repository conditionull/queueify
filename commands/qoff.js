const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'qoff',
    aliases: ['queueoff', 'closequeue'],
    modOnly: true,

    execute({ client, channel, username, state }) {
        if (!state.queueEnabled) {
            sayMessage(client, channel, 'settings.queueAlreadyClosed');
            return;
        }

        state.queueEnabled = false;
        state.saveQueueState();

        sayMessage(client, channel, 'settings.queueClosed');
    }
};
