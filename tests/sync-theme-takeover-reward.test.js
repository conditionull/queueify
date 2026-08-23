const assert = require('assert');
const test = require('node:test');

const syncServicePath = require.resolve('../services/syncThemeTakeoverReward');
const setRewardEnabledPath = require.resolve('../services/setRewardEnabled');

function loadSyncThemeTakeoverReward(setRewardEnabled) {
    require.cache[setRewardEnabledPath] = {
        id: setRewardEnabledPath,
        filename: setRewardEnabledPath,
        loaded: true,
        exports: setRewardEnabled
    };
    delete require.cache[syncServicePath];
    return require('../services/syncThemeTakeoverReward').syncThemeTakeoverReward;
}

test('disables Theme Takeover for the minimal widget theme', async () => {
    const calls = [];
    const syncThemeTakeoverReward = loadSyncThemeTakeoverReward(async (...args) => calls.push(args));

    assert.strictEqual(await syncThemeTakeoverReward({
        broadcasterId: 'broadcaster', rewardId: 'reward', theme: 'minimal'
    }), false);
    assert.deepStrictEqual(calls, [['broadcaster', 'reward', false]]);
});

test('enables Theme Takeover for a compatible widget theme', async () => {
    const calls = [];
    const syncThemeTakeoverReward = loadSyncThemeTakeoverReward(async (...args) => calls.push(args));

    assert.strictEqual(await syncThemeTakeoverReward({
        broadcasterId: 'broadcaster', rewardId: 'reward', theme: 'swag'
    }), true);
    assert.deepStrictEqual(calls, [['broadcaster', 'reward', true]]);
});