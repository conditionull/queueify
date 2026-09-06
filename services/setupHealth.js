const state = require('../core/state');
const { getTwitchClientId } = require('../config/twitchApp');
const { loadToken, saveToken, clearToken } = require('../twitch-token-store');
const { fetchTwitch, refreshAccessToken, isTransientNetworkError } = require('./twitchAuth');
const { REQUIRED_SCOPES } = require('./twitchDeviceAuth');

const VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';

/**
 * Asks Twitch who a token actually belongs to. Returns null when we simply
 * could not reach Twitch, which callers must treat as "unknown" rather than
 * "invalid" - a network blip must never wipe a working setup.
 */
async function validateToken(accessToken) {
    let response;
    try {
        response = await fetch(VALIDATE_ENDPOINT, {
            headers: { Authorization: `OAuth ${accessToken}` }
        });
    } catch {
        return null;
    }

    if (response.status === 401) return { valid: false };
    if (!response.ok) return null;

    const data = await response.json().catch(() => null);
    if (!data) return null;

    return {
        valid: true,
        clientId: data.client_id,
        login: data.login,
        scopes: data.scopes || [],
        expiresIn: data.expires_in
    };
}

async function isRewardManageable(broadcasterId, rewardId) {
    try {
        const res = await fetchTwitch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`
        );

        if (!res.ok) return null;

        const data = await res.json().catch(() => null);
        if (!data?.data) return null;

        return data.data.some(reward => reward.id === rewardId);
    } catch {
        return null;
    }
}

/**
 * Verifies the saved Twitch credentials and reward still work with the app
 * this install is now configured to use, and clears local state that provably
 * cannot work. Clearing is what makes the normal setup flow pick the problem
 * up: a wiped token shows "Connect Twitch", a wiped reward id shows "Create
 * reward". Nothing here is destructive on the Twitch side.
 *
 * Returns the issues found so callers can explain what happened.
 */
async function repairSetupState() {
    const issues = [];
    let token = loadToken();
    const currentClientId = getTwitchClientId();

    if (!token.access_token) return issues;

    let result = await validateToken(token.access_token);

    // Unreachable Twitch: leave everything alone.
    if (result === null) return issues;

    // A 401 here is not proof the login is gone: access tokens only live a few
    // hours, so a token that simply aged out since the last run looks exactly
    // like a revoked one. The refresh token is what actually keeps the setup
    // alive, and clearing it is unrecoverable - so only clear once Twitch has
    // refused to renew it.
    if (!result.valid) {
        // We cannot renew a token minted by another app anyway, and the refusal
        // would come back as a generic failure - say what really happened.
        if (token.client_id && token.client_id !== currentClientId) {
            clearToken();
            issues.push({
                code: 'twitch_client_changed',
                message: 'Your saved Twitch login was for a different Twitch application, so it no longer works. Reconnect Twitch.'
            });
            return issues;
        }

        let refreshedAccessToken;
        try {
            refreshedAccessToken = await refreshAccessToken(token.access_token);
        } catch (err) {
            // Never reached Twitch: unknown, not broken. Same rule as above.
            if (isTransientNetworkError(err)) return issues;

            clearToken();
            issues.push({
                code: 'twitch_token_invalid',
                message: 'Your saved Twitch login expired or was revoked. Reconnect Twitch.'
            });
            return issues;
        }

        result = await validateToken(refreshedAccessToken);
        if (result === null) return issues;

        if (!result.valid) {
            clearToken();
            issues.push({
                code: 'twitch_token_invalid',
                message: 'Your saved Twitch login expired or was revoked. Reconnect Twitch.'
            });
            return issues;
        }

        // The refresh rewrote the file; keep working from what is on disk.
        token = loadToken();
    }

    if (result.clientId && result.clientId !== currentClientId) {
        clearToken();
        issues.push({
            code: 'twitch_client_changed',
            message: 'Your saved Twitch login was for a different Twitch application, so it no longer works. Reconnect Twitch.'
        });
        return issues;
    }

    // Backfill the client id for tokens saved before we recorded it.
    if (!token.client_id && result.clientId) {
        saveToken({ ...token, client_id: result.clientId });
    }

    const missingScopes = REQUIRED_SCOPES.filter(scope => !result.scopes.includes(scope));
    if (missingScopes.length) {
        clearToken();
        issues.push({
            code: 'twitch_scopes_missing',
            message: `Your Twitch login is missing permissions (${missingScopes.join(', ')}). Reconnect Twitch and approve all of them.`
        });
        return issues;
    }

    if (state.spotifyRewardId && state.broadcasterId) {
        const manageable = await isRewardManageable(state.broadcasterId, state.spotifyRewardId);

        if (manageable === false) {
            state.forgetSpotifyReward();
            issues.push({
                code: 'reward_unmanageable',
                message: 'Your channel point reward was created by a different Twitch application, so this bot cannot control it. Delete it in your Twitch Creator Dashboard, then create it again from this page.'
            });
        }
    }

    return issues;
}

module.exports = { repairSetupState, validateToken, isRewardManageable };
