const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// A dead port, so nothing here can reach a Queueify the user is running.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const MODULES = [
    path.join(__dirname, '..', 'services', 'history.js'),
    path.join(__dirname, '..', 'services', 'analytics.js'),
    path.join(__dirname, '..', 'services', 'widgetLayout.js'),
    path.join(__dirname, '..', 'setup', 'server.js')
];

/**
 * A dashboard served from a sandbox, with the request log seeded.
 *
 * Every path the server resolves at load has to be redirected before the
 * require, so the cache is cleared each time round.
 */
async function withServer(events, run) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-stats-'));

    process.env.QUEUEIFY_DATA_DIR = sandbox;
    process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'queue-history.jsonl');
    process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
    fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, '{}');

    if (events) {
        fs.writeFileSync(
            process.env.QUEUEIFY_HISTORY_FILE,
            events.map(event => JSON.stringify(event)).join('\n') + '\n'
        );
    }

    for (const modulePath of MODULES) delete require.cache[require.resolve(modulePath)];

    const { createApp } = require('../setup/server');
    const server = await new Promise(resolve => {
        const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise(done => server.close(done));
        delete process.env.QUEUEIFY_DATA_DIR;
        delete process.env.QUEUEIFY_HISTORY_FILE;
        delete process.env.QUEUEIFY_WIDGET_CONFIG_FILE;
        for (const modulePath of MODULES) delete require.cache[require.resolve(modulePath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

function sample() {
    const base = Date.parse('2026-09-01T20:00:00.000Z');
    const at = ms => new Date(base + ms).toISOString();

    const track = {
        id: 'T1', isrc: 'ISRC1', name: 'Around the World',
        artists: [{ id: 'ART1', name: 'Daft Punk' }],
        albumId: 'ALB1', albumName: 'Homework', releaseDate: '1997-01-20',
        durationMs: 240000, explicit: false, popularity: 70
    };

    const user = { id: '111', login: 'nyx', display: 'NyxTheCat' };

    return [
        { v: 1, t: at(0), type: 'request', outcome: 'ok', source: 'chat', user, track, queuePosition: 1 },
        { v: 1, t: at(60000), type: 'request', outcome: 'cooldown', source: 'chat', user },
        { v: 1, t: at(120000), type: 'play', trackId: 'T1', name: 'Around the World', artists: 'Daft Punk', durationMs: 240000, queuedBy: 'nyx', queuedAt: at(0) }
    ];
}

test('overview counts what is in the log', async () => {
    await withServer(sample(), async origin => {
        const res = await fetch(`${origin}/api/stats/overview`);
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.empty, false);
        assert.strictEqual(body.totals.requests, 2);
        assert.strictEqual(body.totals.accepted, 1);
        assert.strictEqual(body.totals.plays, 1);
        assert.strictEqual(body.totals.sessions, 1);
        assert.strictEqual(body.acceptanceRate, 0.5);
        assert.strictEqual(body.queuedMs, 240000);
        assert.deepStrictEqual(body.sources, { chat: 2, redeem: 0 });
    });
});

test('leaderboards name the people and the tracks', async () => {
    await withServer(sample(), async origin => {
        const body = await (await fetch(`${origin}/api/stats/leaderboards`)).json();

        assert.strictEqual(body.topRequesters[0].name, 'NyxTheCat');
        assert.strictEqual(body.topRequesters[0].accepted, 1);
        assert.strictEqual(body.topTracks[0].name, 'Around the World');
        assert.strictEqual(body.topArtists[0].name, 'Daft Punk');
    });
});

test('sessions come back newest first, with the stream summarized', async () => {
    await withServer(sample(), async origin => {
        const body = await (await fetch(`${origin}/api/stats/sessions`)).json();

        assert.strictEqual(body.sessions.length, 1);
        assert.strictEqual(body.sessions[0].accepted, 1);
        assert.strictEqual(body.sessions[0].viewers, 1);
        assert.strictEqual(body.sessions[0].topRequester.name, 'NyxTheCat');
    });
});

test('an install that has never recorded anything answers, rather than failing', async () => {
    await withServer(null, async origin => {
        for (const route of ['overview', 'leaderboards', 'sessions']) {
            const res = await fetch(`${origin}/api/stats/${route}`);
            assert.strictEqual(res.status, 200, `${route} should answer on an empty log`);

            const text = await res.text();
            assert.ok(!/NaN/.test(text), `${route} put a NaN on the page: ${text}`);
        }

        const overview = await (await fetch(`${origin}/api/stats/overview`)).json();
        assert.strictEqual(overview.empty, true);
        assert.strictEqual(overview.totals.requests, 0);
    });
});

test('the stats page is served', async () => {
    await withServer(null, async origin => {
        const res = await fetch(`${origin}/stats.html`);
        assert.strictEqual(res.status, 200);
        assert.match(await res.text(), /<title>/i);
    });
});

test('the request log is not reachable from another origin', async () => {
    await withServer(sample(), async origin => {
        const res = await fetch(`${origin}/api/stats/overview`, {
            headers: { Origin: 'http://evil.example' }
        });

        assert.strictEqual(res.status, 403, 'who requested what must not leave this machine');
    });
});

test('the request log is not reachable under a forged Host', async () => {
    await withServer(sample(), async origin => {
        const port = Number(new URL(origin).port);

        // fetch() refuses to set Host, so this goes out over raw http.
        const status = await new Promise((resolve, reject) => {
            const req = http.request(
                { host: '127.0.0.1', port, path: '/api/stats/overview', headers: { Host: 'evil.example' } },
                res => resolve(res.statusCode)
            );
            req.on('error', reject);
            req.end();
        });

        assert.strictEqual(status, 403);
    });
});
