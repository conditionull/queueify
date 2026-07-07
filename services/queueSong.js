const { addToQueue, getTrackId } = require("../spotify.js");
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;

async function refundRedeem(redemptionId, broadcasterId, rewardId) {
    try {
        const res = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions` +
            `?broadcaster_id=${broadcasterId}&reward_id=${rewardId}&id=${redemptionId}`,
            {
                method: "PATCH",
                headers: {
                    "Client-Id": CLIENT_ID,
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status: "CANCELED" })
            }
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.error("Refund failed:", data);
            return false;
        }

        return true;
    } catch (err) {
        console.error("Refund exception:", err.message);
        return false;
    }
}

async function queueSong({
    client,
    channel,
    username,
    url,
    state,
    isRedeem = false,
    redemptionId = null,
    broadcasterId = state.broadcasterId
}) {
    if (!state.queueEnabled) {
        client.say(channel, `@${username} the queue is currently closed Sadge`);
        return;
    }

    if (state.blacklist.has(username)) {
        client.say(channel, `@${username} you're not allowed to queue songs. wuh`);
        return;
    }

    const lastUsed = state.cooldowns.get(username);
    const cooldownMs = state.cooldownSeconds * 1000;

    if (lastUsed) {
        const remaining = cooldownMs - (Date.now() - lastUsed);

        if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1000);
            const msg = `@${username} wait ${seconds}s before queueing again`;

            if (isRedeem && redemptionId) {
                const refunded = await refundRedeem(
                    redemptionId,
                    broadcasterId,
                    state.spotifyRewardId
                );

                if (refunded) {
                    client.say(channel, `${msg} (points refunded)`);
                } else {
                    client.say(channel, msg);
                }
            } else {
                client.say(channel, msg);
            }

            return;
        }
    }

    const trackId = getTrackId(url);

    if (!trackId) {
        const msg = `@${username} invalid song URL, try: https://open.spotify.com/track/<id>`;
        if (isRedeem && redemptionId) {
            const refunded = await refundRedeem(
                redemptionId,
                broadcasterId,
                state.spotifyRewardId
            );

            client.say(channel, refunded ? `${msg} (points refunded)` : msg);
        } else {
            client.say(channel, msg);
        }

        return;
    }

    const recentRequest = state.getRecentRequest(username, trackId);

    if (recentRequest) {
        const requestedAt = Date.parse(recentRequest.requestedAt);
        const remaining =
            state.repeatBlockSeconds * 1000 - (Date.now() - requestedAt);

        const seconds = Math.max(1, Math.ceil(remaining / 1000));

        if (isRedeem && redemptionId) {
            const refunded = await refundRedeem(
                redemptionId,
                broadcasterId,
                state.spotifyRewardId
            );

            client.say(
                channel,
                refunded
                    ? `@${username} you queued that song recently. Try again in ${seconds}s (points refunded)`
                    : `@${username} you queued that song recently. Try again in ${seconds}s`
            );
        } else {
            client.say(
                channel,
                `@${username} you queued that song recently. Try again in ${seconds}s`
            );
        }

        return;
    }

    const result = await addToQueue(url, state.maxSongLength);
    const status = typeof result === "string" ? result : result.status;

    setTimeout(async () => {
        if (status === "ok") {
            state.cooldowns.set(username, Date.now());
            state.addPendingTrack(result.track, username);
            state.rememberRecentRequest(username, result.track.id);
            client.say(channel, `@${username} song added to queue!! DinoDance`);
        } else if (status === "toolong") {
            const msg = `@${username} song is too long, max ${state.maxSongLength}s`;

            if (isRedeem && redemptionId) {
                const refunded = await refundRedeem(
                    redemptionId,
                    broadcasterId,
                    state.spotifyRewardId
                );

                client.say(channel, refunded ? `${msg} (points refunded)` : msg);
            } else {
                client.say(channel, msg);
            }
        } else if (status === "failed") {
            client.say(channel, `@${username} couldn't add to queue - is Spotify playing?`);
        }
    }, 1000);
}

module.exports = queueSong;