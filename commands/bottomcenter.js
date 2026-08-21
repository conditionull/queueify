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
    return theme ? `bottomcenter:${theme}` : "bottomcenter";
}

module.exports = {
    name: "bottomcenter",
    aliases: ["bc"],

    async execute({ client, channel, username, isMod, args }) {

        const isAllowedUser = settings.allowedUsers.includes(username);

        if (args[0] === "set") {
            if (!isMod) {
                sayMessage(client, channel, 'widget.bottomOnlyMods', { username });
                return;
            }

            const transform = await obs.getTransform();
            const theme = await getCurrentTheme();
            const presetName = getThemePresetName(theme);

            state.widgetPresets[presetName] = transform;
            state.saveSettings();

            sayMessage(client, channel, 'widget.bottomSaved', { theme });
            return;
        }

        if (!isMod && !isAllowedUser) {
            sayMessage(client, channel, 'widget.bottomPermission', { username });
            return;
        }

        const theme = await getCurrentTheme();
        const presetName = getThemePresetName(theme);
        const preset = state.widgetPresets[presetName] || state.widgetPresets.bottomcenter;

        if (!preset) {
            sayMessage(client, channel, 'widget.bottomMissing', { theme });
            return;
        }
        state.activeWidgetPosition = "bottomcenter";
        state.saveSettings();
        await obs.setTransform(preset);
    }
};