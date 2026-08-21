const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'explicit',
    aliases: ['explicit'],
    modOnly: true,

    execute({ client, channel, state, args }) {
        const action = (args[0] || '').toLowerCase();

        if (action === 'on') {
            if (state.allowExplicit) {
                sayMessage(client, channel, 'settings.explicitAlreadyAllowed');
                return;
            }

            state.allowExplicit = true;
            state.saveSettings();
            sayMessage(client, channel, 'settings.explicitAllowed');
            return;
        }

        if (action === 'off') {
            if (!state.allowExplicit) {
                sayMessage(client, channel, 'settings.explicitAlreadyBlocked');
                return;
            }

            state.allowExplicit = false;
            state.saveSettings();
            sayMessage(client, channel, 'settings.explicitBlocked');
            return;
        }

        sayMessage(client, channel, 'settings.explicitUsage');
    }
};
