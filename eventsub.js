const state = require('./core/state');
const WebSocket = require('ws');
const queueSong = require('./services/queueSong');
const refundRedeem = require('./services/refundRedeem');
const { fetchTwitch } = require('./services/twitchAuth');

const USERNAME = process.env.TWITCH_BROADCASTER_USERNAME;
const REWARD_NAME = process.env.SPOTIFY_REWARD_NAME || 'Spotify Queue';
const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws';
const MAX_BACKOFF_MS = 60_000;
// Twitch promises a keepalive within keepalive_timeout_seconds of silence, so
// that value is when a keepalive is *due*, not when the link is dead. Closing
// at exactly the deadline means ordinary network jitter (a keepalive landing a
// few ms late) tears down a perfectly healthy socket, which shows up as a
// connect/subscribe/close/reconnect loop every ~10s. Wait a grace period past
// the deadline before giving up.
const KEEPALIVE_GRACE_MS = 5000;

async function twitchGet(endpoint) {
    const res = await fetchTwitch(`https://api.twitch.tv/helix/${endpoint}`);
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
    return data;
}

async function getBroadcasterId() {
    const data = await twitchGet(`users?login=${USERNAME}`);
    if (!data.data?.length) throw new Error(`Broadcaster username "${USERNAME}" not found`);
    return data.data[0].id;
}

/**
 * Resolve our reward, preferring the id we stored when it was created. Falling
 * back to the title means renaming it in the Creator Dashboard is safe, and
 * only_manageable_rewards keeps us from latching onto another app's reward.
 */
