const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createUpNext, upcoming, requesterOf, withRequesters, QUEUE_TTL_MS } = require('../services/upNext');

/**
 * The widget's Up next row and "requested by".
 *
 * The row is the streamer's real Spotify queue, with chat's requests matched
 * back to who asked for them. A name is only given when it is certain - the
 * same rule !np follows.
 */

const item = (id, queuedBy = 'someone') => ({ id, name: 'Song ' + id, artists: 'Artist ' + id, cover: 'c' + id, queuedBy });

test('what is still to come skips the song playing and everything before it', () => {
    const queue = [item('a'), item('b'), item('c')];

    assert.deepStrictEqual(upcoming(queue, 'b').map(entry => entry.id), ['c']);
    assert.deepStrictEqual(upcoming(queue, 'a').map(entry => entry.id), ['b', 'c']);
    assert.deepStrictEqual(upcoming(queue, 'c'), []);
});

test('with the song playing not in the queue, none of the queue has started yet', () => {
    assert.deepStrictEqual(upcoming([item('a'), item('b')], 'x').map(entry => entry.id), ['a', 'b']);
    assert.deepStrictEqual(upcoming([item('a')], null).map(entry => entry.id), ['a']);
});

test('it is capped, and survives a queue that is not a list', () => {
    const long = Array.from({ length: 9 }, (_, at) => item(String(at)));

    assert.strictEqual(upcoming(long, null).length, 5);
    assert.strictEqual(upcoming(long, null, 2).length, 2);
    assert.deepStrictEqual(upcoming(undefined, 'a'), []);
    assert.deepStrictEqual(upcoming([null, item('a')], 'a'), []);
});

test('a requester is named only for the song Queueify queued for them', () => {
    const state = { activeTrack: { id: 'a', queuedBy: 'nightowl' }, pendingQueue: [item('b', 'lena')] };

    assert.strictEqual(requesterOf(state, 'a'), 'nightowl', 'the song that has been carried onto activeTrack');
    assert.strictEqual(requesterOf(state, 'b'), 'lena', 'the next request, just begun');
    assert.strictEqual(requesterOf(state, 'z'), null, 'something the streamer put on');
    assert.strictEqual(requesterOf({ activeTrack: null, pendingQueue: [item('a'), item('b', 'lena')] }, 'b'), null,
        'further down the list is not proof it came from there');
    assert.strictEqual(requesterOf(state, null), null);
});

/* ------------------------------------------------------ the Spotify queue */

const track = (id, extra = {}) => ({ id, name: 'Song ' + id, artists: 'Artist ' + id, cover: 'big' + id, thumb: 'small' + id, ...extra });

test('requests in Spotify\'s queue carry who asked for them, in order', () => {
    const pending = [item('a', 'nightowl'), item('b', 'lena'), item('a', 'toast')];
    const queue = [track('x'), track('a'), track('b'), track('a'), track('a')];

    assert.deepStrictEqual(withRequesters(queue, pending).map(song => [song.id, song.queuedBy]), [
        ['x', null],
        ['a', 'nightowl'],
        ['b', 'lena'],
        ['a', 'toast'],
        ['a', null]
    ]);
});

test('the widget gets the real queue, requests named, and nothing else', async () => {
    const state = { activeTrack: null, pendingQueue: [item('a', 'nightowl'), item('b', 'lena')] };
    const read = createUpNext({
        state,
        syncWithQueue: async () => ({ queue: [track('b'), track('z')] }),
        now: () => 0
    });

    assert.deepStrictEqual(await read({ id: 'a' }), {
        requester: 'nightowl',
        // Queued before perks, so it plays none. See tests/perks.test.js.
        perk: null,
        upNext: [
            { title: 'Song b', artist: 'Artist b', cover: 'smallb', requester: 'lena' },
            { title: 'Song z', artist: 'Artist z', cover: 'smallz', requester: null }
        ]
    });
});

