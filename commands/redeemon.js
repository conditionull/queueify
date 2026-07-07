const setRewardEnabled = require("../services/setRewardEnabled");

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

        client.say(channel, "Spotify redeems are now enabled YIPPIE");
    }
};