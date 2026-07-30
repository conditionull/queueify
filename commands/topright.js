const obs = require("../services/obs");
const settings = require("../config/settings");
const state = require("../core/state");

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
                client.say(channel, `@${username} only mods can save presets.`);
                return;
            }

            const transform = await obs.getTransform();
            const theme = await getCurrentTheme();
            const presetName = getThemePresetName(theme);

            state.widgetPresets[presetName] = transform;
            state.saveSettings();

            client.say(channel, `Saved Top Right preset for ${theme}.`);
            return;
        }

        if (!isMod && !isAllowedUser) {
            client.say(channel, `@${username} you lack permission to use this command.`);
            return;
        }

        const theme = await getCurrentTheme();
        const presetName = getThemePresetName(theme);
        const preset = state.widgetPresets[presetName] || state.widgetPresets.topright;

        if (!preset) {
            client.say(channel, `Top Right preset not set for ${theme}. Use !tr set`);
            return;
        }
        state.activeWidgetPosition = "topright";
        state.saveSettings();
        await obs.setTransform(preset);
    }
};