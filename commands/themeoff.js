const { syncThemeTakeoverReward } = require('../services/syncThemeTakeoverReward');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'themeoff',
    aliases: ['themerewardoff', 'disabletheme'],
    modOnly: true,

    async execute({ client, channel, state }) {
        if (!state.themeTakeoverRewardId) {
            sayMessage(client, channel, 'settings.themeTakeoverNotConfigured');
            return;
        }

        if (!state.themeTakeoverEnabled) {
            sayMessage(client, channel, 'settings.themeTakeoverAlreadyDisabled');
            return;
        }

        state.themeTakeoverEnabled = false;

        try {
            await syncThemeTakeoverReward({
                broadcasterId: state.broadcasterId,
                rewardId: state.themeTakeoverRewardId,
                enabled: false
            });
        } catch (err) {
            state.themeTakeoverEnabled = true;
            throw err;
        }

        state.saveSettings();
        sayMessage(client, channel, 'settings.themeTakeoverDisabled');
    }
};