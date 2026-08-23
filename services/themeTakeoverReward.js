const refundRedeem = require('./refundRedeem');
const { sayMessage } = require('./messages');

const WIDGET_URL = 'http://localhost:3001';

async function activateThemeTakeover(theme, durationSeconds) {
    const response = await fetch(`${WIDGET_URL}/api/widget/theme-takeover`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme, durationSeconds })
    });

    if (!response.ok) {
        throw new Error(`Widget theme takeover failed with status ${response.status}`);
    }

    return response.json();
}

function createThemeTakeoverReward(dependencies) {
    const {
        activateThemeTakeover: activate,
        refundRedeem: refund,
        sayMessage: say
    } = dependencies;
    let pending = Promise.resolve();

    async function reject({ client, channel, username, redemptionId, broadcasterId, rewardId, key, values = {} }) {
        const refunded = await refund(redemptionId, broadcasterId, rewardId);
        say(client, channel, key, {
            username,
            ...values,
            refundSuffix: refunded ? ' (points refunded)' : ''
        });
    }

    async function handle({ client, channel, username, theme, durationSeconds, redemptionId, broadcasterId, rewardId }) {
        const requestedTheme = theme.trim().toLowerCase();

        if (!requestedTheme) {
            await reject({
                client, channel, username, redemptionId, broadcasterId, rewardId,
                key: 'reward.themeTakeoverMissingTheme'
            });
            return;
        }

        try {
            const result = await activate(requestedTheme, durationSeconds);

            if (!result?.theme) {
                throw new Error('Widget did not confirm the theme takeover');
            }

            say(client, channel, 'reward.themeTakeoverStarted', {
                username,
                theme: result.theme,
                minutes: Math.ceil(durationSeconds / 60)
            });
        } catch (err) {
            console.error('Theme takeover reward failed:', err.message);
            await reject({
                client, channel, username, redemptionId, broadcasterId, rewardId,
                key: 'reward.themeTakeoverFailed'
            });
        }
    }

    return function themeTakeoverReward(context) {
        const result = pending.then(() => handle(context));
        pending = result.catch(() => {});
        return result;
    };
}

const themeTakeoverReward = createThemeTakeoverReward({
    activateThemeTakeover,
    refundRedeem,
    sayMessage
});

module.exports = themeTakeoverReward;
module.exports.createThemeTakeoverReward = createThemeTakeoverReward;