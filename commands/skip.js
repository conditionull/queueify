const { skipToNext } = require('../spotify');
const { sayMessage } = require('../services/messages');

module.exports = {
    name: 'skip',
    modOnly: true,

    async execute({ client, channel }) {
        const skipped = await skipToNext();
        sayMessage(client, channel, skipped ? 'playback.skipped' : 'playback.skipFailed');
    }
};