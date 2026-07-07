async function setRewardEnabled(broadcasterId, rewardId, enabled) {
    const res = await fetch(
        `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
        {
            method: "PATCH",
            headers: {
                "Client-Id": process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                is_enabled: enabled
            })
        }
    );

    const data = await res.json();

    if (!res.ok) {
        if (
            res.status === 403 &&
            data?.message?.includes("Client-Id header must match the client ID used to create the custom reward")
        ) {
            throw new Error(
                `Unable to ${enabled ? "enable" : "disable"} the Spotify reward.

                This usually means the reward was not created by this bot.

                To fix this:
                - Delete the existing reward from your Twitch Creator Dashboard.
                - Do NOT recreate it manually through Twitch's dashboard.
                - Create the reward by running the following command in your terminal:

                    node reward.js

                - After the reward has been created, you can safely change its title, cost, and other settings from Twitch's Creator Dashboard.

                The reward must be created by this project so it can be managed by the bot.`
            );
        }

        throw new Error(JSON.stringify(data, null, 2));
    }

    return data;
}

module.exports = setRewardEnabled;