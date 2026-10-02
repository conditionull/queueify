/**
 * Whether two tracks are the same song, as far as Spotify is concerned.
 *
 * Comparing `id` alone is wrong, and was a cause of requests losing their
 * name: Spotify "relinks" a track that is not available in the streamer's
 * country to a copy that is, so a link pasted by a viewer in another country
 * plays under a different id from the one that was queued. Every track object
 * Queueify builds carries `ids` - the id Spotify plays and the one it was
 * linked from - and two tracks match when they share any of them.
 */
function trackIds(track) {
    if (!track) return [];

    const ids = [track.id, ...(Array.isArray(track.ids) ? track.ids : [])];
    return [...new Set(ids.filter(id => typeof id === 'string' && id))];
}

function sameTrack(a, b) {
    const theirs = trackIds(b);
    return theirs.length > 0 && trackIds(a).some(id => theirs.includes(id));
}

module.exports = { sameTrack, trackIds };
