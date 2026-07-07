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
        throw new Error(JSON.stringify(data, null, 2));
    }

    return data;
}

module.exports = setRewardEnabled;