const setRewardEnabled = require("../services/setRewardEnabled");
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'redeemoff',
    aliases: ["rewardoff", "redeemsoff", "disableredeems", "rewardsoff", "disablerewards"],
    modOnly: true,

    async execute({ client, channel, state }) {
        await setRewardEnabled(
            state.broadcasterId,
            state.spotifyRewardId,
            false
        );

        state.redeemsEnabled = false;
        state.saveSettings();

        sayMessage(client, channel, 'settings.redeemsDisabled');
    }
};