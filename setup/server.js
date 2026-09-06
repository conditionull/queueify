const express = require('express');
const fs = require('fs');
const path = require('path');

const { readEnv, updateEnv } = require('./envFile');
const { loadToken: loadTwitchToken, clearToken, TOKEN_FILE: TWITCH_TOKEN_FILE } = require('../twitch-token-store');
const { loadToken: loadSpotifyToken } = require('../spotify-token-store');
const {
    requestDeviceCode,
    pollForDeviceToken,
    getTokenIdentity,
    REQUIRED_SCOPES
} = require('../services/twitchDeviceAuth');
const { startSpotifyAuth } = require('../services/spotifyAuthFlow');
const { ensureSpotifyReward } = require('../services/createReward');
const obs = require('../services/obs');
const { repairSetupState } = require('../services/setupHealth');
const { DEFAULT_TWITCH_CLIENT_ID } = require('../config/twitchApp');
const { getObsConfig, getLiveValue, DEFAULT_DASHBOARD_PORT } = require('../config/liveEnv');
const themeStore = require('../services/themeStore');
const adminConfig = require('../services/adminConfig');
const { readChangelog } = require('../services/changelog');
const userSettings = require('../config/userSettings');
const widgetLayout = require('../services/widgetLayout');
const state = require('../core/state');

const DEFAULT_PORT = DEFAULT_DASHBOARD_PORT;
// Loopback only: this UI writes .env and holds OAuth tokens, so it must not be
// reachable from the LAN the way the widget server (0.0.0.0) intentionally is.
const HOST = '127.0.0.1';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Hostname from a `host` header or a URL authority, port removed. */
function hostnameOf(authority) {
    if (!authority) return '';
    // Keep bracketed IPv6 literals whole; strip a trailing :port from the rest.
    const match = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(authority.trim());
    return match ? match[1].toLowerCase() : '';
}

function isLoopbackOrigin(origin) {
    try {
        return LOOPBACK_HOSTNAMES.has(hostnameOf(new URL(origin).host));
    } catch {
        return false;
    }
}

/**
 * Binding to 127.0.0.1 keeps the LAN out, but not the user's own browser: this
 * server sits on a predictable port, and any page they have open can reach it.
 * It writes .env, holds OAuth tokens, and can wipe the Twitch login - so two
 * checks stand between a hostile page and that:
 *
 * Host - blocks DNS rebinding, where an attacker's hostname resolves to
 * 127.0.0.1 and every request from their page then looks same-origin.
 *
 * Origin - blocks cross-origin requests, notably form POSTs, which browsers
 * send without a preflight. The real UI is unaffected: a same-origin fetch
 * either omits Origin or sends our own.
 */
function guardLoopbackOnly(req, res, next) {
    if (!LOOPBACK_HOSTNAMES.has(hostnameOf(req.headers.host))) {
        res.status(403).json({ error: 'Setup only accepts requests addressed to localhost.' });
        return;
    }

    const origin = req.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) {
        res.status(403).json({ error: 'Setup only accepts requests from its own page.' });
        return;
    }

    next();
}

// A single in-flight Twitch device flow. Starting a new one supersedes the old.
let twitchFlow = null;
// Same for Spotify: one pending browser round trip at a time.
let spotifyFlow = null;
// Set once every required step is satisfied, so `npm start` can wait on it.
let onSetupComplete = null;
// Problems found by the startup health check, surfaced in the dashboard.
let healthIssues = [];

function setHealthIssues(issues) {
    healthIssues = issues || [];
}

function resetTwitchFlow() {
    if (twitchFlow?.controller) twitchFlow.controller.abort();
    twitchFlow = null;
}

async function resetSpotifyFlow() {
    if (spotifyFlow?.close) await spotifyFlow.close().catch(() => {});
    spotifyFlow = null;
}

/**
 * Enough to run: Twitch and Spotify.
 *
 * The channel point reward is deliberately not in here. Channel points need an
 * Affiliate or Partner channel, so plenty of people cannot make one at all,
 * and plenty more do not want one - requiring it meant the bot never started
 * for them. Chat requests work on their own.
 */
function setupIsComplete(status = buildStatus()) {
    return status.twitch.connected && status.spotify.connected;
}

function notifyIfComplete() {
    if (onSetupComplete && setupIsComplete()) {
        const done = onSetupComplete;
        onSetupComplete = null;
        done();
    }
}

