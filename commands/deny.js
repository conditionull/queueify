module.exports = {
    name: 'deny',
    aliases: ['ban', 'block', 'blacklist'],
    modOnly: true,

    execute({ client, channel, username, args, state }) {
        const target = args[0]?.toLowerCase();

        if (!target) {
            client.say(channel, 'usage: !deny <username>');
            return;
        }

        state.blacklist.add(target);
        state.saveBlacklist();

        client.say(channel, `@${target} can no longer queue songs D: wuh`);
    }
};
