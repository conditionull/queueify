const formatTime = require('../helpers/formatTime');

module.exports = {
    name: 'duration',
    aliases: ['length', 'maxlength', 'maxduration'],
    modOnly: false, // user can check duration, but only mods can change it

    async execute({ client, channel, username, args, state, isMod }) {
        if (!args[0]) {
            client.say(
                channel,
                `Current max song length: ${formatTime(state.maxSongLength)}`
            );
            return;
        }

        if (!isMod) {
            client.say(
                channel,
                `@${username} you don't have permission to change this value`
            );
            return;
        }

        const newMaxLength = parseInt(args[0], 10);

        if (
            isNaN(newMaxLength) || newMaxLength <= 0) {
            client.say(
                channel,
                `@${username} please provide a valid duration in seconds (must be > 0)`
            );
            return;
        }

        state.maxSongLength = newMaxLength;
        state.saveSettings();

        client.say(
            channel,
            `@${username} the maximum song length has been set to ${formatTime(newMaxLength)}`
        );
    }
};
