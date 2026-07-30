const obs = require("../services/obs");
const state = require("../core/state");

function getPresetName(theme, currentPosition) {
    if (currentPosition === "bottomcenter") {
        return `bottomcenter:${theme}`;
    }

    return `topright:${theme}`;
}

module.exports = {
    name: "theme",
    aliases: ["design"],
    modOnly: true,

    async execute({ client, channel, args }) {
        const theme = args[0];

        if (!theme) {
            const res = await fetch(
                "http://localhost:3001/api/widget/themes"
            );

            const themes = await res.json();
            client.say(channel, `Available themes: ${themes.join(", ")}`);

            return;
        }

        const themesRes = await fetch(
            "http://localhost:3001/api/widget/themes"
        );

        const themes = await themesRes.json();

        if (!themes.includes(theme)) {
            client.say(
                channel,
                `Unknown theme "${theme}". Available: ${themes.join(", ")}`
            );

            return;
        }

        const configRes = await fetch("http://localhost:3001/api/widget/config");
        const config = await configRes.json();

        if (config.theme === theme) {
            client.say(channel, `Widget theme is already set to ${theme}`);
            return;
        }

        await fetch(
            "http://localhost:3001/api/widget/theme",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    theme
                })
            }
        );

        try {
            const currentTransform = await obs.getTransform();
            const currentPosition = state.activeWidgetPosition || "topright";
            const presetName = getPresetName(theme, currentPosition);
            const preset = state.widgetPresets[presetName] || state.widgetPresets[currentPosition];

            if (preset) {
                await obs.setTransform(preset);
            } else {
                await obs.setTransform(currentTransform);
            }
        } catch (err) {
            console.error("Failed to apply theme position preset:", err.message);
        }

        client.say(channel, `Widget theme changed to ${theme}`);
    }
};