test('the queue is kept for a few seconds, and asked again when a song or a request changes it', async () => {
    let clock = 0;
    let asks = 0;
    const state = { activeTrack: null, pendingQueue: [] };
    const read = createUpNext({ state, syncWithQueue: async () => { asks += 1; return { queue: [] }; }, now: () => clock });

    await read({ id: 'a' });
    await read({ id: 'a' });
    assert.strictEqual(asks, 1, 'kept');

    clock = 5000;
    await read({ id: 'b' });
    assert.strictEqual(asks, 2, 'a new song');

    state.pendingQueue.push(item('c'));
    await read({ id: 'b' });
    assert.strictEqual(asks, 3, 'a new request');

    clock = 5000 + QUEUE_TTL_MS + 1;
    await read({ id: 'b' });
    assert.strictEqual(asks, 4, 'and after a while regardless, for songs queued in Spotify itself');
});

test('several widgets asking at once cost one request', async () => {
    let asks = 0;
    const state = { activeTrack: null, pendingQueue: [] };
    const read = createUpNext({
        state,
        syncWithQueue: () => { asks += 1; return new Promise(done => setTimeout(() => done({ queue: [] }), 10)); },
        now: () => 0
    });

    await Promise.all([read({ id: 'a' }), read({ id: 'a' }), read({ id: 'a' })]);
    assert.strictEqual(asks, 1);
});

test('when Spotify cannot be asked, the requests Queueify knows about still show', async () => {
    const state = { activeTrack: null, pendingQueue: [item('a', 'nightowl'), item('b', 'lena')] };

    for (const failure of [async () => false, async () => { throw new Error('Spotify is down'); }]) {
        const read = createUpNext({ state, syncWithQueue: failure, now: () => 0 });
        assert.deepStrictEqual((await read({ id: 'a' })).upNext.map(song => song.title), ['Song b']);
    }
});

/* ------------------------------------------------ through the widget server */

test('the widget asks for the queue only when it shows one', async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-up-next-'));
    process.env.QUEUEIFY_THEMES_DIR = sandbox;
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    process.env.QUEUEIFY_WIDGET_PORT = '0';

    const spotifyPath = require.resolve('../spotify.js');
    const serverPath = require.resolve('../widget/server');
    const saved = require.cache[spotifyPath];
    delete require.cache[serverPath];
    require.cache[spotifyPath] = {
        id: spotifyPath, filename: spotifyPath, loaded: true,
        exports: {
            getCurrentTrack: async () => ({
                id: 'a', name: 'Now', artists: 'Them', cover: null, isPlaying: true,
                durationMs: 1000, progressMs: 10, fetchedAt: 0, palette: {}
            })
        }
    };

    const startWidgetServer = require('../widget/server');
    const asked = [];
    const server = await startWidgetServer({
        queue: async song => {
            asked.push(song.id);
            return { requester: 'nightowl', upNext: [{ title: 'Next', artist: 'Up', cover: null, requester: 'lena' }] };
        }
    });

    try {
        const base = `http://127.0.0.1:${server.address().port}`;

        const plain = await (await fetch(`${base}/api/widget/song`)).json();
        assert.deepStrictEqual(asked, [], 'a theme with no Up next never costs a queue request');
        assert.strictEqual(plain.upNext, undefined);

        const song = await (await fetch(`${base}/api/widget/song?queue=1`)).json();
        assert.deepStrictEqual(asked, ['a'], 'asked about the song playing');
        assert.strictEqual(song.title, 'Now');
        assert.strictEqual(song.requester, 'nightowl');
        assert.deepStrictEqual(song.upNext, [{ title: 'Next', artist: 'Up', cover: null, requester: 'lena' }]);
    } finally {
        await new Promise(done => server.close(done));
        delete require.cache[serverPath];
        if (saved) require.cache[spotifyPath] = saved;
        else delete require.cache[spotifyPath];
        for (const key of ['QUEUEIFY_THEMES_DIR', 'QUEUEIFY_WIDGET_CONFIG_FILE', 'QUEUEIFY_WIDGET_PORT']) delete process.env[key];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
});
