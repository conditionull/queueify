const state = require("./core/state")
const WebSocket = require("ws");
const queueSong = require("./services/queueSong");
const themeTakeoverReward = require('./services/themeTakeoverReward');
const { syncThemeTakeoverReward } = require('./services/syncThemeTakeoverReward');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;
const USERNAME = process.env.TWITCH_BROADCASTER_USERNAME;
const REWARD_NAME = process.env.SPOTIFY_REWARD_NAME;
const THEME_TAKEOVER_REWARD_NAME = process.env.THEME_TAKEOVER_REWARD_NAME;

async function twitchGet(endpoint) {
    const res = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        headers: {
            "Client-Id": CLIENT_ID,
            Authorization: `Bearer ${ACCESS_TOKEN}`
        }
    });

    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
    return data;
}

async function getBroadcasterId() {
    const data = await twitchGet(`users?login=${USERNAME}`);

    if (!data.data || data.data.length === 0) {
        throw new Error(`Broadcaster username "${USERNAME}" not found`);
    }

    return data.data[0].id;
}

async function findReward(broadcasterId, rewardName) {
    const data = await twitchGet(
        `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`
    );

    return data.data.find(
        r => r.title.toLowerCase() === rewardName.toLowerCase()
    );
}

async function createSubscription(sessionId, broadcasterId, rewardId) {
    const res = await fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
            method: "POST",
            headers: {
                "Client-Id": CLIENT_ID,
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                type: "channel.channel_points_custom_reward_redemption.add",
                version: "1",
                condition: {
                    broadcaster_user_id: broadcasterId,
                    reward_id: rewardId
                },
                transport: {
                    method: "websocket",
                    session_id: sessionId
                }
            })
        }
    );

    const data = await res.json();

    if (!res.ok) {
        throw new Error(JSON.stringify(data, null, 2));
    }

    console.log("EventSub subscription created ✔");
}

module.exports = function startEventSub(client) {
    const ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");

    let sessionId;

    ws.on("open", () => {
        console.log("EventSub WS connected");
    });

    ws.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());

        const type = msg.metadata.message_type;

        if (type === "session_welcome") {
            sessionId = msg.payload.session.id;

            console.log("Session:", sessionId);

            try {
                const broadcasterId = await getBroadcasterId();
                console.log("Broadcaster ID:", broadcasterId);

                let changed = false;

                if (state.broadcasterId !== broadcasterId) {
                    state.broadcasterId = broadcasterId;
                    changed = true;
                }

                const reward = await findReward(broadcasterId, REWARD_NAME);

                if (!reward) {
                    throw new Error(
                        `Reward "${REWARD_NAME}" not found. Run "npm run reward" first.`
                    );
                }

                console.log("Reward:", reward.title, reward.id);

                if (state.spotifyRewardId !== reward.id) {
                    state.spotifyRewardId = reward.id;
                    changed = true;
                }

                if (changed) {
                    state.saveSettings();
                }

                await createSubscription(sessionId, broadcasterId, reward.id);

                if (THEME_TAKEOVER_REWARD_NAME) {
                    const themeTakeover = await findReward(broadcasterId, THEME_TAKEOVER_REWARD_NAME);

                    if (!themeTakeover) {
                        console.warn(`Theme takeover reward "${THEME_TAKEOVER_REWARD_NAME}" not found. Run "npm run theme-takeover-reward" to enable it.`);
                    } else {
                        console.log('Theme takeover reward:', themeTakeover.title, themeTakeover.id);

                        if (state.themeTakeoverRewardId !== themeTakeover.id) {
                            state.themeTakeoverRewardId = themeTakeover.id;
                            state.saveSettings();
                        }

                        await syncThemeTakeoverReward({
                            broadcasterId,
                            rewardId: themeTakeover.id
                        });
                        await createSubscription(sessionId, broadcasterId, themeTakeover.id);
                    }
                }
            } catch (err) {
                console.error("Setup failed:");
                console.error(err.message);
            }
        }

        if (type === "notification") {
            const event = msg.payload.event;

            if (
                msg.metadata.subscription_type ===
                "channel.channel_points_custom_reward_redemption.add"
            ) {
                console.log("Redemption:", event.user_name, event.user_input);

                if (!state.redeemsEnabled) {
                    console.log("Redeem ignored (currently disabled)");
                    return;
                }

                if (event.reward.id === state.spotifyRewardId) {
                    await queueSong({
                        client,
                        channel: process.env.TWITCH_BROADCASTER_USERNAME,
                        username: event.user_name,
                        url: event.user_input,
                        state,
                        isRedeem: true,
                        redemptionId: event.id,
                        broadcasterId: state.broadcasterId
                    });
                } else if (event.reward.id === state.themeTakeoverRewardId) {
                    await themeTakeoverReward({
                        client,
                        channel: process.env.TWITCH_BROADCASTER_USERNAME,
                        username: event.user_name,
                        theme: event.user_input,
                        durationSeconds: state.themeTakeoverDurationSeconds,
                        redemptionId: event.id,
                        broadcasterId: state.broadcasterId,
                        rewardId: state.themeTakeoverRewardId
                    });
                }
            }
        }
    });
};
