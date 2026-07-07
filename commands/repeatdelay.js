const formatTime = require('../helpers/formatTime');

module.exports = {
    name: 'repeatdelay',
    aliases: ['repeat', 'songdelay'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        if (!args[0]) {
            client.say(channel, `Current same-song repeat block is ${formatTime(state.repeatBlockSeconds)}`);
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
            client.say(channel, 'usage: !repeatdelay <seconds> (0-86400)');
            return;
        }

        state.repeatBlockSeconds = seconds;
        state.pruneRecentRequests();
        state.saveSettings();

        client.say(channel, `Same-song queue delay set to ${formatTime(state.repeatBlockSeconds)}`);
    }
};
