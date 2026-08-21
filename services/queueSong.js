const { addToQueue, getTrackId, getTrack } = require("../spotify.js");
const syncQueue = require("./syncQueue.js")
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

async function rejectRequest({ client, channel, username, message, isRedeem, redemptionId, broadcasterId, state }) {
    if (isRedeem && redemptionId) {
        const refunded = await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        client.say(channel, refunded ? `${message} (points refunded)` : message);
    } else {
        client.say(channel, message);
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
    const synced = await syncQueue(state);

    if (!synced) {
        client.say(channel, `@${username} couldn't check the Spotify queue. umm`);

        if (isRedeem && redemptionId) {
            await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        }

        return;
    }

    if (!state.queueEnabled) {
        const msg = `@${username} the queue is currently closed Sadge`;

        await rejectRequest({ client, channel, username, message: msg, isRedeem, redemptionId, broadcasterId, state });

        return;
    }

    const lastUsed = state.cooldowns.get(username);
    const cooldownMs = state.cooldownSeconds * 1000;

    if (lastUsed) {
        const remaining = cooldownMs - (Date.now() - lastUsed);

        if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1000);
            const msg = `@${username} wait ${seconds}s before queueing again`;

            await rejectRequest({ client, channel, username, message: msg, isRedeem, redemptionId, broadcasterId, state });

            return;
        }
    }

    const trackId = getTrackId(url);

    if (!trackId) {
        const msg = `@${username} invalid song URL, try: https://open.spotify.com/track/<id>`;
        await rejectRequest({ client, channel, username, message: msg, isRedeem, redemptionId, broadcasterId, state });

        return;
    }

    const track = await getTrack(url);

    if (!track) {
        await rejectRequest({
            client,
            channel,
            username,
            message: `@${username} couldn't find that Spotify song`,
            isRedeem,
            redemptionId,
            broadcasterId,
            state
        });
        return;
    }

    const blockedArtist = track.artists?.find(artist =>
        state.blockedArtists.has(artist.name.trim().toLowerCase())
    );

    if (blockedArtist) {
        await rejectRequest({
            client,
            channel,
            username,
            message: `@${username} the artist ${blockedArtist.name} is blocked`,
            isRedeem,
            redemptionId,
            broadcasterId,
            state
        });
        return;
    }

    if (state.blockedSongs.has(track.id)) {
        await rejectRequest({
            client,
            channel,
            username,
            message: `@${username} that song is blocked`,
            isRedeem,
            redemptionId,
            broadcasterId,
            state
        });
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

    const result = await addToQueue(url, state.maxSongLength, state.allowExplicit, track);
    const status = typeof result === "string" ? result : result.status;

    setTimeout(async () => {
        if (status === "ok") {
            state.cooldowns.set(username, Date.now());
            state.addPendingTrack(result.track, username);
            state.rememberRecentRequest(username, result.track.id);
            client.say(channel, `@${username} song added to queue!! DinoDance (${state.pendingQueue.length} in queue)`);
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
        } else if (status === "explicit") {
            const msg = `@${username} no explicit songs allowed`;

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
            if (result.message) {
                console.error(`Failed to add song for @${username}:`, result.message);
            }

            await rejectRequest({
                client,
                channel,
                username,
                message: `@${username} couldn't add that song to the queue right now.`,
                isRedeem,
                redemptionId,
                broadcasterId,
                state
            });
        }
    }, 1000);
}

module.exports = queueSong;