const obs = require("../services/obs");
const { sayMessage } = require('../services/messages');

// Get the current position of the spotify widget source from OBS, use the provided x,y coords
module.exports = {
    name: "where",
    modOnly: true,

    async execute({ client, channel }) {
        const transform = await obs.getTransform();

        sayMessage(client, channel, 'widget.position', {
            x: Math.round(transform.positionX),
            y: Math.round(transform.positionY)
        });
    }
};