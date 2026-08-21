const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'deny',
    aliases: ['block', 'blacklist'],
    modOnly: true,

    execute({ client, channel, username, args, state }) {
        const target = args[0]?.toLowerCase();

        if (!target) {
            sayMessage(client, channel, 'moderation.usageDeny');
            return;
        }

        state.blacklist.add(target);
        state.saveBlacklist();

        sayMessage(client, channel, 'moderation.denied', { username: target });
    }
};
