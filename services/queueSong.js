const { addToQueue, getTrackId, getTrack } = require("../spotify.js");
const syncQueue = require("./syncQueue.js")
const { sayMessage } = require('./messages');
const refundRedeem = require('./refundRedeem');

const activeQueueRequests = new Set();

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

async function queueSongInternal({
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

    const cooldownKey = String(username).trim().toLowerCase();
    const cooldownMs = state.cooldownSeconds * 1000;
    const lastUsed = state.cooldowns.get(cooldownKey);

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

    if (status === "ok") {
        state.cooldowns.set(cooldownKey, Date.now());
    }

    setTimeout(async () => {
        if (status === "ok") {
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

//function call to avoid a race condition and allow multiple requests at once
async function queueSong(args) {
    const {
        client,
        channel,
        username,
        state,
        isRedeem = false,
        redemptionId = null,
        broadcasterId = state.broadcasterId
    } = args;

    const cooldownKey = String(username).trim().toLowerCase();

    if (activeQueueRequests.has(cooldownKey)) {
        if (isRedeem && redemptionId) {
            await rejectRequest({
                client,
                channel,
                key: "queue.requestPending",
                values: { username },
                isRedeem,
                redemptionId,
                broadcasterId,
                state
            });
        }

        return;
    }

    activeQueueRequests.add(cooldownKey);

    try {
        return await queueSongInternal(args);
    } finally {
        activeQueueRequests.delete(cooldownKey);
    }
}

module.exports = queueSong;