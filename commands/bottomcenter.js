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
    return theme ? `bottomcenter:${theme}` : "bottomcenter";
}

module.exports = {
    name: "bottomcenter",
    aliases: ["bc"],

    async execute({ client, channel, username, isMod, args }) {

        const isAllowedUser = settings.isAllowedUser(username);

        if (args[0] === "set") {
            if (!isMod) {
                sayMessage(client, channel, 'widget.bottomOnlyMods', { username });
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

        try {
            await obs.setTransform(preset);
        } catch (err) {
            if (reportObsFailure(client, channel, username, err)) return;
            throw err;
        }

        state.activeWidgetPosition = "bottomcenter";
        state.saveSettings();
    }
};
