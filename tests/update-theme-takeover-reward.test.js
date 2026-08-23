const assert = require('assert');
const test = require('node:test');

const {
    buildThemeTakeoverPrompt,
    updateThemeTakeoverReward
} = require('../services/updateThemeTakeoverReward');

test('builds the Theme Takeover prompt from a default one-hour duration', () => {
    assert.strictEqual(
        buildThemeTakeoverPrompt(3600),
        'Choose a widget theme: default, minimal, or swag. Your change will last 60 minutes unless this reward is redeemed again.'
    );
});

test('updates the existing Theme Takeover reward prompt', async () => {
    const originalFetch = global.fetch;
    const requests = [];
    process.env.TWITCH_CLIENT_ID = 'client-id';
    process.env.TWITCH_ACCESS_TOKEN = 'access-token';

    global.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    try {
        assert.strictEqual(await updateThemeTakeoverReward('broadcaster', 'reward', 90), true);
        assert.deepStrictEqual(requests, [{
            url: 'https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=broadcaster&id=reward',
            options: {
                method: 'PATCH',
                headers: {
                    'Client-Id': 'client-id',
                    Authorization: 'Bearer access-token',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: 'Choose a widget theme: default, minimal, or swag. Your change will last 90 seconds unless this reward is redeemed again.'
                })
            }
        }]);
    } finally {
        global.fetch = originalFetch;
        delete process.env.TWITCH_CLIENT_ID;
        delete process.env.TWITCH_ACCESS_TOKEN;
    }
});