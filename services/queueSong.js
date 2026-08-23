const { addToQueue, getTrackId, getTrack } = require("../spotify.js");
const syncQueue = require("./syncQueue.js")
const { sayMessage } = require('./messages');
const refundRedeem = require('./refundRedeem');

async function rejectRequest({ client, channel, key, values = {}, isRedeem, redemptionId, broadcasterId, state }) {
    if (isRedeem && redemptionId) {
        const refunded = await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        sayMessage(client, channel, key, {
            ...values,
            refundSuffix: refunded ? ' (points refunded)' : ''
        });
        return;
    }

    sayMessage(client, channel, key, values);
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
        sayMessage(client, channel, 'queue.spotifyQueueCheckFailed', { username });

        if (isRedeem && redemptionId) {
            await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        }

        return;
    }

    if (!state.queueEnabled) {
        await rejectRequest({
            client, channel, key: 'queue.closed', values: { username },
            isRedeem, redemptionId, broadcasterId, state
        });

        return;
    }

    const lastUsed = state.cooldowns.get(username);
    const cooldownMs = state.cooldownSeconds * 1000;

    if (lastUsed) {
        const remaining = cooldownMs - (Date.now() - lastUsed);

        if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1000);
            await rejectRequest({
                client, channel, key: 'queue.cooldown', values: { username, seconds },
                isRedeem, redemptionId, broadcasterId, state
            });

            return;
        }
    }

    const trackId = getTrackId(url);

    if (!trackId) {
        await rejectRequest({
            client, channel, key: 'queue.invalidUrl', values: { username },
            isRedeem, redemptionId, broadcasterId, state
        });

        return;
    }

    const track = await getTrack(url);

    if (!track) {
        await rejectRequest({
            client,
            channel,
            username,
            key: 'queue.notFound',
            values: { username },
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
            key: 'queue.blockedArtist',
            values: { username, artist: blockedArtist.name },
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
            key: 'queue.blockedSong',
            values: { username },
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

            sayMessage(client, channel, 'queue.recent', {
                username,
                seconds,
                refundSuffix: refunded ? ' (points refunded)' : ''
            });
        } else {
            sayMessage(client, channel, 'queue.recent', { username, seconds, refundSuffix: '' });
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
            sayMessage(client, channel, 'queue.added', {
                username,
                count: state.pendingQueue.length
            });
        } else if (status === "toolong") {
            await rejectRequest({
                client, channel, key: 'queue.tooLong',
                values: { username, maxSeconds: state.maxSongLength },
                isRedeem, redemptionId, broadcasterId, state
            });
        } else if (status === "explicit") {
            await rejectRequest({
                client, channel, key: 'queue.explicit', values: { username },
                isRedeem, redemptionId, broadcasterId, state
            });
        } else if (status === "failed") {
            if (result.message) {
                console.error(`Failed to add song for @${username}:`, result.message);
            }

            await rejectRequest({
                client,
                channel,
                key: 'queue.addFailed',
                values: { username },
                isRedeem,
                redemptionId,
                broadcasterId,
                state
            });
        }
    }, 1000);
}

module.exports = queueSong;