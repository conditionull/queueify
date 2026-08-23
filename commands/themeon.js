const { syncThemeTakeoverReward } = require('../services/syncThemeTakeoverReward');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'themeon',
    aliases: ['themerewardon', 'enabletheme'],
    modOnly: true,

    async execute({ client, channel, state }) {
        if (!state.themeTakeoverRewardId) {
            sayMessage(client, channel, 'settings.themeTakeoverNotConfigured');
            return;
        }

        if (state.themeTakeoverEnabled) {
            sayMessage(client, channel, 'settings.themeTakeoverAlreadyEnabled');
            return;
        }

        state.themeTakeoverEnabled = true;

        try {
            const enabled = await syncThemeTakeoverReward({
                broadcasterId: state.broadcasterId,
                rewardId: state.themeTakeoverRewardId,
                enabled: true
            });

            state.saveSettings();
            sayMessage(client, channel, enabled
                ? 'settings.themeTakeoverEnabled'
                : 'settings.themeTakeoverEnabledMinimal');
        } catch (err) {
            state.themeTakeoverEnabled = false;
            throw err;
        }
    }
};