const { skipToNext } = require('../spotify');
const { sayMessage } = require('../services/messages');
const history = require('../services/history');

module.exports = {
    name: 'skip',
    modOnly: true,

    async execute({ client, channel, username, state }) {
        const skipped = await skipToNext();
        sayMessage(client, channel, skipped ? 'playback.skipped' : 'playback.skipFailed');

        // Only the skips that went through chat. Most happen inside Spotify
        // itself and are invisible here, so this is a floor on the real number,
        // not the number.
        if (skipped) {
            history.recordSkip({
                trackId: state?.activeTrack?.id ?? null,
                name: state?.activeTrack?.name ?? null,
                by: username
            });
        }
    }
};