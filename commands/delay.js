module.exports = {
    name: 'delay',
    aliases: ['cooldown'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        if (!args[0]) {
            client.say(channel, `Current queue delay is ${state.cooldownSeconds}s`);
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
            client.say(channel, 'usage: !delay <seconds> (0-3600)');
            return;
        }

        state.cooldownSeconds = seconds;
        state.saveSettings();
        client.say(channel, `Queue delay set to ${seconds}s`);
    }
};
