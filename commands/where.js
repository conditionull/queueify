const obs = require("../services/obs");
const { reportObsFailure } = require("../services/obsFeedback");
const { sayMessage } = require('../services/messages');

// Get the current position of the spotify widget source from OBS, use the provided x,y coords
module.exports = {
    name: "where",
    modOnly: true,

    async execute({ client, channel, username }) {
        let transform;
        try {
            transform = await obs.getTransform();
        } catch (err) {
            if (reportObsFailure(client, channel, username, err)) return;
            throw err;
        }

        sayMessage(client, channel, 'widget.position', {
            x: Math.round(transform.positionX),
            y: Math.round(transform.positionY)
        });
    }
};
