const setRewardEnabled = require("../services/setRewardEnabled");
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'redeemon',
    aliases: ["rewardon", "redeemson", "enableredeems", "rewardson", "enablerewards"],
    modOnly: true,

    async execute({ client, channel, state }) {
        await setRewardEnabled(
            state.broadcasterId,
            state.spotifyRewardId,
            true
        );

        state.redeemsEnabled = true;
        state.saveSettings();

        sayMessage(client, channel, 'settings.redeemsEnabled');
    }
};