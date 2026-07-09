const obs = require("../services/obs");

// Get the current position of the spotify widget source from OBS, use the provided x,y coords
module.exports = {
    name: "where",
    modOnly: true,

    async execute({ client, channel }) {
        const transform = await obs.getTransform();

        client.say(
            channel,
            `Position: X=${Math.round(transform.positionX)}, Y=${Math.round(transform.positionY)}`
        );
    }
};