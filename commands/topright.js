const obs = require("../services/obs");
const widgetPresets = require("../services/widgetPresets");
const widgetLayout = require("../services/widgetLayout");
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
    return widgetPresets.nameFor("topright", theme);
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

        // Recorded before placing, not after: wherever the widget lands is
        // remembered against whichever mode is in force, and this command is
        // the moment that mode becomes "topright".
        state.activeWidgetPosition = "topright";

        // Not setTransform on the saved preset: its scale was measured against
        // a browser source size that has since been recomputed for this theme.
        // Only the rectangle it framed still means anything, and the scale to
        // land in it is worked out along with the source size, in one pass.
        const placed = await widgetLayout.restorePosition(theme, { kind: "topright" });

        if (placed.reason === 'no_preset') {
            sayMessage(client, channel, 'widget.topMissing', { theme });
            return;
        }

        if (!placed.applied) {
            const err = placed.error
                || Object.assign(new Error(placed.message || 'OBS could not be updated.'), { code: placed.reason });

            if (reportObsFailure(client, channel, username, err)) return;
            throw err;
        }

        state.saveSettings();
    }
};
