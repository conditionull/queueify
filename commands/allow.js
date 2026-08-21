const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'allow',
    aliases: ['undeny', 'whitelist', 'unblock'],
    modOnly: true,

    execute({ client, channel, username, args, state }) {
        const target = args[0]?.toLowerCase();

        if (!target) {
            sayMessage(client, channel, 'moderation.usageAllow');
            return;
        }

        state.blacklist.delete(target);
        state.saveBlacklist();

        sayMessage(client, channel, 'moderation.allowed', { username: target });
    }
};