async function findReward(broadcasterId, rewardName, knownId) {
    const data = await twitchGet(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`);
    const rewards = data.data || [];

    return rewards.find(reward => knownId && reward.id === knownId)
        || rewards.find(reward => reward.title.toLowerCase() === rewardName.toLowerCase())
        // Exactly one reward we own is unambiguous even after a rename.
        || (rewards.length === 1 ? rewards[0] : undefined);
}

async function createSubscription(sessionId, broadcasterId, rewardId) {
    const res = await fetchTwitch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'channel.channel_points_custom_reward_redemption.add',
            version: '1',
            condition: { broadcaster_user_id: broadcasterId, reward_id: rewardId },
            transport: { method: 'websocket', session_id: sessionId }
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw new Error(JSON.stringify(data, null, 2));
    if (res.status === 409) return;
    console.log('EventSub ready.');
}

module.exports = function startEventSub(client) {
    let activeSocket = null;
    let reconnectTimer = null;
    let keepaliveTimer = null;
    let stopped = false;
    let backoff = 1000;
    let reconnectAttempts = 0;
    let generation = 0;
    const sockets = new Set();
    const seenNotifications = new Map();
    let keepaliveSeconds = 10;
    let warnedAboutReward = false;

    function clearKeepalive() {
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
    }

    function scheduleReconnect(reason) {
        if (stopped || reconnectTimer) return;
        const delay = backoff;
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
        // Only log the first attempt of a streak so a flapping connection
        // doesn't bury everything else in the console.
        if (reconnectAttempts === 0) {
            console.warn(`EventSub disconnected (${reason}); reconnecting...`);
        }
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect(DEFAULT_URL);
        }, delay);
    }

    function rememberNotification(messageId) {
        if (!messageId) return true;
        const now = Date.now();
        for (const [id, seenAt] of seenNotifications) {
            if (now - seenAt > 10 * 60 * 1000) seenNotifications.delete(id);
        }
        if (seenNotifications.has(messageId)) return false;
        seenNotifications.set(messageId, now);
        return true;
    }

    function armKeepalive(ws, seconds, socketGeneration) {
        clearKeepalive();
        keepaliveSeconds = seconds || 10;
        keepaliveTimer = setTimeout(() => {
            if (socketGeneration === generation && ws === activeSocket) {
                try { ws.close(); } catch {}
            }
        }, Math.max(10, keepaliveSeconds) * 1000 + KEEPALIVE_GRACE_MS);
    }

    async function setupSession(sessionId, socketGeneration) {
        const broadcasterId = await getBroadcasterId();
        if (socketGeneration !== generation) return;

        let changed = false;
        if (state.broadcasterId !== broadcasterId) {
            state.broadcasterId = broadcasterId;
            changed = true;
        }

        const reward = await findReward(broadcasterId, REWARD_NAME, state.spotifyRewardId);

        // No reward is a perfectly normal way to run Queueify: channel points
        // need an Affiliate or Partner channel, and chat requests do not. Say
        // so once and leave the socket alone rather than treating it as a
        // failure and reconnecting over and over.
        if (!reward) {
            if (!warnedAboutReward) {
                warnedAboutReward = true;
                console.log('No channel point reward found - song requests from chat only.');
                console.log('Create one on the dashboard and restart to accept redemptions.');
            }
            return;
        }
        if (state.spotifyRewardId !== reward.id) {
            state.spotifyRewardId = reward.id;
            changed = true;
        }
        if (changed) state.saveSettings();
        if (socketGeneration !== generation) return;
        await createSubscription(sessionId, broadcasterId, reward.id);
    }

    function handleNotification(msg) {
        const event = msg.payload.event;
        if (msg.metadata.subscription_type !== 'channel.channel_points_custom_reward_redemption.add') return;
        console.log('Redemption:', event.user_name, event.user_input);

        if (event.reward.id === state.spotifyRewardId) {
            if (!state.redeemsEnabled) {
                console.log('Redeem ignored (currently disabled)');
                return refundRedeem(event.id, state.broadcasterId, state.spotifyRewardId);
            }
            return queueSong({ client, channel: USERNAME, username: event.user_name, url: event.user_input, state, isRedeem: true, redemptionId: event.id, broadcasterId: state.broadcasterId });
        }
    }

    function connect(url, isMigration = false) {
        if (stopped) return;
        const socketGeneration = ++generation;
        const ws = new WebSocket(url);
        let migrated = isMigration;
        sockets.add(ws);

        ws.on('open', () => {});
        ws.on('message', async raw => {
            if (stopped) return;
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch (err) {
                console.error('EventSub message parse failed:', err.message);
                return;
            }

            const type = msg.metadata?.message_type;
            if (socketGeneration !== generation && ws !== activeSocket) return;
            if (type === 'session_keepalive') {
                if (ws === activeSocket) armKeepalive(ws, msg.payload?.session?.keepalive_timeout_seconds ?? keepaliveSeconds, socketGeneration);
                return;
            }
            if (type === 'session_reconnect') {
                const reconnectUrl = msg.payload?.session?.reconnect_url;
                if (!reconnectUrl) return scheduleReconnect('missing reconnect URL');
                migrated = true;
                connect(reconnectUrl, true);
                return;
            }
            if (type === 'session_welcome') {
                const previousSocket = activeSocket;
                activeSocket = ws;
                backoff = 1000;
                if (reconnectAttempts > 1) {
                    console.log(`EventSub reconnected after ${reconnectAttempts} attempts.`);
                }
                reconnectAttempts = 0;
                armKeepalive(ws, msg.payload.session.keepalive_timeout_seconds, socketGeneration);
                if (!migrated) {
                    try { await setupSession(msg.payload.session.id, socketGeneration); }
                    catch (err) {
                        console.error('EventSub setup failed:', err.message);
                        if (ws === activeSocket) {
                            try { ws.close(); } catch {}
                            scheduleReconnect('session setup failed');
                        }
                        return;
                    }
                }
                if (previousSocket && previousSocket !== ws) {
                    try { previousSocket.close(); } catch {}
                }
                return;
            }
            if (type === 'revocation') {
                console.error(`EventSub subscription revoked: ${msg.payload?.subscription?.status || 'unknown reason'}`);
                if (ws === activeSocket) {
                    try { ws.close(); } catch {}
                }
                return;
            }
            if (type === 'notification' && ws === activeSocket) {
                if (!rememberNotification(msg.metadata.message_id)) return;
                armKeepalive(ws, keepaliveSeconds, socketGeneration);
                try { await handleNotification(msg); } catch (err) { console.error('EventSub notification failed:', err.message); }
            }
        });
        ws.on('error', err => console.error('EventSub WS error:', err.message));
        ws.on('close', () => {
            sockets.delete(ws);
            if (ws === activeSocket) {
                activeSocket = null;
                clearKeepalive();
            }
            // A stale/superseded socket (e.g. the old connection after a
            // successful session_reconnect migration) closing is expected
            // and shouldn't trigger a reconnect - only the latest attempt
            // closing means the connection is actually down. This also
            // covers the case where the very first connect() fails before
            // ever reaching session_welcome (activeSocket is still null).
            if (socketGeneration !== generation) return;
            scheduleReconnect('socket closed');
        });
    }

    connect(DEFAULT_URL);
    return {
        stop() {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            clearKeepalive();
            for (const socket of sockets) socket.close();
            sockets.clear();
            activeSocket = null;
        }
    };
};
