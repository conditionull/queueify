const obs = require("../services/obs");
const { reportObsFailure } = require("../services/obsFeedback");
const settings = require("../config/userSettings");
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

        const isAllowedUser = settings.isAllowedUser(username);

        if (args[0] === "set") {
            if (!isMod) {
                sayMessage(client, channel, 'widget.topOnlyMods', { username });
                return;
            }

            let transform;
            try {
                transform = await obs.getTransform();
            } catch (err) {
                // A misconfigured OBS is the usual cause here, and the reply
                // names the setting to fix. Anything else is a real fault.
                if (reportObsFailure(client, channel, username, err)) return;
                throw err;
            }

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

        try {
            await obs.setTransform(preset);
        } catch (err) {
            if (reportObsFailure(client, channel, username, err)) return;
            throw err;
        }

        state.activeWidgetPosition = "topright";
        state.saveSettings();
    }
};
