const { readEnv } = require('../setup/envFile');

const DEFAULT_OBS_PORT = '4455';
// The dashboard the bot keeps serving while it runs.
const DEFAULT_DASHBOARD_PORT = 3002;

/**
 * Reads a setting straight off disk instead of trusting the boot-time copy.
 *
 * dotenv loads .env into process.env once, at startup. Users routinely fill in
 * the OBS block or the Spotify cookie *after* the bot has booted itself from
 * the setup page - and against a boot-time snapshot that edit does nothing
 * until they think to restart, which nothing in chat tells them. Reading the
 * file each time means a saved change takes effect on the next command.
 *
 * The file wins for any key it defines (it is what the user just edited, blank
 * values included); keys it does not mention fall back to the real
 * environment, so `OBS_SCENE=... npm start` still works.
 */
function getLiveValue(key) {
    let fileValues = {};

    try {
        fileValues = readEnv();
    } catch (err) {
        console.warn(`Could not read .env: ${err.message}`);
    }

    const value = key in fileValues ? fileValues[key] : process.env[key];
    return value || '';
}

/** Everything needed to talk to OBS, as it stands on disk right now. */
function getObsConfig() {
    const config = {
        ip: getLiveValue('OBS_WEBSOCKET_IP'),
        port: getLiveValue('OBS_WEBSOCKET_PORT') || DEFAULT_OBS_PORT,
        password: getLiveValue('OBS_WEBSOCKET_PASSWORD'),
        scene: getLiveValue('OBS_SCENE'),
        source: getLiveValue('OBS_SOURCE')
    };

    // The IP alone is enough to connect; the scene and source are what the
    // widget-position commands additionally need.
    config.connectable = Boolean(config.ip);
    config.configured = Boolean(config.ip && config.scene && config.source);

    return config;
}

/** Where the settings dashboard is reachable, honouring SETUP_PORT. */
function getDashboardUrl() {
    const port = Number(getLiveValue('SETUP_PORT')) || DEFAULT_DASHBOARD_PORT;
    return `http://127.0.0.1:${port}`;
}

module.exports = {
    getLiveValue,
    getObsConfig,
    getDashboardUrl,
    DEFAULT_OBS_PORT,
    DEFAULT_DASHBOARD_PORT
};
