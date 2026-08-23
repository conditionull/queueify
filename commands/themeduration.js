const formatTime = require('../helpers/formatTime');
const { sayMessage } = require('../services/messages');
const { updateThemeTakeoverReward } = require('../services/updateThemeTakeoverReward');

module.exports = {
    name: 'themeduration',
    aliases: ['themetime', 'takeovertime'],
    modOnly: true,

    async execute({ client, channel, args, state }) {
        if (!args[0]) {
            sayMessage(client, channel, 'settings.currentThemeTakeoverDuration', {
                duration: formatTime(state.themeTakeoverDurationSeconds)
            });
            return;
        }

        const seconds = Number(args[0]);
        if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
            sayMessage(client, channel, 'settings.invalidThemeTakeoverDuration');
            return;
        }

        state.themeTakeoverDurationSeconds = seconds;
        state.saveSettings();

        try {
            await updateThemeTakeoverReward(
                state.broadcasterId,
                state.themeTakeoverRewardId,
                seconds
            );
        } catch (err) {
            console.error('Failed to update Theme Takeover reward prompt:', err.message);
        }

        sayMessage(client, channel, 'settings.themeTakeoverDurationUpdated', {
            duration: formatTime(seconds)
        });
    }
};