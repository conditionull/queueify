const assert = require('assert');
const test = require('node:test');

const { createThemeTakeoverReward } = require('../services/themeTakeoverReward');

function createHandler({ result = { theme: 'swag' }, error = null } = {}) {
    const sent = [];
    const refunds = [];
    const activations = [];
    const handler = createThemeTakeoverReward({
        activateThemeTakeover: async (...args) => {
            activations.push(args);
            if (error) throw error;
            return result;
        },
        refundRedeem: async (...args) => {
            refunds.push(args);
            return true;
        },
        sayMessage: (client, channel, key, values) => sent.push({ channel, key, values })
    });

    return { handler, sent, refunds, activations };
}

function rewardContext(theme) {
    return {
        client: {}, channel: '#channel', username: 'viewer', theme,
        durationSeconds: 3600, redemptionId: 'redemption',
        broadcasterId: 'broadcaster', rewardId: 'reward'
    };
}

test('refunds a theme takeover reward with no theme input', async () => {
    const { handler, sent, refunds, activations } = createHandler();

    await handler(rewardContext('   '));

    assert.deepStrictEqual(activations, []);
    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverMissingTheme',
        values: { username: 'viewer', refundSuffix: ' (points refunded)' }
    }]);
});

test('starts a lowercased theme takeover for the configured duration', async () => {
    const { handler, sent, refunds, activations } = createHandler();

    await handler(rewardContext('SWAG'));

    assert.deepStrictEqual(activations, [['swag', 3600]]);
    assert.deepStrictEqual(refunds, []);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverStarted',
        values: { username: 'viewer', theme: 'swag', minutes: 60 }
    }]);
});

test('refunds a theme takeover reward when the widget rejects the theme', async () => {
    const { handler, sent, refunds } = createHandler({ result: null });

    await handler(rewardContext('swag'));

    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverFailed',
        values: { username: 'viewer', refundSuffix: ' (points refunded)' }
    }]);
});

test('refunds a theme takeover reward for the compact minimal theme', async () => {
    const { handler, sent, refunds, activations } = createHandler();

    await handler(rewardContext('minimal'));

    assert.deepStrictEqual(activations, []);
    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverInvalidTheme',
        values: { username: 'viewer', refundSuffix: ' (points refunded)' }
    }]);
});

test('explains when the current widget theme prevents a takeover', async () => {
    const error = new Error('BASE_THEME_UNSUPPORTED');
    error.code = 'BASE_THEME_UNSUPPORTED';
    error.theme = 'minimal';
    const { handler, sent, refunds } = createHandler({ error });

    await handler(rewardContext('swag'));

    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverBaseThemeUnsupported',
        values: { username: 'viewer', theme: 'minimal', refundSuffix: ' (points refunded)' }
    }]);
});

test('refunds when the requested theme is already active', async () => {
    const error = new Error('THEME_ALREADY_ACTIVE');
    error.code = 'THEME_ALREADY_ACTIVE';
    error.theme = 'swag';
    const { handler, sent, refunds } = createHandler({ error });

    await handler(rewardContext('swag'));

    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverAlreadyActive',
        values: { username: 'viewer', theme: 'swag', refundSuffix: ' (points refunded)' }
    }]);
});