const state = require('../core/state');
const { fetchTwitch } = require('./twitchAuth');

const DEFAULT_COST = 10;
const DEFAULT_REWARD_NAME = 'Spotify Queue';

async function twitchGet(endpoint) {
    const res = await fetchTwitch(`https://api.twitch.tv/helix/${endpoint}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.message || JSON.stringify(data, null, 2));
    }

    return data;
}

async function twitchPost(endpoint, body) {
    const res = await fetchTwitch(`https://api.twitch.tv/helix/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.message || JSON.stringify(data, null, 2));
    }

    return data;
}

async function getBroadcasterId(username) {
    if (!username) {
        throw new Error('Missing TWITCH_BROADCASTER_USERNAME.');
    }

    const data = await twitchGet(`users?login=${encodeURIComponent(username)}`);

    if (!data.data?.length) {
        throw new Error(`Broadcaster username "${username}" not found.`);
    }

    return data.data[0].id;
}

async function findReward(broadcasterId, rewardName) {
    const data = await twitchGet(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}`);
    return data.data.find(reward => reward.title.toLowerCase() === rewardName.toLowerCase());
}

/**
 * Twitch only lets the client_id that created a reward manage it afterwards.
 * only_manageable_rewards=true returns just the ones this app owns, which is
 * the only reliable way to know whether we can actually control a reward.
 */
async function findManageableReward(broadcasterId, { rewardName, rewardIds = [] }) {
    const data = await twitchGet(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`);

    // Id first, so a reward renamed in the Creator Dashboard is still ours.
    return data.data.find(reward => rewardIds.includes(reward.id))
        || data.data.find(reward => rewardName && reward.title.toLowerCase() === rewardName.toLowerCase());
}

/**
 * Creates the song request reward if it doesn't already exist, and records its
 * id in queue-settings.json. Safe to run repeatedly.
 *
 * Note: Twitch only lets the client_id that created a reward manage it later,
 * so a reward created by a different app has to be deleted in the Creator
 * Dashboard before this can take it over.
 */
async function ensureSpotifyReward({
    username = process.env.TWITCH_BROADCASTER_USERNAME,
    rewardName = process.env.SPOTIFY_REWARD_NAME || DEFAULT_REWARD_NAME,
    cost = DEFAULT_COST
} = {}) {
    const broadcasterId = await getBroadcasterId(username);

    // Prefer a reward we already own (by stored id, then by name) - the user
    // is free to rename it in the Creator Dashboard afterwards.
    //
    // previousSpotifyRewardId is the id of a reward we unlinked earlier. Trying
    // it too is what makes an unlink recoverable: without it, a reward that was
    // both unlinked and renamed is unreachable, and this would create a second
    // one alongside it. A stale id simply matches nothing.
    let reward = await findManageableReward(broadcasterId, {
        rewardName,
        rewardIds: [state.spotifyRewardId, state.previousSpotifyRewardId].filter(Boolean)
    });
    let created = false;

    if (!reward) {
        const unmanageable = await findReward(broadcasterId, rewardName);
        if (unmanageable) {
            throw new Error(`A reward named "${rewardName}" already exists but was created by a different application, so this bot cannot control it. Delete it in your Creator Dashboard and create it here instead.`);
        }
    }

    if (!reward) {
        const data = await twitchPost(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, {
            title: rewardName,
            prompt: 'Paste a Spotify track URL',
            background_color: '#1DB954',
            cost,
            is_user_input_required: true,
            is_enabled: true
        });

        reward = data.data[0];
        created = true;
    }

    let changed = false;
    if (state.spotifyRewardId !== reward.id) {
        state.spotifyRewardId = reward.id;
        changed = true;
    }
    if (state.broadcasterId !== broadcasterId) {
        state.broadcasterId = broadcasterId;
        changed = true;
    }
    // We are linked again, so the recovery pointer has done its job. Leaving it
    // set would let a much older reward win a future lookup.
    if (state.previousSpotifyRewardId) {
        state.previousSpotifyRewardId = null;
        changed = true;
    }
    if (changed) state.saveSettings();

    return {
        created,
        alreadyExisted: !created,
        id: reward.id,
        title: reward.title,
        broadcasterId
    };
}

module.exports = { ensureSpotifyReward };
