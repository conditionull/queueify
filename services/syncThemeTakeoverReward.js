const fs = require('fs');
const path = require('path');
const setRewardEnabled = require('./setRewardEnabled');
const { isThemeTakeoverTheme } = require('./themeTakeoverThemes');

const WIDGET_CONFIG_FILE = path.join(__dirname, '../widget/config.json');

function getCurrentWidgetTheme() {
    try {
        const config = JSON.parse(fs.readFileSync(WIDGET_CONFIG_FILE, 'utf8'));
        return config.theme || 'default';
    } catch (err) {
        console.warn('Failed to read widget theme config; using default:', err.message);
        return 'default';
    }
}

async function syncThemeTakeoverReward({ broadcasterId, rewardId, theme, enabled = true }) {
    if (!broadcasterId || !rewardId) {
        return false;
    }

    const currentTheme = theme || getCurrentWidgetTheme();
    const rewardEnabled = enabled && isThemeTakeoverTheme(currentTheme);

    await setRewardEnabled(broadcasterId, rewardId, rewardEnabled);
    return rewardEnabled;
}

module.exports = { syncThemeTakeoverReward };