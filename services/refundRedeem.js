const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;

async function refundRedeem(redemptionId, broadcasterId, rewardId) {
    try {
        const res = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions` +
            `?broadcaster_id=${broadcasterId}&reward_id=${rewardId}&id=${redemptionId}`,
            {
                method: 'PATCH',
                headers: {
                    'Client-Id': CLIENT_ID,
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'CANCELED' })
            }
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.error('Refund failed:', data);
            return false;
        }

        return true;
    } catch (err) {
        console.error('Refund exception:', err.message);
        return false;
    }
}

module.exports = refundRedeem;