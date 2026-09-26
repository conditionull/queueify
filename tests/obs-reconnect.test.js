const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Not dependencies of ours; reached through obs-websocket-js, which needs them.
const fromObsClient = name => require(require.resolve(name, { paths: [require.resolve('obs-websocket-js')] }));
const WebSocket = fromObsClient('ws');
// The package's default entry speaks msgpack, not JSON, so the fake has to.
const { encode, decode } = fromObsClient('@msgpack/msgpack');

const modules = [
    path.join(__dirname, '..', 'setup', 'envFile.js'),
    path.join(__dirname, '..', 'config', 'liveEnv.js'),
    path.join(__dirname, '..', 'services', 'obs.js')
];

function bust() {
    for (const m of modules) delete require.cache[require.resolve(m)];
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

// Just enough of obs-websocket v5 to get a client identified: Hello, then
// Identified in answer to Identify.
function fakeObs(port) {
    const server = new WebSocket.Server({ host: '127.0.0.1', port, handleProtocols: () => 'obswebsocket.msgpack' });
    server.connections = 0;

    server.on('connection', socket => {
        server.connections++;
        socket.send(encode({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }));
        socket.on('message', raw => {
            if (decode(raw).op === 1) socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        });
    });

    return new Promise(resolve => server.once('listening', () => resolve(server)));
}

function closeObs(server) {
    for (const client of server.clients) client.terminate();
    return new Promise(resolve => server.close(resolve));
}

async function until(check, ms = 2000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withSandbox(run) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-obs-reconnect-'));
    const envFile = path.join(sandbox, '.env');
    const port = await freePort();

    process.env.QUEUEIFY_ENV_FILE = envFile;
    bust();
    const obs = require('../services/obs');

    const identified = [];
    obs.onConnected(() => identified.push(Date.now()));

    const log = console.log;
    console.log = () => {};
    let stop = () => {};
    let server = null;

    try {
        await run({
            obs,
            identified,
            port,
            setEnv: lines => fs.writeFileSync(envFile, lines.join('\n') + '\n'),
            keepConnected: options => { stop = obs.keepConnected(options); return stop; },
            openObs: async () => { server = await fakeObs(port); return server; },
            closeObs: async () => { await closeObs(server); server = null; }
        });
    } finally {
        stop();
        if (server) await closeObs(server);
        console.log = log;
        delete process.env.QUEUEIFY_ENV_FILE;
        bust();
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
}

test('connects when OBS opens later, and stops knocking once it is open', () => withSandbox(async lab => {
    lab.setEnv(['OBS_WEBSOCKET_IP=127.0.0.1', `OBS_WEBSOCKET_PORT=${lab.port}`]);
    lab.keepConnected({ retryMs: 40 });

    await pause(200);
    assert.strictEqual(lab.identified.length, 0, 'nothing is listening yet');

    const server = await lab.openObs();
    await until(() => lab.identified.length === 1);

    // Several retry intervals with OBS open: still the one connection.
    await pause(300);
    assert.strictEqual(server.connections, 1);
}));

test('reconnects after OBS is closed and reopened', () => withSandbox(async lab => {
    lab.setEnv(['OBS_WEBSOCKET_IP=127.0.0.1', `OBS_WEBSOCKET_PORT=${lab.port}`]);
    lab.keepConnected({ retryMs: 40 });

    await lab.openObs();
    await until(() => lab.identified.length === 1);

    await lab.closeObs();
    await until(() => !lab.obs.identified);
    await pause(200);

    const reopened = await lab.openObs();
    await until(() => lab.identified.length === 2);
    await pause(200);
    assert.strictEqual(reopened.connections, 1);
}));

test('OBS details added after boot are picked up without a restart', () => withSandbox(async lab => {
    lab.setEnv(['OBS_WEBSOCKET_IP=']);
    lab.keepConnected({ retryMs: 40 });

    const server = await lab.openObs();
    await pause(200);
    assert.strictEqual(server.connections, 0, 'no address, so nothing to knock on');

    lab.setEnv(['OBS_WEBSOCKET_IP=127.0.0.1', `OBS_WEBSOCKET_PORT=${lab.port}`]);
    await until(() => lab.identified.length === 1);
}));

test('stopping the loop stops the knocking', () => withSandbox(async lab => {
    lab.setEnv(['OBS_WEBSOCKET_IP=127.0.0.1', `OBS_WEBSOCKET_PORT=${lab.port}`]);
    lab.keepConnected({ retryMs: 40 })();

    const server = await lab.openObs();
    await pause(300);
    assert.strictEqual(server.connections, 0);
}));
