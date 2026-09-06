const obs = require('./obs');
const { sayMessage } = require('./messages');

/**
 * Turns an OBS failure into a chat reply that names the setting to fix.
 *
 * Returns false for anything that is not an OBS configuration problem, so the
 * caller can rethrow and let the generic command handler deal with it.
 */
function reportObsFailure(client, channel, username, err) {
    const described = obs.describeFailure(err);
    if (!described) return false;

    console.warn(`OBS command failed: ${err.message}`);
    sayMessage(client, channel, described.key, { username, ...described.values });

    return true;
}

module.exports = { reportObsFailure };
