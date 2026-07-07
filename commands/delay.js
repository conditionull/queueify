const formatTime = require('../helpers/formatTime');

module.exports = {
    name: 'delay',
    aliases: ['cooldown'],
    modOnly: false,

    execute({ client, channel, args, state, username, isMod }) {
        if (!args[0]) {
            client.say(channel, `You can queue a song every ${formatTime(state.cooldownSeconds)}`);
            return;
        }

        if (!isMod) {
            client.say(
                channel,
                `@${username} you don't have permission to change this value`
            );
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
            client.say(channel, 'usage: !delay <seconds> (0-3600)');
            return;
        }

        state.cooldownSeconds = seconds;
        state.saveSettings();

        client.say(channel, `Queue delay set to ${formatTime(state.cooldownSeconds)}`);
    }
};
