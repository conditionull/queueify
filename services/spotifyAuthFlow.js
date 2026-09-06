const express = require('express');
const { saveToken } = require('../spotify-token-store');

const SCOPES = 'user-modify-playback-state user-read-currently-playing user-read-playback-state';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

class SpotifyAuthError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SpotifyAuthError';
        this.code = code;
    }
}

function resolveRedirect() {
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8000/callback';
    const url = new URL(redirectUri);
    const isLoopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');

    if (url.protocol !== 'https:' && !isLoopback) {
        throw new SpotifyAuthError('config', 'SPOTIFY_REDIRECT_URI must use HTTPS, except for http://127.0.0.1 during local setup.');
    }

    return { redirectUri, url, port: Number(url.port) || 8000, path: url.pathname || '/callback' };
}

async function exchangeCode(code, redirectUri, clientId, clientSecret) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new SpotifyAuthError('exchange_failed', data.error_description || data.error || `Spotify token exchange failed with status ${response.status}`);
    }

    if (!data.access_token || !data.refresh_token || !data.expires_in) {
        throw new SpotifyAuthError('exchange_failed', 'Spotify token response was missing expected fields.');
    }

    return data;
}

/**
 * Starts a short-lived local server on the registered redirect URI's port and
 * returns the URL the user should open. `completion` resolves once Spotify
 * redirects back and the tokens are saved.
 *
 * The caller must call `close()` when finished (completion does not close the
 * server on its own, so a denied attempt can be retried on the same server).
 */
async function startSpotifyAuth({
    clientId = process.env.SPOTIFY_CLIENT_ID,
    clientSecret = process.env.SPOTIFY_CLIENT_SECRET
} = {}) {
    if (!clientId || !clientSecret) {
        throw new SpotifyAuthError('config', 'Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.');
    }

    const { redirectUri, port, path } = resolveRedirect();
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

    let settle;
    const completion = new Promise(resolve => { settle = resolve; });

    const app = express();

    app.get(path, async (req, res) => {
        if (req.query.error) {
            res.type('text/plain').status(400).send(`Spotify authorization failed: ${req.query.error}`);
            settle({ ok: false, error: { code: 'denied', message: String(req.query.error) } });
            return;
        }

        if (req.query.state !== state) {
            res.type('text/plain').status(400).send('Spotify authorization state mismatch. Start the flow again.');
            settle({ ok: false, error: { code: 'state_mismatch', message: 'Authorization state did not match.' } });
            return;
        }

        if (!req.query.code) {
            res.type('text/plain').status(400).send('Missing Spotify authorization code.');
            settle({ ok: false, error: { code: 'no_code', message: 'Spotify did not return an authorization code.' } });
            return;
        }

        try {
            const data = await exchangeCode(String(req.query.code), redirectUri, clientId, clientSecret);

            saveToken({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: Date.now() + data.expires_in * 1000
            });

            res.type('text/html').send('<p style="font:16px system-ui;padding:40px">Spotify connected. You can close this tab and return to setup.</p>');
            settle({ ok: true });
        } catch (err) {
            res.type('text/plain').status(500).send(`Spotify authorization failed: ${err.message}`);
            settle({ ok: false, error: { code: err.code || 'exchange_failed', message: err.message } });
        }
    });

    const server = await new Promise((resolve, reject) => {
        const s = app.listen(port, '127.0.0.1', () => resolve(s));
        s.on('error', err => {
            reject(err.code === 'EADDRINUSE'
                ? new SpotifyAuthError('port_in_use', `Port ${port} is already in use. Close whatever is using it and try again.`)
                : err);
        });
    });

    const authorizeUrl = `${AUTHORIZE_URL}?` + new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES,
        state
    });

    return {
        authorizeUrl,
        redirectUri,
        completion,
        close: () => new Promise(done => server.close(done))
    };
}

module.exports = { startSpotifyAuth, SpotifyAuthError, SCOPES };
