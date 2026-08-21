const formatTime = require('../helpers/formatTime');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'duration',
    aliases: ['length', 'maxlength', 'maxduration'],
    modOnly: false, // user can check duration, but only mods can change it

    async execute({ client, channel, username, args, state, isMod }) {
        if (!args[0]) {
            sayMessage(client, channel, 'settings.currentDuration', { duration: formatTime(state.maxSongLength) });
            return;
        }

        if (!isMod) {
            sayMessage(client, channel, 'settings.permissionToChange', { username });
            return;
        }

        const newMaxLength = parseInt(args[0], 10);

        if (
            isNaN(newMaxLength) || newMaxLength <= 0) {
            sayMessage(client, channel, 'settings.invalidDuration', { username });
            return;
        }

        state.maxSongLength = newMaxLength;
        state.saveSettings();

        sayMessage(client, channel, 'settings.durationUpdated', {
            username,
            duration: formatTime(newMaxLength)
        });
    }
};