function twitchStatus() {
    const env = readEnv();
    const token = loadTwitchToken();

    return {
        connected: Boolean(token.access_token),
        canRefresh: Boolean(token.refresh_token),
        clientId: Boolean(env.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID),
        broadcaster: env.TWITCH_BROADCASTER_USERNAME || process.env.TWITCH_BROADCASTER_USERNAME || '',
        identity: twitchFlow?.identity || null,
        tokenFile: TWITCH_TOKEN_FILE
    };
}

function spotifyStatus() {
    const env = readEnv();
    const token = loadSpotifyToken();

    return {
        connected: Boolean(token.refresh_token),
        clientId: Boolean(env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID),
        clientSecret: Boolean(env.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET)
    };
}

function rewardStatus() {
    try {
        const settingsFile = process.env.QUEUEIFY_SETTINGS_FILE || path.join(__dirname, '..', 'queue-settings.json');
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        return { created: Boolean(settings.spotifyRewardId) };
    } catch {
        return { created: false };
    }
}

function obsStatus() {
    const config = getObsConfig();

    return {
        // Reachable *and* pointed at a scene/source: anything less and the
        // widget commands cannot actually move anything.
        configured: config.configured,
        ip: config.ip,
        port: config.port,
        scene: config.scene,
        source: config.source,
        hasPassword: Boolean(config.password)
    };
}

function canvasStatus() {
    return { configured: Boolean(getLiveValue('SP_DC')) };
}


// Overridable so tests never reach a Queueify that happens to be running on
// this machine - hitting the real widget server would change a live overlay.
const WIDGET_URL = process.env.QUEUEIFY_WIDGET_URL || 'http://localhost:3001';
const WIDGET_CONFIG_FILE = process.env.QUEUEIFY_WIDGET_CONFIG_FILE || path.join(__dirname, '..', 'widget', 'config.json');

