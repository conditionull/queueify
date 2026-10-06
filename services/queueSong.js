const { addToQueue, getTrackId, getTrack } = require("../spotify.js");
const { syncWithQueue, placeRequest, takeTurn } = require("./syncQueue.js")
const { sayMessage } = require('./messages');
const refundRedeem = require('./refundRedeem');
const history = require('./history');
const perks = require('./perks');
const { sameTrack } = require('../core/sameTrack');

const activeQueueRequests = new Set();

async function rejectRequest({ client, channel, key, values = {}, isRedeem, redemptionId, broadcasterId, state }) {
    if (isRedeem && redemptionId) {
        const refunded = await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        sayMessage(client, channel, key, {
            ...values,
            refundSuffix: refunded ? ' (points refunded)' : ''
        });
        return refunded;
    }

    sayMessage(client, channel, key, values);
    return undefined;
}

async function queueSongInternal({
    client,
    channel,
    username,
    url,
    state,
    isRedeem = false,
    redemptionId = null,
    broadcasterId = state.broadcasterId,
    requester
}) {
    // Every branch below ends in one of these. Outcome names match the message
    // keys so the two stay greppable together, and nothing here is awaited -
    // a log that cannot be written must not hold up a song.
    const log = (outcome, extra = {}) => history.recordRequest({
        outcome,
        source: isRedeem ? 'redeem' : 'chat',
        requester,
        username,
        ...extra
    });

    // Kept: where Spotify puts the new song is worked out against this.
    const synced = await syncWithQueue(state);

    if (!synced) {
        sayMessage(client, channel, 'queue.spotifyQueueCheckFailed', { username });

        let refunded;
        if (isRedeem && redemptionId) {
            refunded = await refundRedeem(redemptionId, broadcasterId, state.spotifyRewardId);
        }

        log('syncFailed', { input: url, refunded });
        return;
    }

    if (!state.queueEnabled) {
        const refunded = await rejectRequest({
            client, channel, key: 'queue.closed', values: { username },
            isRedeem, redemptionId, broadcasterId, state
        });

        log('queueClosed', { input: url, refunded });
        return;
    }

    const requesterKey = String(username).trim().toLowerCase();
        if (state.blacklist.has(requesterKey)) {
            const refunded = await rejectRequest({
                client, channel, key: 'queue.blockedUser', values: { username },
                isRedeem, redemptionId, broadcasterId, state
        });
    log('blockedUser', { input: url, refunded });
    return;
    }

    const cooldownKey = requesterKey;
    const cooldownMs = state.cooldownSeconds * 1000;
    const lastUsed = state.cooldowns.get(cooldownKey);

    if (lastUsed) {
        const remaining = cooldownMs - (Date.now() - lastUsed);

        if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1000);
            const refunded = await rejectRequest({
                client, channel, key: 'queue.cooldown', values: { username, seconds },
                isRedeem, redemptionId, broadcasterId, state
            });

            log('cooldown', { input: url, refunded });
            return;
        }
    }

    const trackId = getTrackId(url);

    if (!trackId) {
        const refunded = await rejectRequest({
            client, channel, key: 'queue.invalidUrl', values: { username },
            isRedeem, redemptionId, broadcasterId, state
        });

        // The track is genuinely unknown here, so what they pasted is the only
        // record of what went wrong.
        log('invalidUrl', { input: url, refunded });
        return;
    }

    const track = await getTrack(url);

    if (!track) {
        const refunded = await rejectRequest({
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

        log('notFound', { input: url, refunded });
        return;
    }

    const blockedArtist = track.artists?.find(artist =>
        state.blockedArtists.has(artist.name.trim().toLowerCase())
    );

    if (blockedArtist) {
        const refunded = await rejectRequest({
            client,
            channel,
            key: 'queue.blockedArtist',
            values: { username, artist: blockedArtist.name },
            isRedeem,
            redemptionId,
            broadcasterId,
            state
        });

        // Which artist, specifically: a track can have several and only one of
        // them is the reason this was turned away.
        log('blockedArtist', { track, refunded, blockedArtistName: blockedArtist.name });
        return;
    }


    // The link's own id as well as the one Spotify will play: a link from
    // another country is relinked to a local copy with a different id, and a
    // song blocked by either is still that song.
    if (state.blockedSongs.has(trackId) || state.blockedSongs.has(track.id)) {
        const refunded = await rejectRequest({
            client,
            channel,
            key: 'queue.blockedSong',
            values: { username },
            isRedeem,
            redemptionId,
            broadcasterId,
            state
        });

        log('blockedSong', { track, refunded });
        return;
    }

    const recentRequest = state.getRecentRequest(username, trackId);

    if (recentRequest) {
        const requestedAt = Date.parse(recentRequest.requestedAt);
        const remaining =
            state.repeatBlockSeconds * 1000 - (Date.now() - requestedAt);

        const seconds = Math.max(1, Math.ceil(remaining / 1000));
        let refunded;

        if (isRedeem && redemptionId) {
            refunded = await refundRedeem(
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

        log('recentlyRequested', { track, refunded });
        return;
    }

    // One request goes into Spotify at a time, and from the moment it may be
    // in Spotify's queue until it is in the pending list, nothing reads the
    // queue - see takeTurn. `before` is the queue just before it goes in.
    const { placed, before } = await takeTurn(state);
    const queueBefore = before ? before.queue : synced.queue;

    // Checked here, inside the turn, against the queue as it is right before
    // the song would go in: two viewers asking for the same song at once must
    // not both get through. A second copy of a song in the queue is what makes
    // it impossible to tell later whose copy is playing, so by default it is
    // never let in - nobody's name is then ever in doubt over it.
    const asked = { id: track.id, ids: [trackId, track.id, track.linked_from?.id].filter(Boolean) };
    if (state.blockQueuedSongs !== false && (queueBefore || []).some(item => sameTrack(item, asked))) {
        placed();
        const refunded = await rejectRequest({
            client, channel, key: 'queue.alreadyQueued', values: { username, refundSuffix: '' },
            isRedeem, redemptionId, broadcasterId, state
        });

        log('alreadyQueued', { track, refunded });
        return;
    }

    let result;
    try {
        result = await addToQueue(url, state.maxSongLength, state.allowExplicit, track);
    } catch (err) {
        placed();
        throw err;
    }
    const status = typeof result === "string" ? result : result.status;

    if (status === "ok") {
        state.cooldowns.set(cooldownKey, Date.now());
    } else {
        placed();
    }

    setTimeout(async () => {
        if (status === "ok") {
            try {
                const where = await placeRequest(state, queueBefore, result.track).catch(() => ({ copiesAhead: null }));

                // Counted before it is logged, so the count and the log agree.
                state.addPendingTrack(result.track, username, { ...perks.accept(requester, username), ...where });
            } finally {
                placed();
            }
            // The link's id, which is what getRecentRequest is asked with above.
            state.rememberRecentRequest(username, trackId);
            sayMessage(client, channel, 'queue.added', {
                username,
                count: state.pendingQueue.length
            });

            // Logged here rather than next to addToQueue above, so a request
            // Spotify ends up refusing is never recorded as a success. The
            // queue depth is only true at this moment and cannot be worked out
            // from the log afterwards, so it is stored rather than derived.
            log('ok', { track, queuePosition: state.pendingQueue.length });
        } else if (status === "toolong") {
            const refunded = await rejectRequest({
                client, channel, key: 'queue.tooLong',
                values: { username, maxSeconds: state.maxSongLength },
                isRedeem, redemptionId, broadcasterId, state
            });

            log('tooLong', { track, refunded });
        } else if (status === "explicit") {
            const refunded = await rejectRequest({
                client, channel, key: 'queue.explicit', values: { username },
                isRedeem, redemptionId, broadcasterId, state
            });

            log('explicit', { track, refunded });
        } else if (status === "failed") {
            if (result.message) {
                console.error(`Failed to add song for @${username}:`, result.message);
            }

            const refunded = await rejectRequest({
                client,
                channel,
                key: 'queue.addFailed',
                values: { username },
                isRedeem,
                redemptionId,
                broadcasterId,
                state
            });

            log('addFailed', { track, refunded });
        }
    }, 1000);
}

//function call to avoid a race condition and allow multiple requests at once
async function queueSong(args) {
    const {
        client,
        channel,
        username,
        url,
        state,
        isRedeem = false,
        redemptionId = null,
        broadcasterId = state.broadcasterId,
        requester
    } = args;

    const cooldownKey = String(username).trim().toLowerCase();

    if (activeQueueRequests.has(cooldownKey)) {
        let refunded;

        if (isRedeem && redemptionId) {
            refunded = await rejectRequest({
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

        // Chat is told nothing here, but it still happened - somebody spamming
        // the command is exactly the kind of thing worth being able to see.
        history.recordRequest({
            outcome: 'requestPending',
            source: isRedeem ? 'redeem' : 'chat',
            requester,
            username,
            input: url,
            refunded
        });

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