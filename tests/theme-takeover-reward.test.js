const assert = require('assert');
const test = require('node:test');

const { createThemeTakeoverReward } = require('../services/themeTakeoverReward');

function createHandler({ result = { theme: 'swag' } } = {}) {
    const sent = [];
    const refunds = [];
    const activations = [];
    const handler = createThemeTakeoverReward({
        activateThemeTakeover: async (...args) => {
            activations.push(args);
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

    await handler(rewardContext('missing-theme'));

    assert.deepStrictEqual(refunds, [['redemption', 'broadcaster', 'reward']]);
    assert.deepStrictEqual(sent, [{
        channel: '#channel',
        key: 'reward.themeTakeoverFailed',
        values: { username: 'viewer', refundSuffix: ' (points refunded)' }
    }]);
});