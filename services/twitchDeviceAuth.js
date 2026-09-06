const { saveToken } = require('../twitch-token-store');
const { getTwitchClientId } = require('../config/twitchApp');

const DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device';
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const USERS_ENDPOINT = 'https://api.twitch.tv/helix/users';

// Everything Queueify needs: chat read/write plus channel point redemptions.
const REQUIRED_SCOPES = [
    'chat:read',
    'chat:edit',
    'channel:read:redemptions',
    'channel:manage:redemptions',
    'user:read:chat'
];

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_EXPIRES_IN_SECONDS = 1800;
const MIN_POLL_INTERVAL_MS = 1000;
const SLOW_DOWN_STEP_MS = 5000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

// code: config | network | request_failed | denied | expired | cancelled
class TwitchDeviceAuthError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'TwitchDeviceAuthError';
        this.code = code;
    }
}

function cancelled() {
    return new TwitchDeviceAuthError('cancelled', 'Twitch authorization was cancelled.');
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(cancelled());
            return;
        }

        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            reject(cancelled());
        }

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

// Twitch isn't fully consistent about whether the OAuth error lands in `error`
// or `message`, so match against both rather than trusting one shape.
function readErrorCode(data, status) {
    const raw = `${data?.error ?? ''} ${data?.message ?? ''}`.toLowerCase();

    if (raw.includes('authorization_pending') || raw.includes('authorization pending')) return 'authorization_pending';
    if (raw.includes('slow_down') || raw.includes('slow down')) return 'slow_down';
    if (raw.includes('expired')) return 'expired';
    if (raw.includes('denied')) return 'denied';

    // A bare 400 with nothing useful in it is how some pending responses show
    // up; treat it as pending rather than aborting a flow the user may still
    // be completing.
    if (status === 400 && !raw.trim()) return 'authorization_pending';

    return null;
}

function describeError(data, status, fallback) {
    return data?.message || data?.error_description || data?.error || `${fallback} (HTTP ${status})`;
}

function resolveClientId(clientId) {
    const resolved = clientId || getTwitchClientId();
    if (!resolved) {
        throw new TwitchDeviceAuthError('config', 'Missing Twitch client ID.');
    }
    return resolved;
}

/**
 * Step 1: ask Twitch for a device code. Returns the details to show the user
 * (short code + the page they open to approve it).
 */
async function requestDeviceCode({ clientId, scopes = REQUIRED_SCOPES, signal } = {}) {
    const resolvedClientId = resolveClientId(clientId);

    let response;
    try {
        response = await fetch(DEVICE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: resolvedClientId,
                scopes: scopes.join(' ')
            }),
            signal
        });
    } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError') throw cancelled();
        throw new TwitchDeviceAuthError('network', `Could not reach Twitch: ${err.message}`);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new TwitchDeviceAuthError('request_failed', describeError(data, response.status, 'Twitch rejected the device authorization request'));
    }

    if (!data.device_code || !data.user_code) {
        throw new TwitchDeviceAuthError('request_failed', 'Twitch did not return a device code. Confirm the app\'s client type is set to "Public" in the Twitch Developer Console.');
    }

    const intervalSeconds = Number(data.interval) > 0 ? Number(data.interval) : DEFAULT_POLL_INTERVAL_SECONDS;
    const expiresInSeconds = Number(data.expires_in) > 0 ? Number(data.expires_in) : DEFAULT_EXPIRES_IN_SECONDS;

    return {
        clientId: resolvedClientId,
        deviceCode: data.device_code,
        userCode: data.user_code,
        // verification_uri_complete embeds the code so the user only has to click.
        verificationUri: data.verification_uri_complete || data.verification_uri || 'https://www.twitch.tv/activate',
        intervalMs: Math.max(MIN_POLL_INTERVAL_MS, intervalSeconds * 1000),
        expiresAt: Date.now() + expiresInSeconds * 1000,
        scopes
    };
}

/**
 * Step 2: poll until the user approves (or the code expires / is denied).
 * Saves the resulting tokens to twitch-token.json on success.
 */
