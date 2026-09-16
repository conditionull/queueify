const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

/**
 * The request log - one line of JSON per thing that happened.
 *
 * Deliberately not `core/state.js`. That debounces a full rewrite of a whole
 * file (`scheduleWrite`), which is right for a settings blob and wrong for a
 * history: it would hold every event ever in memory and re-serialise all of
 * them on every request. Appending a line is O(1) and never touches what is
 * already on disk, so nothing already written can be damaged by a later write.
 *
 * Because there is no debounce here, a test can `await appendEvent(...)` and
 * read the file straight afterwards - no 250ms settle, unlike everything that
 * goes through core/state.
 */

// QUEUEIFY_DATA_DIR alone already redirects this, so a sandbox that only sets
// that one is still safe. QUEUEIFY_HISTORY_FILE is the finer handle, matching
// QUEUEIFY_SETTINGS_FILE. Both are read at load: an assignment after the
// require is too late.
const HISTORY_FILE = process.env.QUEUEIFY_HISTORY_FILE
    || path.join(
        process.env.QUEUEIFY_DATA_DIR || path.join(__dirname, '..'),
        'queue-history.jsonl'
    );

const SCHEMA_VERSION = 1;

// Longest a pasted string is kept when a request failed before we knew what
// track it was. Enough to tell a bad link from a song title, not enough to
// store somebody's whole message.
const MAX_INPUT_LENGTH = 200;

// Tail of the append chain. Appends are serialised through it so two requests
// landing together can never interleave half a line, and so the order on disk
// matches the order they were recorded in.
let writeChain = Promise.resolve();

function appendLine(line) {
    writeChain = writeChain.then(async () => {
        try {
            await fsPromises.appendFile(HISTORY_FILE, line);
        } catch (err) {
            // Analytics must never cost somebody their song request, so this
            // is as far as a write failure travels.
            console.error('Failed to append to queue-history.jsonl:', err.message);
        }
    });

    return writeChain;
}

/**
 * Record one event.
 *
 * Returns a promise for the sake of tests; callers in the request path are
 * expected to ignore it. It never rejects.
 */
function appendEvent(event) {
    return appendLine(JSON.stringify({
        v: SCHEMA_VERSION,
        t: new Date().toISOString(),
        ...event
    }) + '\n');
}

function truncateInput(input) {
    if (typeof input !== 'string') return undefined;

    const trimmed = input.trim();
    if (!trimmed) return undefined;

    return trimmed.length > MAX_INPUT_LENGTH
        ? trimmed.slice(0, MAX_INPUT_LENGTH)
        : trimmed;
}

/**
 * The fields worth keeping from a Spotify track.
 *
 * Takes the *raw* API object, not `formatTrack`'s output: that joins the
 * artists into one string, and counting "top artist" off `"Daft Punk, Pharrell
 * Williams"` invents an artist who does not exist.
 *
 * Fields are picked rather than the object stored whole - a raw track is 4-6KB,
 * almost all of it `available_markets`. No cover URL either: Spotify's image
 * URLs rotate, so a stored one is a fact that stops being true.
 */
function summariseTrack(track) {
    if (!track?.id) return undefined;

    return {
        id: track.id,
        isrc: track.external_ids?.isrc ?? null,
        name: track.name,
        artists: (track.artists || []).map(artist => ({
            id: artist.id ?? null,
            name: artist.name
        })),
        albumId: track.album?.id ?? null,
        albumName: track.album?.name ?? null,
        // Kept exactly as Spotify gives it - the precision varies between
        // "2002", "2002-08" and "2002-08-26", so it is parsed leniently on the
        // way out rather than flattened on the way in.
        releaseDate: track.album?.release_date ?? null,
        durationMs: track.duration_ms,
        explicit: Boolean(track.explicit),
        // As of the moment of the request. It drifts on Spotify's side, which
        // is fine: what is recorded is what was true when it was asked for.
        popularity: track.popularity ?? null
    };
}

/**
 * Who asked.
 *
 * Three facts, no derived key. `id` is the only one that survives a rename;
 * `login` is the lowercase name, which is what chat has always passed, so it is
 * the join that lets a line written before ids existed be reconciled to one
 * later. `display` is recorded per event because it changes over time.
 *
 * Working out which lines are the same person happens when the log is read.
 * Nothing here is ever rewritten to back-fill an id.
 */
function summariseRequester(requester = {}, fallbackUsername) {
    const login = requester.userLogin ?? fallbackUsername;

    return {
        id: requester.userId ?? null,
        login: login ? String(login).trim().toLowerCase() : null,
        display: requester.userName ?? fallbackUsername ?? null,
        sub: requester.sub ?? null,
        mod: requester.mod ?? null
    };
}

function recordRequest({
    outcome,
    source,
    requester,
    username,
    track,
    input,
    queuePosition,
    refunded,
    blockedArtistName
}) {
    return appendEvent({
        type: 'request',
        outcome,
        source,
        user: summariseRequester(requester, username),
        track: summariseTrack(track),
        input: truncateInput(input),
        queuePosition,
        refunded,
        blockedArtistName
    });
}

function recordPlay({ track, queuedBy, queuedAt }) {
    return appendEvent({
        type: 'play',
        trackId: track.id,
        name: track.name,
        artists: track.artists,
        durationMs: track.durationMs,
        queuedBy: queuedBy ? String(queuedBy).trim().toLowerCase() : null,
        // The timestamp, not the wait. The wait is this event's `t` minus this.
        queuedAt
    });
}

function recordSkip({ trackId, name, by }) {
    return appendEvent({
        type: 'skip',
        trackId,
        name,
        by: by ? String(by).trim().toLowerCase() : null
    });
}

/**
 * Wait for every append handed over so far to be on disk.
 *
 * Callers in the request path deliberately do not await their writes, so
 * shutdown needs a way to let them finish - and a test needs one to read the
 * file back without guessing at a delay.
 */
function flush() {
    return writeChain;
}

/**
 * Every event on disk, oldest line first.
 *
 * A line that will not parse is skipped, not thrown - a hard kill can leave a
 * torn last line, and one bad line must not cost the whole history.
 */
function readEvents() {
    let raw;

    try {
        raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('Failed to read queue-history.jsonl:', err.message);
        }
        return [];
    }

    const events = [];

    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;

        try {
            events.push(JSON.parse(line));
        } catch {
            // Ignored on purpose. See above.
        }
    }

    return events;
}

module.exports = {
    appendEvent,
    recordRequest,
    recordPlay,
    recordSkip,
    readEvents,
    flush,
    summariseTrack,
    HISTORY_FILE,
    SCHEMA_VERSION
};
