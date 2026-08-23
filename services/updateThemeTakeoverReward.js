function buildThemeTakeoverPrompt(durationSeconds) {
    const duration = durationSeconds % 60 === 0
        ? `${durationSeconds / 60} minute${durationSeconds === 60 ? '' : 's'}`
        : `${durationSeconds} seconds`;

    return `Choose a widget theme: default, minimal, or swag. Your change will last ${duration} unless this reward is redeemed again.`;
}

async function updateThemeTakeoverReward(broadcasterId, rewardId, durationSeconds) {
    if (!broadcasterId || !rewardId) {
        return false;
    }

    const res = await fetch(
        `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
        {
            method: 'PATCH',
            headers: {
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: buildThemeTakeoverPrompt(durationSeconds)
            })
        }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.message || `Theme takeover reward update failed with status ${res.status}`);
    }

    return true;
}

module.exports = {
    buildThemeTakeoverPrompt,
    updateThemeTakeoverReward
};