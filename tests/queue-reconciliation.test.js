const assert = require('assert');
const test = require('node:test');

const state = require('../core/state');

function pendingTrack(id) {
    return { id, name: id, queuedBy: 'viewer' };
}

function reconcile(pendingQueue, spotifyQueue) {
    const testState = {
        pendingQueue,
        savePendingQueue() {}
    };

    return state.reconcileWithSpotifyQueue.call(testState, spotifyQueue);
}

test('reconciliation removes a played request despite a natural duplicate in Spotify queue', () => {
    const pendingQueue = [
        pendingTrack('magnetic'),
        pendingTrack('vem'),
        pendingTrack('killshot'),
        pendingTrack('rude'),
        pendingTrack('moon'),
        pendingTrack('touch'),
        pendingTrack('not-cute')
    ];

    const remainingQueue = [
        { id: 'magnetic' },
        { id: 'touch' },
        { id: 'not-cute' }
    ];

    assert.deepStrictEqual(
        reconcile(pendingQueue, remainingQueue).map(track => track.id),
        ['touch', 'not-cute']
    );
});