const obs = require("../services/obs");
const settings = require("../config/settings");
const state = require("../core/state");

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

            state.widgetPresets.topright = transform;
            state.saveSettings();

            client.say(channel, "Saved Top Right preset.");
            return;
        }

        if (!isMod && !isAllowedUser) {
            client.say(channel, `@${username} you lack permission to use this command.`);
            return;
        }

        const preset = state.widgetPresets.topright;

        if (!preset) {
            client.say(channel, "Top Right preset not set. Use !tr set");
            return;
        }

        await obs.setTransform(preset);
    }
};