// Opens the setup dashboard against throwaway files so you can walk through
// the first-run experience without touching your real .env or tokens.
require('./helpers/ensureDependencies')();

const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-sandbox-'));

process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
process.env.TWITCH_TOKEN_FILE = path.join(sandbox, 'twitch-token.json');
process.env.SPOTIFY_TOKEN_FILE = path.join(sandbox, 'spotify-token.json');
process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
process.env.SETUP_PORT = process.env.SETUP_PORT || '3003';

// Deliberately skip dotenv: a real .env would leak into the "fresh" state.
for (const key of [
    'TWITCH_BROADCASTER_USERNAME', 'TWITCH_BOT_USERNAME',
    'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET',
    'OBS_WEBSOCKET_IP', 'OBS_WEBSOCKET_PORT', 'OBS_WEBSOCKET_PASSWORD',
    'OBS_SCENE', 'OBS_SOURCE'
]) {
    delete process.env[key];
}

const { startSetupServer } = require('./setup/server');
const openBrowser = require('./helpers/openBrowser');

(async () => {
    const { url, close } = await startSetupServer();

    console.log('');
    console.log(`  Sandbox setup:  ${url}`);
    console.log(`  Writing to:     ${sandbox}`);
    console.log('');
    console.log('  Your real .env and tokens are untouched. Ctrl+C to stop.');

    openBrowser(url);

    const shutdown = async () => {
        await close();
        fs.rmSync(sandbox, { recursive: true, force: true });
        console.log('\nSandbox removed.');
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
})();
