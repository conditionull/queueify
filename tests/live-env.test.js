const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const liveEnvPath = path.join(__dirname, '..', 'config', 'liveEnv.js');
const envFilePath = path.join(__dirname, '..', 'setup', 'envFile.js');

function freshLiveEnv() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-live-env-'));
    const envFile = path.join(tempDir, '.env');

    process.env.QUEUEIFY_ENV_FILE = envFile;
    delete require.cache[require.resolve(envFilePath)];
    delete require.cache[require.resolve(liveEnvPath)];

    return { module: require(liveEnvPath), envFile };
}

function cleanup() {
    delete process.env.QUEUEIFY_ENV_FILE;
    delete require.cache[require.resolve(envFilePath)];
    delete require.cache[require.resolve(liveEnvPath)];
}

test('OBS settings written after startup are picked up without a restart', () => {
    const { module: liveEnv, envFile } = freshLiveEnv();

    try {
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=\n');
        assert.strictEqual(liveEnv.getObsConfig().connectable, false);

        // The exact thing that used to strand people: filling in .env while
        // the bot is already running.
        fs.writeFileSync(envFile, [
            'OBS_WEBSOCKET_IP=127.0.0.1',
            'OBS_WEBSOCKET_PORT=4455',
            'OBS_WEBSOCKET_PASSWORD=secret',
            'OBS_SCENE=Gaming',
            'OBS_SOURCE=Queueify'
        ].join('\n'));

        assert.deepStrictEqual(liveEnv.getObsConfig(), {
            ip: '127.0.0.1',
            port: '4455',
            password: 'secret',
            scene: 'Gaming',
            source: 'Queueify',
            connectable: true,
            configured: true
        });
    } finally {
        cleanup();
    }
});

test('a changed value replaces the one read a moment earlier', () => {
    const { module: liveEnv, envFile } = freshLiveEnv();

    try {
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Gaming\nOBS_SOURCE=Queueify\n');
        assert.strictEqual(liveEnv.getObsConfig().scene, 'Gaming');

        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Just Chatting\nOBS_SOURCE=Queueify\n');
        assert.strictEqual(liveEnv.getObsConfig().scene, 'Just Chatting');
    } finally {
        cleanup();
    }
});

test('the port falls back to the OBS default, but only when unset', () => {
    const { module: liveEnv, envFile } = freshLiveEnv();

    try {
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\n');
        assert.strictEqual(liveEnv.getObsConfig().port, '4455');

        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_WEBSOCKET_PORT=4460\n');
        assert.strictEqual(liveEnv.getObsConfig().port, '4460');
    } finally {
        cleanup();
    }
});

test('a scene and source are required before the widget commands count as configured', () => {
    const { module: liveEnv, envFile } = freshLiveEnv();

    try {
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Gaming\n');

        const config = liveEnv.getObsConfig();
        assert.strictEqual(config.connectable, true);
        assert.strictEqual(config.configured, false);
    } finally {
        cleanup();
    }
});

test('keys absent from .env still come from the real environment', () => {
    const { module: liveEnv, envFile } = freshLiveEnv();
    process.env.SP_DC = 'from-environment';

    try {
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\n');
        assert.strictEqual(liveEnv.getLiveValue('SP_DC'), 'from-environment');

        // ...and .env wins once it says something about them.
        fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nSP_DC=from-file\n');
        assert.strictEqual(liveEnv.getLiveValue('SP_DC'), 'from-file');
    } finally {
        delete process.env.SP_DC;
        cleanup();
    }
});

test('a missing .env is not an error', () => {
    const { module: liveEnv } = freshLiveEnv();

    try {
        assert.strictEqual(liveEnv.getObsConfig().connectable, false);
        assert.strictEqual(liveEnv.getLiveValue('SP_DC'), '');
    } finally {
        cleanup();
    }
});
