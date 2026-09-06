const assert = require('assert');
const test = require('node:test');

const obs = require('../services/obs');
const { message } = require('../services/messages');

function obsError(code, details) {
    const err = new Error('boom');
    err.code = code;
    err.obs = details;
    return err;
}

test('every OBS failure names the setting to fix, in chat', () => {
    const cases = [
        [obsError('obs_not_configured', { ip: '', port: '4455' }), /http:\/\/127\.0\.0\.1:\d+/],
        [obsError('obs_target_missing', { ip: '127.0.0.1', port: '4455' }), /http:\/\/127\.0\.0\.1:\d+/],
        [obsError('obs_unreachable', { ip: '127.0.0.1', port: '4455' }), /127\.0\.0\.1:4455/],
        [obsError('obs_scene_missing', { scene: 'Gaming' }), /Gaming/],
        [obsError('obs_source_missing', { scene: 'Gaming', source: 'Queueify' }), /Queueify/]
    ];

    for (const [err, expected] of cases) {
        const described = obs.describeFailure(err);
        assert.ok(described, `${err.code} should map to a chat message`);

        const text = message(described.key, { username: 'viewer', ...described.values });
        assert.ok(text, `${described.key} is missing from the message catalogue`);
        assert.match(text, expected);
        assert.ok(!text.includes('{{'), `${described.key} left a placeholder unfilled: ${text}`);
    }
});

test('the dashboard address in the guidance follows SETUP_PORT', () => {
    process.env.SETUP_PORT = '3456';

    try {
        const described = obs.describeFailure(obsError('obs_scene_missing', { scene: 'Gaming' }));
        const text = message(described.key, { username: 'viewer', ...described.values });
        assert.match(text, /http:\/\/127\.0\.0\.1:3456/);
    } finally {
        delete process.env.SETUP_PORT;
    }
});

test('failures that are not about OBS settings are left to the generic handler', () => {
    assert.strictEqual(obs.describeFailure(new Error('socket exploded')), null);
    assert.strictEqual(obs.describeFailure(undefined), null);

    const twitchError = new Error('connect ETIMEDOUT');
    twitchError.code = 'ETIMEDOUT';
    assert.strictEqual(obs.describeFailure(twitchError), null);
});
