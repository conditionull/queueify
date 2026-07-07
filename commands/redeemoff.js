const setRewardEnabled = require("../services/setRewardEnabled");

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

        client.say(channel, "Spotify redeems are now disabled Aware");
    }
};