async function pollForDeviceToken(prompt, { signal, onPending, slowDownStepMs = SLOW_DOWN_STEP_MS } = {}) {
    if (!prompt?.deviceCode) {
        throw new TwitchDeviceAuthError('config', 'Missing device code. Request one before polling.');
    }

    let intervalMs = prompt.intervalMs || DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    let consecutiveFailures = 0;

    while (true) {
        if (signal?.aborted) throw cancelled();

        // Always wait before the first poll - the user needs time to approve.
        await sleep(intervalMs, signal);

        if (Date.now() >= prompt.expiresAt) {
            throw new TwitchDeviceAuthError('expired', 'The Twitch authorization code expired before it was approved. Start over to get a new one.');
        }

        let response;
        let data;
        try {
            response = await fetch(TOKEN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: prompt.clientId,
                    scopes: (prompt.scopes || REQUIRED_SCOPES).join(' '),
                    device_code: prompt.deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                }),
                signal
            });
            data = await response.json().catch(() => ({}));
            consecutiveFailures = 0;
        } catch (err) {
            if (signal?.aborted || err?.name === 'AbortError') throw cancelled();

            // A blip shouldn't kill a flow the user is midway through.
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                throw new TwitchDeviceAuthError('network', `Lost contact with Twitch while waiting for approval: ${err.message}`);
            }
            continue;
        }

        if (response.ok && data.access_token) {
            return persistDeviceToken(data, prompt);
        }

        switch (readErrorCode(data, response.status)) {
            case 'authorization_pending':
                onPending?.();
                continue;
            case 'slow_down':
                intervalMs += slowDownStepMs;
                continue;
            case 'expired':
                throw new TwitchDeviceAuthError('expired', 'The Twitch authorization code expired before it was approved. Start over to get a new one.');
            case 'denied':
                throw new TwitchDeviceAuthError('denied', 'Twitch authorization was denied.');
            default:
                throw new TwitchDeviceAuthError('request_failed', describeError(data, response.status, 'Twitch rejected the authorization'));
        }
    }
}

function persistDeviceToken(data, prompt) {
    const granted = Array.isArray(data.scope) ? data.scope : String(data.scope || '').split(' ').filter(Boolean);
    const missingScopes = (prompt.scopes || REQUIRED_SCOPES).filter(scope => !granted.includes(scope));

    if (!data.refresh_token) {
        console.warn('Twitch did not return a refresh token; the access token cannot be renewed automatically.');
    }

    saveToken({
        access_token: data.access_token,
        refresh_token: data.refresh_token || '',
        expires_at: Date.now() + (Number(data.expires_in) || 0) * 1000,
        client_id: prompt.clientId
    });

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt: Date.now() + (Number(data.expires_in) || 0) * 1000,
        grantedScopes: granted,
        missingScopes
    };
}

/**
 * Who does this token actually belong to? Surfaces the account that approved
 * the prompt so callers can confirm it's the right one (broadcaster vs bot).
 * Never throws - identity is informational.
 */
async function getTokenIdentity(accessToken, clientId) {
    try {
        const response = await fetch(USERS_ENDPOINT, {
            headers: {
                'Client-Id': resolveClientId(clientId),
                Authorization: `Bearer ${accessToken}`
            }
        });

        if (!response.ok) return null;

        const data = await response.json().catch(() => ({}));
        const user = data?.data?.[0];
        return user ? { id: user.id, login: user.login, displayName: user.display_name } : null;
    } catch {
        return null;
    }
}

/**
 * Convenience wrapper: run the whole flow, handing the prompt to `onPrompt`
 * so the caller can display the code/link while polling runs.
 */
async function authorizeDevice({ clientId, scopes = REQUIRED_SCOPES, signal, onPrompt, onPending } = {}) {
    const prompt = await requestDeviceCode({ clientId, scopes, signal });
    onPrompt?.(prompt);

    const result = await pollForDeviceToken(prompt, { signal, onPending });
    const identity = await getTokenIdentity(result.accessToken, prompt.clientId);

    return { ...result, identity };
}

module.exports = {
    REQUIRED_SCOPES,
    TwitchDeviceAuthError,
    requestDeviceCode,
    pollForDeviceToken,
    getTokenIdentity,
    authorizeDevice
};
