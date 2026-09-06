require('./helpers/ensureDependencies')();
require("dotenv").config({ quiet: true });

const { ensureSpotifyReward } = require('./services/createReward');

(async () => {
    try {
        const reward = await ensureSpotifyReward();

        console.log(reward.created ? 'Reward created!' : 'Reward already exists!');
        console.log('Reward:', reward.title);
        console.log('ID:', reward.id);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
})();
