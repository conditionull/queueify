const widgetLayout = require("../services/widgetLayout");
const { sayMessage } = require('../services/messages');

module.exports = {
    name: "theme",
    aliases: ["design"],
    modOnly: true,

    async execute({ client, channel, args }) {
        const theme = args[0];

        if (!theme) {
            const [themesRes, configRes] = await Promise.all([
                fetch("http://localhost:3001/api/widget/themes"),
                fetch("http://localhost:3001/api/widget/config")
            ]);

            const themes = await themesRes.json();
            const config = await configRes.json();

            sayMessage(client, channel, 'widget.availableThemes', {
                current: config.effectiveTheme || config.theme || 'default',
                themes: themes.join(', ')
            });

            return;
        }

        const themesRes = await fetch(
            "http://localhost:3001/api/widget/themes"
        );

        const themes = await themesRes.json();

        if (!themes.includes(theme)) {
            sayMessage(client, channel, 'widget.unknownTheme', {
                theme,
                themes: themes.join(', ')
            });

            return;
        }

        const configRes = await fetch("http://localhost:3001/api/widget/config");
        const config = await configRes.json();

        if (config.theme === theme && config.effectiveTheme === theme) {
            sayMessage(client, channel, 'widget.themeAlreadySet', { theme });
            return;
        }

        // Where the outgoing theme sat is only knowable before the switch, and
        // it is exactly what coming back to it needs. This command talks to the
        // widget server directly, so it has to do this for itself.
        await widgetLayout.rememberPosition(config.theme).catch(() => {});

        const themeRes = await fetch(
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

        if (!themeRes.ok) {
            sayMessage(client, channel, 'widget.unknownTheme', {
                theme,
                themes: themes.join(', ')
            });
            return;
        }

        try {
            // Sizing the source and framing the widget are one pass: the scale
            // that lands it in its saved rectangle depends on the size the
            // source is about to become, which OBS cannot be asked for yet.
            const placed = await widgetLayout.restorePosition(theme);
            if (placed.reason === 'no_preset') await widgetLayout.reconcile();
        } catch (err) {
            // The theme itself changed; only the OBS repositioning failed, so
            // this stays out of chat - but the reason still has to be legible.
            console.warn("Could not reposition the widget in OBS:", err.message);
        }

        sayMessage(client, channel, 'widget.themeChanged', { theme });
    }
};