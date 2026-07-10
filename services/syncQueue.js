const { getCurrentTrack, getUserQueue } = require("../spotify");

async function syncQueue(state) {
    const spotifyQueue = await getUserQueue();
    const currentTrack = await getCurrentTrack();

    if (spotifyQueue === false || currentTrack === false) {
        return false;
    }

    state.updateActiveTrack(currentTrack);
    state.reconcileWithSpotifyQueue(spotifyQueue.queue);

    return true;
}

module.exports = syncQueue;