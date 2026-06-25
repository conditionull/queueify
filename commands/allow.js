module.exports = {
    name: 'allow',
    aliases: ['unban', 'undeny', 'whitelist', 'unblock'],
    modOnly: true,

    execute({ client, channel, username, args, state }) {
        const target = args[0]?.toLowerCase();

        if (!target) {
            client.say(channel, 'usage: !allow <username>');
            return;
        }

        state.blacklist.delete(target);
        state.saveBlacklist();

        client.say(channel, `@${target} can queue songs again smileCat`);
    }
};
