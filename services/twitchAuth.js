const { loadToken, saveToken } = require('../twitch-token-store');
const { getTwitchClientId } = require('../config/twitchApp');

let refreshPromise = null;

const MAX_NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 400;

/**
 * True for errors where the request never reached Twitch - DNS hiccups,
 * connect timeouts, dropped sockets. Those are worth another try; an actual
 * HTTP response (even a failing one) is not.
 */
function isTransientNetworkError(err) {
    const code = err?.code || err?.cause?.code || '';
    return typeof code === 'string' && (
        code.startsWith('UND_ERR') ||
        ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)
    );
}

function getClientId() {
  const clientId = getTwitchClientId();
  if (!clientId) {
    throw new Error('Missing Twitch client ID.');
  }

  return clientId;
}

async function refreshAccessToken(expectedToken = null) {
  const currentToken = loadToken();

  if (expectedToken && currentToken.access_token !== expectedToken) {
    return currentToken.access_token;
  }

  if (!currentToken.refresh_token) {
    throw new Error('Missing Twitch refresh token. Set TWITCH_REFRESH_TOKEN or run the token generator again.');
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: getClientId(),
          grant_type: 'refresh_token',
          refresh_token: currentToken.refresh_token,
          ...(process.env.TWITCH_CLIENT_SECRET
            ? { client_secret: process.env.TWITCH_CLIENT_SECRET }
            : {})
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        throw new Error(data.message || data.error || `Twitch token refresh failed with status ${response.status}`);
      }

      saveToken({
        access_token: data.access_token,
        refresh_token: data.refresh_token || currentToken.refresh_token,
        expires_at: Date.now() + (data.expires_in || 0) * 1000,
        client_id: currentToken.client_id || getClientId()
      });

      console.log('Twitch access token refreshed.');
      return data.access_token;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function getAccessToken() {
  const token = loadToken();
  if (!token.access_token) {
    throw new Error('Missing Twitch access token. Set TWITCH_ACCESS_TOKEN in .env.');
  }

  if (token.expires_at && Date.now() >= token.expires_at - 60_000) {
    return refreshAccessToken(token.access_token);
  }

  return token.access_token;
}

// Like getAccessToken(), but treats an unknown expiry (expires_at falsy - a
// fresh setup still running on the raw .env credentials, before
// twitch-token.json has ever been written) as "needs a refresh" rather than
// "assume still valid". Use this for tmi.js chat login specifically: unlike
// fetchTwitch(), which reacts to a 401 by refreshing and retrying, a failed
// IRC login makes tmi.js permanently disable its own reconnect - so an
// already-stale starting token would otherwise never get a chance to
// refresh and the bot could never self-heal. fetchTwitch()'s Helix calls
// don't need this: their reactive 401 handling already covers it, and an
// eager check there would just be a wasted round trip on every call.
async function getVerifiedAccessToken() {
  const token = loadToken();
  if (!token.access_token) {
    throw new Error('Missing Twitch access token. Set TWITCH_ACCESS_TOKEN in .env.');
  }

  const knownFresh = token.expires_at && Date.now() < token.expires_at - 60_000;
  if (knownFresh) {
    return token.access_token;
  }

  // Best-effort only: refreshing isn't possible for every setup (e.g. a
  // shared/confidential-client refresh token with no client secret
  // available), and the existing token may still be perfectly valid even
  // though we can't confirm that here. A failed refresh attempt must never
  // prevent chat login outright - fall back to the token as-is and let the
  // actual login attempt be the real test.
  try {
    return await refreshAccessToken(token.access_token);
  } catch (err) {
    console.warn('Twitch token refresh check failed before chat login; using the existing token as-is:', err.message);
    return token.access_token;
  }
}

async function fetchTwitch(url, options = {}, retry = true, attempt = 1) {
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Client-Id': getClientId(),
        Authorization: `Bearer ${token}`
      }
    });
  } catch (err) {
    if (attempt <= MAX_NETWORK_RETRIES && isTransientNetworkError(err)) {
      const code = err.code || err.cause?.code;
      console.warn(`Twitch request failed (${code}); retrying ${attempt}/${MAX_NETWORK_RETRIES}...`);
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * attempt));
      return fetchTwitch(url, options, retry, attempt + 1);
    }
    throw err;
  }

  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken(token);
    } catch (err) {
      // Refreshing isn't possible for every setup (e.g. a shared/
      // confidential-client refresh token with no client secret available).
      // Surface the original 401 instead of masking it behind the refresh
      // failure - callers already know how to handle a 401.
      console.warn('Twitch token refresh failed after a 401; the access token may need to be regenerated manually:', err.message);
      return response;
    }
    return fetchTwitch(url, options, false, attempt);
  }

  return response;
}

module.exports = {
  fetchTwitch,
  getAccessToken,
  getVerifiedAccessToken,
  isTransientNetworkError,
  refreshAccessToken
};
