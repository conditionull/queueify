const assert = require('assert');
const test = require('node:test');

const { message, sayMessage } = require('../services/messages');
const unblockArtist = require('../commands/unblockartist');

test('formats editable chat messages with named values', () => {
    assert.strictEqual(
        message('queue.blockedArtist', { username: 'viewer', artist: '6lackddd' }),
        '@viewer the artist 6lackddd is blocked'
    );
});

test('routes a formatted message through the Twitch client', () => {
    const sent = [];
    const client = { say: (channel, text) => sent.push({ channel, text }) };

    sayMessage(client, '#channel', 'queue.added', {
        username: 'viewer',
        count: 3
    });

    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        text: '@viewer song added to queue!! DinoDance (3 in queue)'
    }]);
});

test('does not report an artist as unblocked when it was not listed', () => {
    const sent = [];
    let saveCount = 0;
    const client = { say: (channel, text) => sent.push({ channel, text }) };
    const state = {
        blockedArtists: new Set(),
        saveBlacklist: () => saveCount++
    };

    unblockArtist.execute({
        client,
        channel: '#channel',
        args: ['6lackddd'],
        state
    });

    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        text: 'artist was not blocked: 6lackddd'
    }]);
    assert.strictEqual(saveCount, 0);
});
