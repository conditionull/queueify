const formatTime = require('../helpers/formatTime');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'repeatdelay',
    aliases: ['repeat', 'songdelay'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        if (!args[0]) {
            sayMessage(client, channel, 'settings.currentRepeatDelay', { delay: formatTime(state.repeatBlockSeconds) });
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
            sayMessage(client, channel, 'settings.invalidRepeatDelay');
            return;
        }

        state.repeatBlockSeconds = seconds;
        state.pruneRecentRequests();
        state.saveSettings();

        sayMessage(client, channel, 'settings.repeatDelayUpdated', { delay: formatTime(state.repeatBlockSeconds) });
    }
};
