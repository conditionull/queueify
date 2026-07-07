require("dotenv").config();

const state = require("./core/state");

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;
const USERNAME = process.env.TWITCH_BROADCASTER_USERNAME;
const REWARD_NAME = process.env.SPOTIFY_REWARD_NAME;

async function twitchGet(endpoint) {
    const res = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        headers: {
            "Client-Id": CLIENT_ID,
            Authorization: `Bearer ${ACCESS_TOKEN}`
        }
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(JSON.stringify(data, null, 2));
    }

    return data;
}

async function twitchPost(endpoint, body) {
    const res = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        method: "POST",
        headers: {
            "Client-Id": CLIENT_ID,
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(JSON.stringify(data, null, 2));
    }

    return data;
}

async function getBroadcasterId() {
    const data = await twitchGet(`users?login=${USERNAME}`);

    if (!data.data || data.data.length === 0) {
        throw new Error(`Broadcaster username "${USERNAME}" not found`);
    }

    return data.data[0].id;
}

async function getReward(broadcasterId) {
    const data = await twitchGet(
        `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`
    );

    return data.data.find(
        r => r.title.toLowerCase() === REWARD_NAME.toLowerCase()
    );
}

async function createReward(broadcasterId) {
    const data = await twitchPost(
        `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
        {
            title: REWARD_NAME,
            prompt: "Paste a Spotify track URL",
            background_color: "#1DB954",

            cost: 10,
            is_user_input_required: true,
            is_enabled: true
        }
    );

    return data.data[0];
}

(async () => {
    try {
        const broadcasterId = await getBroadcasterId();

        let reward = await getReward(broadcasterId);

        if (reward) {
            console.log("Reward already exists!");
        } else {
            console.log("Creating reward...");
            reward = await createReward(broadcasterId);
            console.log("Reward created!");
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

        if (changed) {
            state.saveSettings();
        }

        console.log("Reward:", reward.title);
        console.log("ID:", reward.id);
    }
    catch (err) {
        console.error(err.message);
    }
})();