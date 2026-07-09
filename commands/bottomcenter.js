const obs = require("../services/obs");
const settings = require("../config/settings");
const state = require("../core/state");

module.exports = {
    name: "bottomcenter",
    aliases: ["bc"],

    async execute({ client, channel, username, isMod, args }) {

        const isAllowedUser = settings.allowedUsers.includes(username);

        if (args[0] === "set") {
            if (!isMod) {
                client.say(channel, `@${username} only mods can save presets.`);
                return;
            }

            const transform = await obs.getTransform();

            state.widgetPresets.bottomcenter = transform;
            state.saveSettings();

            client.say(channel, "Saved Bottom Center preset.");
            return;
        }

        if (!isMod && !isAllowedUser) {
            client.say(channel, `@${username} you lack permission to use this command.`);
            return;
        }

        const preset = state.widgetPresets.bottomcenter;

        if (!preset) {
            client.say(channel, "Bottom Center preset not set. Use !bc set");
            return;
        }

        await obs.setTransform(preset);
    }
};