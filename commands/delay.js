const formatTime = require('../helpers/formatTime');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'delay',
    aliases: ['cooldown'],
    modOnly: false,

    execute({ client, channel, args, state, username, isMod }) {
        if (!args[0]) {
            sayMessage(client, channel, 'settings.currentDelay', { delay: formatTime(state.cooldownSeconds) });
            return;
        }

        if (!isMod) {
            sayMessage(client, channel, 'settings.permissionToChange', { username });
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
            sayMessage(client, channel, 'settings.invalidDelay');
            return;
        }

        state.cooldownSeconds = seconds;
        state.saveSettings();

        sayMessage(client, channel, 'settings.delayUpdated', { delay: formatTime(state.cooldownSeconds) });
    }
};
