// Queueify's registered Twitch application (public client type).
//
// Client IDs are public by design - Twitch's docs state they "are considered
// public and can be embedded in a web page's source". There is no client
// secret: the device code flow used for login is a public-client flow, and
// Helix rate limits are applied per client ID *per user*, so every install
// gets its own bucket rather than sharing one.
//
// Set TWITCH_CLIENT_ID in .env to point Queueify at your own app instead.
const DEFAULT_TWITCH_CLIENT_ID = '0o55rqq21tii8am27wymksvpn1nh9k';

function getTwitchClientId() {
    return process.env.TWITCH_CLIENT_ID || DEFAULT_TWITCH_CLIENT_ID;
}

module.exports = { DEFAULT_TWITCH_CLIENT_ID, getTwitchClientId };