function readWidgetConfig() {
    try {
        return JSON.parse(fs.readFileSync(WIDGET_CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}



function widgetStatus() {
    // One definition of "the size this widget needs", shared with the code
    // that puts OBS right.
    const config = readWidgetConfig();
    const needed = widgetLayout.requiredSize(config);

    return {
        url: WIDGET_URL,
        renderScale: needed.renderScale,
        width: Math.round(needed.width),
        height: Math.round(needed.height),
        baseWidth: needed.designWidth,
        baseHeight: needed.designHeight,
        fromTheme: Boolean(themeStore.canvasSizeOf(needed.theme))
    };
}

/**
 * Changes widget config through the widget server when it is up, so its cached
 * copy and its connected widgets stay in step. `npm run setup` on its own has
 * no widget server, and then the file is the only copy there is.
 *
 * `fallback` mutates the config object that gets written in that second case.
 */
async function updateWidgetConfig(endpoint, body, fallback) {
    try {
        const res = await fetch(`${WIDGET_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) return { live: true };

        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || `Widget server refused the change (${res.status})`);
    } catch (err) {
        if (err instanceof TypeError || err.cause) {
            const config = readWidgetConfig();
            fallback(config);
            fs.writeFileSync(WIDGET_CONFIG_FILE, JSON.stringify(config, null, 4));
            return { live: false };
        }
        throw err;
    }
}

function activateTheme(theme) {
    return updateWidgetConfig('/api/widget/theme', { theme }, config => {
        config.theme = theme;
    });
}

function themeError(res, err) {
    const status = err.code === 'not_found' ? 404
        : ['invalid_name', 'not_editable', 'invalid_theme'].includes(err.code) ? 400
        : 500;

    res.status(status).json({ error: err.message, code: err.code || 'error' });
}

function themeError(res, err) {
    const status = err.code === 'not_found' ? 404
        : ['invalid_name', 'not_editable', 'invalid_theme'].includes(err.code) ? 400
        : 500;

    res.status(status).json({ error: err.message, code: err.code || 'error' });
}

/**
 * Saved !tr / !bc presets hold the scale the item had at the old resolution.
 * Left alone, recalling one after a resolution change would resize the widget
 * on screen, so they move by the same factor the scene item just did.
 */
function rescaleWidgetPresets(factorX, factorY) {
    if (factorX === 1 && factorY === 1) return 0;

    let changed = 0;

    for (const preset of Object.values(state.widgetPresets || {})) {
        if (!preset) continue;
        if (typeof preset.scaleX === 'number') preset.scaleX *= factorX;
        if (typeof preset.scaleY === 'number') preset.scaleY *= factorY;
        changed++;
    }

    if (changed) state.saveSettings();
    return changed;
}

function buildStatus() {
    const env = readEnv();
    const customClientId = env.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || '';

    const status = {
        issues: healthIssues,
        // A pre-existing install still pinned to its own Twitch app: it works,
        // but it misses out on the built-in app's tokenless setup.
        legacyClientId: Boolean(customClientId && customClientId !== DEFAULT_TWITCH_CLIENT_ID),
        twitch: twitchStatus(),
        spotify: spotifyStatus(),
        reward: rewardStatus(),
        obs: obsStatus(),
        canvas: canvasStatus(),
        widget: widgetStatus()
    };

    status.complete = setupIsComplete(status);
    return status;
}

function createApp() {
    const app = express();
    // Before the body parser: a rejected request should not be parsed at all.
    app.use(guardLoopbackOnly);
    app.use(express.json());

    /**
     * What has changed, for the "What's new" page. Read from CHANGELOG.md on
     * every request so an update is visible without restarting the dashboard.
     */
    app.get('/api/changelog', (req, res) => {
        res.json({
            version: require('../package.json').version,
            releases: readChangelog()
        });
    });

    app.get('/api/status', (req, res) => {
        res.json(buildStatus());
    });

    app.post('/api/twitch/start', async (req, res) => {
        resetTwitchFlow();

        const controller = new AbortController();
        const flow = {
            controller,
            state: 'pending',
            error: null,
            identity: null,
            prompt: null
        };
        twitchFlow = flow;

        try {
            const prompt = await requestDeviceCode({ scopes: REQUIRED_SCOPES, signal: controller.signal });
            flow.prompt = prompt;

            // Poll in the background; the browser watches /api/twitch/status.
            pollForDeviceToken(prompt, { signal: controller.signal })
                .then(async result => {
                    if (twitchFlow !== flow) return;
                    flow.identity = await getTokenIdentity(result.accessToken, prompt.clientId);
                    flow.missingScopes = result.missingScopes;
                    flow.canRefresh = Boolean(result.refreshToken);
                    flow.state = 'complete';
                    notifyIfComplete();
                })
                .catch(err => {
                    if (twitchFlow !== flow) return;
                    flow.state = 'error';
                    flow.error = { code: err.code || 'unknown', message: err.message };
                });

            res.json({
                userCode: prompt.userCode,
                verificationUri: prompt.verificationUri,
                expiresAt: prompt.expiresAt
            });
        } catch (err) {
            flow.state = 'error';
            flow.error = { code: err.code || 'unknown', message: err.message };
            res.status(400).json(flow.error);
        }
    });

    app.get('/api/twitch/status', (req, res) => {
        if (!twitchFlow) {
            res.json({ state: 'idle' });
            return;
        }

        res.json({
            state: twitchFlow.state,
            error: twitchFlow.error,
            identity: twitchFlow.identity,
            missingScopes: twitchFlow.missingScopes || [],
            canRefresh: twitchFlow.canRefresh !== false,
            userCode: twitchFlow.prompt?.userCode || null,
            verificationUri: twitchFlow.prompt?.verificationUri || null,
            expiresAt: twitchFlow.prompt?.expiresAt || null
        });
    });

    app.post('/api/twitch/cancel', (req, res) => {
        resetTwitchFlow();
        res.json({ ok: true });
    });

    app.post('/api/spotify/start', async (req, res) => {
        await resetSpotifyFlow();

        try {
            const flow = await startSpotifyAuth();
            spotifyFlow = { ...flow, state: 'pending', error: null };

            flow.completion.then(async result => {
                if (!spotifyFlow) return;
                if (result.ok) {
                    spotifyFlow.state = 'complete';
                    // Nothing else will arrive on the redirect URI, so give the
                    // port back - `node auth.js` uses the same one. A failed
                    // attempt deliberately keeps the server up to be retried.
                    await flow.close().catch(() => {});
                    notifyIfComplete();
                } else {
                    spotifyFlow.state = 'error';
                    spotifyFlow.error = result.error;
                }
            });

            res.json({ authorizeUrl: flow.authorizeUrl, redirectUri: flow.redirectUri });
        } catch (err) {
            res.status(400).json({ code: err.code || 'unknown', message: err.message });
        }
    });

    app.get('/api/spotify/status', (req, res) => {
        if (!spotifyFlow) {
            res.json({ state: 'idle' });
            return;
        }
        res.json({ state: spotifyFlow.state, error: spotifyFlow.error });
    });

    app.post('/api/reward/create', async (req, res) => {
        try {
            const reward = await ensureSpotifyReward();
            notifyIfComplete();
            res.json(reward);
        } catch (err) {
            res.status(400).json({ message: err.message });
        }
    });

    // Clean slate for the Twitch half only: drops the old app's credentials
    // and reward link so the user can reconnect against the built-in app.
    // Spotify and all queue settings are left untouched.
    //
    // This is the most destructive thing the dashboard can do, so it will not
    // act on a bare POST: the caller has to say so explicitly. That keeps a
    // stray or replayed request - which carries no body - from unlinking a
    // working setup, and pairs with the cross-origin guard above.
    app.post('/api/migrate/twitch', (req, res) => {
        if (req.body?.confirm !== true) {
            res.status(400).json({ message: 'Switching Twitch applications must be confirmed explicitly.' });
            return;
        }

        try {
            updateEnv({
                TWITCH_CLIENT_ID: '',
                TWITCH_CLIENT_SECRET: '',
                TWITCH_ACCESS_TOKEN: '',
                TWITCH_REFRESH_TOKEN: ''
            });
            delete process.env.TWITCH_CLIENT_ID;
            delete process.env.TWITCH_CLIENT_SECRET;

            clearToken();
            state.forgetSpotifyReward();
            setHealthIssues([]);

            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    app.post('/api/obs/test', async (req, res) => {
        const { ip, port, password } = req.body || {};

        if (!ip || !port) {
            res.status(400).json({ ok: false, error: 'Enter the OBS WebSocket IP and port.' });
            return;
        }

        try {
            res.json(await obs.testConnection({ ip, port, password }));
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // Checks the saved sp_dc cookie against Spotify. Loaded lazily: importing
    // the Canvas service starts its TOTP refresh, which setup has no use for
    // unless the user actually asks for this check.
    app.post('/api/canvas/test', async (req, res) => {
        try {
            const { verifyCookie } = await import('../Spotify-Canvas-API/services/spotifyAuthService.js');
            res.json(await verifyCookie());
        } catch (err) {
            res.status(500).json({ ok: false, reason: 'request_failed', message: err.message });
        }
    });

    // Built from the command modules themselves, so the list cannot drift
    // from what chat actually answers to.
    app.get('/api/commands', (req, res) => {
        try {
            const { buildCatalogue } = require('../services/commandCatalogue');
            res.json({ groups: buildCatalogue() });
        } catch (err) {
            res.status(500).json({ error: `Could not read the command list: ${err.message}` });
        }
    });

    // Makes the OBS browser source match a design, rather than asking the
    // user to shrink the design to fit the source.
    app.post('/api/widget/source-size', async (req, res) => {
        const width = Number(req.body?.width);
        const height = Number(req.body?.height);

        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 120 || height < 40) {
            res.status(400).json({ error: 'Give a width of at least 120 and a height of at least 40.' });
            return;
        }

        if (!getObsConfig().configured) {
            res.status(400).json({ error: 'OBS is not connected, so the browser source cannot be resized from here.' });
            return;
        }

        try {
            // Make the item that size on the canvas, then let the usual sizing
            // work out how many pixels to render it with.
            const applied = await obs.setWidgetResolution({ width, height });
            const presetsAdjusted = widgetLayout.rescalePresets(applied.factorX, applied.factorY);

            const matched = await widgetLayout.reconcile();

            res.json({
                ok: true,
                width: matched.applied ? matched.width : applied.width,
                height: matched.applied ? matched.height : applied.height,
                renderScale: matched.applied ? matched.renderScale : 1,
                presetsAdjusted: presetsAdjusted + (matched.presetsAdjusted || 0)
            });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // ---- Admin pages ---------------------------------------------------

    function adminError(res, err) {
        const status = err.code === 'invalid_config' ? 400 : 500;
        res.status(status).json({ error: err.message });
    }

    app.get('/api/admin/settings', (req, res) => {
        try {
            res.json({
                fields: adminConfig.QUEUE_FIELDS,
                queue: adminConfig.readQueueSettings(),
                whitelist: userSettings.allowedUsers,
                whitelistFile: userSettings.SETTINGS_FILE,
                widget: widgetStatus(),
                themes: [],
                obs: obsStatus(),
                canvas: canvasStatus()
            });
        } catch (err) {
            adminError(res, err);
        }
    });

    app.put('/api/admin/settings', async (req, res) => {
        try {
            // The whitelist first: the queue settings can be refused by Twitch,
            // and there is no reason for that to lose an unrelated edit.
            let whitelist = userSettings.allowedUsers;
            if (Array.isArray(req.body?.whitelist)) {
                whitelist = adminConfig.writeWhitelist(req.body.whitelist);
            }

            const result = await adminConfig.writeQueueSettings(req.body?.queue || {});

            res.json({ ok: true, changed: result.changed, whitelist, queue: adminConfig.readQueueSettings() });
        } catch (err) {
            adminError(res, err);
        }
    });

    app.get('/api/admin/aliases', (req, res) => {
        try {
            res.json({ commands: adminConfig.readAliases(), file: adminConfig.ALIASES_FILE });
        } catch (err) {
            adminError(res, err);
        }
    });

    app.put('/api/admin/aliases', async (req, res) => {
        try {
            res.json({ ok: true, aliases: await adminConfig.writeAliases(req.body?.aliases || {}) });
        } catch (err) {
            adminError(res, err);
        }
    });

    app.get('/api/admin/messages', (req, res) => {
        try {
            res.json({ groups: adminConfig.readMessages(), file: adminConfig.MESSAGES_FILE });
        } catch (err) {
            adminError(res, err);
        }
    });

    app.put('/api/admin/messages', async (req, res) => {
        try {
            await adminConfig.writeMessages(req.body?.messages || {});
            res.json({ ok: true, groups: adminConfig.readMessages() });
        } catch (err) {
            adminError(res, err);
        }
    });

    // ---- Theme editor -------------------------------------------------

    app.get('/api/themes', async (req, res) => {
        try {
            res.json({
                themes: await themeStore.listThemes(),
                active: readWidgetConfig().theme || 'default',
                defaults: themeStore.defaultModel(),
                presets: themeStore.listPresets(),
                fonts: themeStore.FONTS,
                fontCategories: themeStore.FONT_CATEGORIES
            });
        } catch (err) {
            themeError(res, err);
        }
    });

    app.get('/api/themes/:name', async (req, res) => {
        try {
            res.json({ name: req.params.name, model: await themeStore.readModel(req.params.name) });
        } catch (err) {
            themeError(res, err);
        }
    });

    app.put('/api/themes/:name', async (req, res) => {
        try {
            const saved = await themeStore.saveTheme(req.params.name, req.body?.model);

            // Saving over the theme that is on screen should show up there
            // straight away, which a re-activate does by reloading the widget.
            let reloaded = false;
            let obsResult = null;

            if (readWidgetConfig().theme === saved.name) {
                reloaded = (await activateTheme(saved.name).catch(() => ({ live: false }))).live;
                // Same design, possibly a new canvas size - and OBS needs to
                // reload the page to show the change either way.
                obsResult = await widgetLayout.reconcile();
            }

            res.json({ ...saved, reloaded, obs: obsResult });
        } catch (err) {
            themeError(res, err);
        }
    });

    app.delete('/api/themes/:name', async (req, res) => {
        try {
            const removed = await themeStore.deleteTheme(req.params.name);

            // Never leave the widget pointing at a theme that is gone.
            let switchedTo = null;
            if (readWidgetConfig().theme === removed.name) {
                switchedTo = 'default';
                await activateTheme(switchedTo).catch(() => {});
            }

            res.json({ ...removed, switchedTo });
        } catch (err) {
            themeError(res, err);
        }
    });

    app.post('/api/themes/:name/activate', async (req, res) => {
        try {
            if (!themeStore.exists(req.params.name)) {
                throw new themeStore.ThemeError(`There is no theme called "${req.params.name}".`, 'not_found');
            }

            const { live } = await activateTheme(req.params.name);

            // The new theme may be a different size, and an OBS source that
            // was suspended will not have heard the widget's own reload.
            const obsResult = await widgetLayout.reconcile();

            res.json({ active: req.params.name, live, obs: obsResult });
        } catch (err) {
            themeError(res, err);
        }
    });

    // The preview is styled by the very same generator that writes the file,
    // so what the editor shows cannot drift from what the widget renders.
    app.post('/api/themes-preview/css', (req, res) => {
        try {
            const model = themeStore.normalizeModel(req.body?.model);
            res.json({ css: themeStore.generateCss(model), model });
        } catch (err) {
            themeError(res, err);
        }
    });

    // The editor previews against the real song when the widget server is up,
    // and against a sample track when it is not, so it always shows something.
    app.get('/api/themes-preview/song', async (req, res) => {
        try {
            const upstream = await fetch(`${WIDGET_URL}/api/widget/song`);
            const song = await upstream.json();
            if (song && song.title) {
                res.json({ ...song, sample: false });
                return;
            }
        } catch {
            // Falls through to the sample below.
        }

        res.json({
            sample: true,
            isPlaying: true,
            title: 'Every Little Thing She Does Is Magic',
            artist: 'The Police',
            cover: null,
            progressMs: 62000,
            durationMs: 261000,
            palette: {
                vibrant: '#7c5cff',
                darkMuted: '#171423',
                lightVibrant: '#e9e2ff',
                muted: 'rgba(255,255,255,.72)'
            }
        });
    });

    // How sharp the widget is is not a setting any more - Queueify sizes the
    // browser source for the design and the space it is shown in. This just
    // re-runs that, for the dashboard's "check it again" button.
    app.post('/api/widget/rematch', async (req, res) => {
        const result = await widgetLayout.reconcile();

        if (!result.applied && result.reason === 'obs_not_configured') {
            res.status(400).json({ error: 'OBS is not connected, so there is nothing to resize.' });
            return;
        }

        if (!result.applied) {
            res.status(400).json({ error: result.message || 'OBS could not be updated.' });
            return;
        }

        res.json(result);
    });

    app.post('/api/env', (req, res) => {
        const updates = req.body || {};
        const allowed = [
            'TWITCH_CLIENT_ID',
            'TWITCH_BROADCASTER_USERNAME',
            'TWITCH_BOT_USERNAME',
            'SPOTIFY_CLIENT_ID',
            'SPOTIFY_CLIENT_SECRET',
            'SPOTIFY_REWARD_NAME',
            'OBS_WEBSOCKET_IP',
            'OBS_WEBSOCKET_PORT',
            'OBS_WEBSOCKET_PASSWORD',
            'OBS_SCENE',
            'OBS_SOURCE',
            'SP_DC'
        ];

        const filtered = {};
        for (const [key, value] of Object.entries(updates)) {
            if (allowed.includes(key) && typeof value === 'string') {
                filtered[key] = value.trim();
            }
        }

        if (!Object.keys(filtered).length) {
            res.status(400).json({ error: 'No supported settings provided' });
            return;
        }

        try {
            updateEnv(filtered);
            res.json({ ok: true, saved: Object.keys(filtered) });
        } catch (err) {
            // A rejected value is the user's paste, not a broken install.
            if (err.code === 'invalid_value') {
                res.status(400).json({ error: err.message });
                return;
            }
            res.status(500).json({ error: `Could not write .env: ${err.message}` });
        }
    });

    app.use(express.static(path.join(__dirname, 'public')));
    // The README's screenshots double as the setup page's walkthrough images.
    app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

    return app;
}

function startSetupServer({ port = Number(process.env.SETUP_PORT) || DEFAULT_PORT } = {}) {
    const app = createApp();

    return new Promise((resolve, reject) => {
        const server = app.listen(port, HOST, () => {
            resolve({
                server,
                url: `http://${HOST}:${port}`,
                close: () => new Promise(done => server.close(done))
            });
        });

        server.on('error', reject);
    });
}

/**
 * Resolves once Twitch, Spotify and the reward are all configured.
 *
 * Polls rather than relying only on the completion signal: status is derived
 * from files that are written with a debounce, so a step can finish moments
 * before its state is readable on disk. Polling also covers setup being
 * completed by a different process.
 */
function waitForSetup({ intervalMs = 1000 } = {}) {
    if (setupIsComplete()) return Promise.resolve();

    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (!setupIsComplete()) return;
            clearInterval(timer);
            resolve();
        }, intervalMs);

        onSetupComplete = () => {
            clearInterval(timer);
            resolve();
        };
    });
}

module.exports = {
    createApp,
    repairSetupState,
    setHealthIssues,
    startSetupServer,
    buildStatus,
    setupIsComplete,
    waitForSetup,
    DEFAULT_PORT
};
