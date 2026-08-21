const obs = require("../services/obs");
const settings = require("../config/settings");
const state = require("../core/state");
const { sayMessage } = require('../services/messages');

async function getCurrentTheme() {
    try {
        const res = await fetch("http://localhost:3001/api/widget/config");
        if (!res.ok) return "default";

        const config = await res.json();
        return config.theme || "default";
    } catch (err) {
        return "default";
    }
}

function getThemePresetName(theme) {
    return theme ? `topright:${theme}` : "topright";
}

module.exports = {
    name: "topright",
    aliases: ["tr"],

    async execute({ client, channel, username, isMod, args }) {

        const isAllowedUser = settings.allowedUsers.includes(username);

        if (args[0] === "set") {
            if (!isMod) {
                sayMessage(client, channel, 'widget.topOnlyMods', { username });
                return;
            }

            const transform = await obs.getTransform();
            const theme = await getCurrentTheme();
            const presetName = getThemePresetName(theme);

            state.widgetPresets[presetName] = transform;
            state.saveSettings();

            sayMessage(client, channel, 'widget.topSaved', { theme });
            return;
        }

        if (!isMod && !isAllowedUser) {
            sayMessage(client, channel, 'widget.topPermission', { username });
            return;
        }

        const theme = await getCurrentTheme();
        const presetName = getThemePresetName(theme);
        const preset = state.widgetPresets[presetName] || state.widgetPresets.topright;

        if (!preset) {
            sayMessage(client, channel, 'widget.topMissing', { theme });
            return;
        }
        state.activeWidgetPosition = "topright";
        state.saveSettings();
        await obs.setTransform(preset);
    }
};