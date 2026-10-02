const { fetchTwitch } = require('./twitchAuth');
const { loadToken } = require('../twitch-token-store');

/**
 * A viewer's sub tier, from Twitch itself.
 *
 * The chat badge is not enough: a channel without its own Tier 2 and Tier 3
 * badges shows every sub the Tier 1 one, so a Tier 3 sub's badge says Tier 1.
 * Twitch's subscriptions list always knows. It needs the streamer's login to
 * carry channel:read:subscriptions, which logins from before it was asked for
 * do not - so this is a best effort, and null means "ask the badge".
 *
 * Helix's /subscriptions/user would be the obvious call, but it only answers
 * with the viewer's own login, never the streamer's.
 */

// A sub's tier only changes when they resub, so a few minutes is plenty -
// and it keeps a busy chat from asking Twitch about the same person over and over.
const KEEP_MS = 10 * 60 * 1000;
// !fx and !sr wait on this, so Twitch being slow must not hold up chat.
const TIMEOUT_MS = 3000;

const known = new Map();
const asking = new Map();
// The login Twitch last refused - a login without the scope. Not asked again
// until it changes: reconnecting, or a refresh, tries again.
let refusedToken = null;

function broadcasterId() {
    return require('../core/state').broadcasterId || null;
}

/** What Twitch said within the last few minutes - 0 for not a sub - or null. */
function cached(userId) {
    const entry = userId ? known.get(String(userId)) : null;
    if (!entry || Date.now() - entry.at > KEEP_MS) return null;
    return entry.tier;
}

/** Their tier - 0 for not a sub - or null when Twitch cannot be asked. */
async function tierOf(userId) {
    const id = userId ? String(userId) : null;
    const channel = broadcasterId();
    // No id until the bot has seen the channel is an affiliate or partner,
    // and nobody else has subs to ask about.
    if (!id || !channel) return null;

    const remembered = cached(id);
    if (remembered !== null) return remembered;
    if (refusedToken && refusedToken === loadToken().access_token) return null;

    if (!asking.has(id)) {
        asking.set(id, ask(channel, id).finally(() => asking.delete(id)));
    }
    return asking.get(id);
}

async function ask(channel, id) {
    let res;
    try {
        // No refresh-and-retry on a 401: without the scope every call is a
        // 401, and each would renew the login for nothing.
        res = await fetchTwitch(
            `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(channel)}&user_id=${encodeURIComponent(id)}`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
            false
        );
    } catch {
        return null;
    }

    if (res.status === 401 || res.status === 403) {
        refusedToken = loadToken().access_token || null;
        const body = await res.json().catch(() => ({}));
        // Once per login, so a streamer wondering why a Tier 3 sub was turned
        // away can see why in the terminal.
        console.warn(`Could not check sub tiers (${body.message || res.status}). ` +
            'Reconnect Twitch on the dashboard to get the new scope. Until then, subs go by their chat badge.');
        return null;
    }
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.data)) return null;

    const tier = tierFrom(data.data[0]?.tier);
    known.set(id, { tier, at: Date.now() });
    return tier;
}

// "1000", "2000" or "3000" - Prime is "1000". Nothing listed is not a sub.
function tierFrom(value) {
    const n = Math.floor(Number(value) / 1000);
    return n >= 1 && n <= 3 ? n : 0;
}

/** For tests: forget everything. */
function reset() {
    known.clear();
    asking.clear();
    refusedToken = null;
}

module.exports = { tierOf, cached, reset };
