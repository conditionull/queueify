const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { normalizeSettings: normalizePerks } = require('../services/perks');
const { sameTrack, trackIds } = require('./sameTrack');

// QUEUEIFY_DATA_DIR lets tests (and the setup sandbox) point the persisted
// state at a throwaway directory instead of the real project files.
const DATA_DIR = process.env.QUEUEIFY_DATA_DIR || path.join(__dirname, '..');

const BLACKLIST_FILE = path.join(DATA_DIR, 'queue-blacklist.json');
const QUEUE_STATE_FILE = path.join(DATA_DIR, 'queue-state.json');
const QUEUE_SETTINGS_FILE = process.env.QUEUEIFY_SETTINGS_FILE || path.join(DATA_DIR, 'queue-settings.json');
const PENDING_QUEUE_FILE = path.join(DATA_DIR, 'queue-pending.json');
const RECENT_REQUESTS_FILE = path.join(DATA_DIR, 'queue-recent.json');
// The song playing and who it belongs to. Kept on disk so restarting the bot
// mid-song does not cost the requester their name - the request has already
// left the pending list by then, so this is the only record of it.
const ACTIVE_TRACK_FILE = path.join(DATA_DIR, 'queue-active.json');

const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_REPEAT_BLOCK_SECONDS = 600;
const DEFAULT_MAX_SONG_LENGTH = 360;
// Commands that are worth a brake out of the box. !np asks Spotify what is
// playing and what is queued, so it is the one that costs something to spam.
// Anything absent here has no wait at all, and a command the user has set is
// kept exactly as they set it - including a deliberate 0.
const DEFAULT_COMMAND_COOLDOWNS = {
    active: { global: 3, user: 20 },
    // Every answer is a link in chat, so one person repeating it is noise.
    fx: { global: 0, user: 10 }
};
const PROGRESS_RESET_GRACE_MS = 5000;
// How near the start the playhead has to land for a jump backwards to mean the
// track is beginning again, rather than somebody scrubbing inside the play that
// is already going. See updateActiveTrack.
const REPLAY_START_WINDOW_MS = 5000;
// Slack on every "could the song have finished while nobody was looking"
// sum, for the time a Spotify answer spends in flight. It only ever turns
// those answers into "maybe", which costs a name rather than giving a wrong one.
const UNSEEN_SLACK_MS = 3000;
// How far a playhead read can be off: backwards without anyone moving it, or
// ahead of the time between two reads (each is timed the moment Spotify
// answers - see spotify.js's fetchCurrentTrack).
const PLAYHEAD_JITTER_MS = 1000;
// How many songs Spotify's queue endpoint shows. A full answer may have been
// cut short, so a request missing from it is not necessarily gone.
const SPOTIFY_QUEUE_WINDOW = 20;
// How often the song playing is written to disk while nothing changes. It
// only has to be close enough for a restart to tell it is the same play.
const ACTIVE_TRACK_SAVE_MS = 10000;
const MAX_WRITE_RETRY = 3;

// Debounce timers, keyed by file: coalesce rapid saveX() bursts into one write.
const pendingTimers = new Map();
// Tail promise of each file's write chain: guarantees writes (and their
// retries) for a given file are never in flight concurrently, so completion
// order always matches schedule order and a stale write can't clobber a
// fresher one that happened to finish first.
const writeChains = new Map();

function loadJSON(file, fallback) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (err) {
        console.error(`Failed to load ${path.basename(file)}:`, err.message);
    }
    return fallback;
}

async function writeOnce(file, value, retries) {
    try {
        await fsPromises.writeFile(file, JSON.stringify(value, null, 2));
    } catch (err) {
        console.error(`Failed to save ${path.basename(file)}:`, err.message);
        if (retries < MAX_WRITE_RETRY) {
            const retryDelay = 200;
            console.warn(`Retrying write to ${path.basename(file)} in ${retryDelay}ms (${retries + 1}/${MAX_WRITE_RETRY})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return writeOnce(file, value, retries + 1);
        }
        console.error(`Max retries exceeded for ${path.basename(file)}`);
    }
}

function enqueueWrite(file, value) {
    const previous = writeChains.get(file) || Promise.resolve();
    const next = previous.then(() => writeOnce(file, value, 0));
    writeChains.set(file, next);
}

function scheduleWrite(file, value) {
    clearTimeout(pendingTimers.get(file));

    const timer = setTimeout(() => {
        pendingTimers.delete(file);
        enqueueWrite(file, value);
    }, 100);

    pendingTimers.set(file, timer);
}

function saveJSON(file, value) {
    scheduleWrite(file, value);
}

function normalizePendingItem(item) {
    return {
        id: item.id,
        name: item.name,
        artists: item.artists,
        durationMs: item.durationMs,
        // For the widget's Up next row. Requests saved before it have none,
        // and the row just leaves their picture out.
        cover: item.thumb || item.cover || null,
        // Every id Spotify might report this song under - see core/sameTrack.js.
        ids: trackIds(item),
        queuedBy: item.queuedBy,
        queuedAt: item.queuedAt || new Date().toISOString(),
        // For perks (services/perks.js): which of this viewer's requests it
        // is, counted when it went in. Requests saved before perks have none,
        // and play without an effect.
        requestNumber: item.requestNumber ?? null,
        requesterId: item.requesterId ?? null,
        requesterSub: item.requesterSub ?? null,
        requesterSubTier: item.requesterSubTier ?? null,
        // Which play was on when it went in (its startedAt) - see mayBeOutOfSight.
        playingWhenQueued: item.playingWhenQueued ?? null,
        // Whether it has been in sight in Spotify's queue, and whether the
        // queue has been read at all since it went in. Together they tell a
        // request that is out of sight behind twenty other songs from one that
        // has gone - see sortPending.
        seenInQueue: item.seenInQueue === true,
        readSince: item.readSince === true,
        // Copies of the same song ahead of it in Spotify's queue that are not
        // requests, counted as it went in (services/syncQueue.js's
        // countCopiesAhead). null when that could not be told.
        copiesAhead: item.copiesAhead === null ? null : Number.isInteger(item.copiesAhead) ? item.copiesAhead : 0,
        // False once there is no telling which copy of its song in the queue
        // is this request - as it went in, or later (sortPending's ambiguous
        // ones). It is never credited then.
        creditable: item.creditable !== false && item.copiesAhead !== null,
        // Where it was in Spotify's queue at the read taken at queueReadAt -
        // what sortPending lines the next read up against.
        queueAt: Number.isInteger(item.queueAt) ? item.queueAt : null,
        queueReadAt: Number.isFinite(item.queueReadAt) ? item.queueReadAt : null,
        // Where it went into Spotify's queue, as a place in the read taken at
        // insertedInto - services/syncQueue.js's placeRequest. Until a read
        // places it, this is how it is followed.
        insertedAt: Number.isInteger(item.insertedAt) ? item.insertedAt : null,
        insertedInto: Number.isFinite(item.insertedInto) ? item.insertedInto : null
    };
}

/**
 * Which songs of the previous read of Spotify's queue are still in this one,
 * and where: a map from old position to new.
 *
 * The longest run of songs common to both, in order - the way a diff lines up
 * two versions of a file. Where the same song could line up either of two
 * ways, the later old copy is kept: songs leave from the front, so of [A, A]
 * becoming [A] it is the first one that went.
 */
function alignQueues(before, after) {
    const rows = before.length;
    const cols = after.length;
    const longest = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));

    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
            longest[i][j] = sameTrack(before[i], after[j])
                ? longest[i + 1][j + 1] + 1
                : Math.max(longest[i + 1][j], longest[i][j + 1]);
        }
    }

    const moved = new Map();
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
        if (longest[i + 1][j] === longest[i][j]) {
            i += 1;
        } else if (sameTrack(before[i], after[j]) && longest[i][j] === longest[i + 1][j + 1] + 1) {
            moved.set(i, j);
            i += 1;
            j += 1;
        } else {
            j += 1;
        }
    }
    return moved;
}

/**
 * Runs of the same song, side by side in the previous read, that lost a copy
 * the line-up had to guess at - each as the list of its old positions.
 *
 * Take one song out of [A, A, A] and the queue reads [A, A] whichever it was,
 * so lining up says nothing about which copy went. The one exception is the
 * front of the queue going because a song started: Spotify always plays the
 * first in line.
 */
function runsTouched(before, moved, songStarted) {
    let played = 0;
    if (songStarted) while (played < before.length && !moved.has(played)) played += 1;

    const runs = [];
    for (let gone = played; gone < before.length; gone += 1) {
        if (moved.has(gone) || runs.some(run => run.includes(gone))) continue;

        let start = gone;
        let end = gone;
        while (start > 0 && sameTrack(before[start - 1], before[gone])) start -= 1;
        while (end < before.length - 1 && sameTrack(before[end + 1], before[gone])) end += 1;
        if (end > start) runs.push(Array.from({ length: end - start + 1 }, (_, at) => start + at));
    }
    return runs;
}

/**
 * Whether a request missing from the queue may just be out of sight.
 *
 * Spotify only shows the next twenty songs. A request that has never been in
 * sight, with the answer full, may be behind twenty other songs - treating
 * that as gone used to throw away every request whenever the streamer had a
 * long queue of their own. The one exception is a request nobody has read the
 * queue since that is what is playing: Spotify started it before Queueify
 * wrote it down.
 */
function mayBeOutOfSight(item, full, playing, playStartedAt) {
    if (!full || item.seenInQueue) return false;
    if (item.readSince || !playing || !sameTrack(item, playing)) return true;
    // Only a play that began after it went in can be it: the streamer may
    // already have had that song on when a viewer asked for it.
    return playStartedAt !== null && playStartedAt === item.playingWhenQueued;
}

/**
 * What the queue held at the last read, with the requests put in since then
 * added where they went in - so the next read can be lined up against what
 * the queue should look like, not against one that never had them in it.
 *
 * Each entry is a song, and the pending request it is, if it is one.
 * Returns null when there is no last read to start from.
 */
function expectedQueue(previousQueue, previousReadAt, pendingQueue) {
    if (!Array.isArray(previousQueue)) return null;

    const entries = previousQueue.map(track => ({ track, item: null }));
    const inserted = [];
    for (const item of pendingQueue) {
        const placedThen = Number.isInteger(item.queueAt) && item.queueReadAt === previousReadAt;
        if (placedThen && entries[item.queueAt] && !entries[item.queueAt].item) {
            entries[item.queueAt].item = item;
        } else if (!placedThen && Number.isInteger(item.insertedAt) && item.insertedInto === previousReadAt) {
            inserted.push(item);
        }
    }

    // insertedAt counts places in that read, so these go in from the back.
    // Two at the same place went in in the order they were asked for.
    inserted
        .map((item, order) => ({ item, order }))
        .sort((a, b) => b.item.insertedAt - a.item.insertedAt || b.order - a.order)
        .forEach(({ item }) => entries.splice(Math.min(item.insertedAt, entries.length), 0, { track: item, item }));

    return entries;
}

/**
 * Split the pending list into the requests still waiting in Spotify's queue
 * and the ones that have left it - played, playing, or taken out. Order is
 * kept in both. `at` says where each one in sight is.
 *
 * Each request is followed by position: where it was at the last read, or
 * where it went in since. Lining this read up against that (alignQueues) says
 * whether that very copy is still there or has gone - which matching by song
 * alone cannot: a request taken out of the queue used to carry on "waiting"
 * if the same song happened to be further down the playlist, and that copy
 * was then credited to the viewer.
 */
function sortPending(pendingQueue, spotifyQueue, { playing = null, songStarted = true, playStartedAt = null, expected = null, moved = null, frontStarted = false } = {}) {
    if (!expected) return guessPending(pendingQueue, spotifyQueue, playing, songStarted, playStartedAt);

    const full = spotifyQueue.length >= SPOTIFY_QUEUE_WINDOW;
    const tracks = expected.map(entry => entry.track);
    moved = moved || alignQueues(tracks, spotifyQueue);
    const lastMoved = Math.max(-1, ...moved.keys());
    const taken = new Set(moved.values());
    const followed = new Map(expected.map((entry, index) => [entry.item, index]).filter(([item]) => item && item.creditable));
    const waiting = [];
    const at = new Map();
    const ambiguous = [];
    let cursor = 0;

    // A run that lost a copy, with one viewer's request in it and the rest
    // nobody's: theirs is the first copy of the run still there - if theirs
    // went, the next one of the same song plays straight after where it would
    // have, and that is theirs by the same rule as in updateActiveTrack. With
    // two viewers in one run there is no telling whose is whose.
    const runFirst = new Map();
    for (const run of runsTouched(tracks, moved, songStarted)) {
        // The front copy may be what just started playing - then the request
        // at the front is that one, playing straight away, not a later copy.
        if (frontStarted && run[0] === 0) continue;
        const requests = run.filter(index => expected[index].item && followed.has(expected[index].item));
        const left = run.filter(index => moved.has(index)).map(index => moved.get(index));
        for (const index of requests) {
            if (requests.length === 1 && left.length) runFirst.set(index, Math.min(...left));
            else if (requests.length > 1) ambiguous.push(expected[index].item);
        }
    }

    for (const item of pendingQueue) {
        if (followed.has(item)) {
            const index = followed.get(item);
            if (runFirst.has(index)) {
                waiting.push(item);
                at.set(item, runFirst.get(index));
                cursor = Math.max(cursor, runFirst.get(index) + 1);
                continue;
            }
            if (moved.has(index)) {
                const position = moved.get(index);
                waiting.push(item);
                at.set(item, position);
                // A request whose copy could not be told apart was only ever
                // placed by guess, so it says nothing about where later ones are.
                if (item.creditable) cursor = Math.max(cursor, position + 1);
            } else if (full && index > lastMoved) {
                // Pushed off the end by songs put in ahead of it.
                waiting.push(item);
            }
            continue;
        }

        // A request nobody can tell apart from another copy is never given a
        // place: a guessed one could be another request's, and push that one
        // onto a copy that is not theirs. It stays, unnamed, while its song is
        // still somewhere in the queue.
        if (!item.creditable) {
            if (spotifyQueue.some(track => sameTrack(track, item)) || mayBeOutOfSight(item, full, playing, playStartedAt)) waiting.push(item);
            continue;
        }

        // Nothing to follow it by: out of sight until now. It is the first
        // copy of its song nothing else accounts for - after the requests
        // before it, if there is one there.
        const free = (track, index) => !taken.has(index) && sameTrack(track, item);
        let position = spotifyQueue.findIndex((track, index) => index >= cursor && free(track, index));
        if (position === -1) position = spotifyQueue.findIndex(free);
        if (position !== -1) {
            waiting.push(item);
            at.set(item, position);
            taken.add(position);
            cursor = Math.max(cursor, position + 1);
        } else if (spotifyQueue.some(track => sameTrack(track, item))) {
            // Its song is in sight, but every copy is some other song's place:
            // no telling which one is this request.
            waiting.push(item);
            ambiguous.push(item);
        } else if (mayBeOutOfSight(item, full, playing, playStartedAt)) {
            waiting.push(item);
        }
    }

    return {
        waiting,
        at,
        ambiguous,
        // Whether the song at the front went - what a song starting from the
        // queue looks like, and a restart does not.
        frontLeft: expected.length > 0 && !moved.has(0),
        left: pendingQueue.filter(item => !waiting.includes(item))
    };
}

/**
 * sortPending with nothing to line up against - the first read after a
 * restart. Every request has to be matched by song alone.
 *
 * Requests leave from the front, by playing. Now and then the streamer takes
 * one out from anywhere. So of every way to line the two lists up - the first
 * so many requests played, the rest matched in order - this takes the one
 * that needs the fewest odd events: a request said to have played whose song
 * is still sitting in the queue, or one missing from the middle. The old way
 * only allowed for the front, so taking one request out of the middle threw
 * away every request ahead of it as well.
 */
function guessPending(pendingQueue, spotifyQueue, playing, songStarted, playStartedAt) {
    const full = spotifyQueue.length >= SPOTIFY_QUEUE_WINDOW;
    let best = null;

    for (let played = 0; played <= pendingQueue.length; played += 1) {
        const at = new Map();
        const missing = [];
        let cursor = 0;
        for (const item of pendingQueue.slice(played)) {
            const position = spotifyQueue.findIndex((spotifyItem, index) => index >= cursor && sameTrack(spotifyItem, item));
            if (position === -1) {
                missing.push(item);
            } else {
                at.set(item, position);
                cursor = position + 1;
            }
        }

        // With the same song still on since the last read, nothing can have
        // played: anything gone was taken out. A request said to have played
        // whose song is still in the queue - with no later request there to
        // account for that copy - needs a second copy to be there by chance,
        // which is less likely than one being taken out.
        const used = new Set(at.values());
        const strayCopy = item => spotifyQueue.some((spotifyItem, index) => !used.has(index) && sameTrack(spotifyItem, item));
        let odd = songStarted ? pendingQueue.slice(0, played).filter(strayCopy).length * 1.5 : played;
        // A request queued after the song on now cannot have played yet - the
        // queue plays in order. With no request on now, of two equally likely
        // readings, take the one where the last to play is the song on.
        const onNow = playing ? lastIndexWhere(pendingQueue.slice(0, played), item => sameTrack(item, playing)) : -1;
        if (onNow !== -1) odd += played - 1 - onNow;
        else if (played > 0) odd += 0.5;

        // Missing after the last one in sight may only be out of sight.
        const inSight = [...at.keys()];
        const lastInSight = inSight.length ? pendingQueue.indexOf(inSight[inSight.length - 1]) : played - 1;
        const outOfSight = missing.filter(item => pendingQueue.indexOf(item) > lastInSight && mayBeOutOfSight(item, full, playing, playStartedAt));
        odd += missing.length - outOfSight.length;

        // Ties go to more of the front having played: that is how songs leave.
        if (!best || odd <= best.odd) {
            const waiting = pendingQueue.filter(item => at.has(item) || outOfSight.includes(item));
            best = { odd, waiting, at };
        }
    }

    const { waiting, at } = best;
    return { waiting, at, left: pendingQueue.filter(item => !waiting.includes(item)) };
}

function reconcilePendingQueue(pendingQueue, spotifyQueue) {
    return sortPending(pendingQueue, spotifyQueue).waiting;
}

function lastIndexWhere(list, test) {
    for (let index = list.length - 1; index >= 0; index -= 1) {
        if (test(list[index])) return index;
    }
    return -1;
}

/**
 * Whether the play that was on could have reached its end in the time since
 * it was last seen. Unknown counts as yes.
 */
function couldHaveEnded(active, now) {
    const remaining = active.durationMs - active.lastProgressMs;
    const unseen = now - active.lastSeenAt;
    if (!Number.isFinite(remaining) || !Number.isFinite(unseen)) return true;

    return unseen + UNSEEN_SLACK_MS >= remaining;
}

/**
 * Whether a request for the song now playing could have played right through
 * already, in the time nobody was looking - leaving what is on now as some
 * other copy of the same song, from the playlist or the streamer.
 *
 * With Queueify looking every few seconds this is never true: no song is that
 * short. It is what keeps a long blind spot - the bot restarting, Spotify not
 * answering for a while - from turning into a confident wrong name. Unknown
 * counts as yes.
 */
function couldHavePlayedUnseen(request, playing, active, observedAt, now) {
    // Whatever was on when last seen had to finish first.
    const before = active ? Math.max(0, active.durationMs - active.lastProgressMs) : 0;
    const length = Number.isFinite(request.durationMs) ? request.durationMs : playing.durationMs;
    const needed = before + length + playing.progressMs;
    const unseen = now - observedAt;
    if (!Number.isFinite(needed) || !Number.isFinite(unseen)) return true;

    return unseen + UNSEEN_SLACK_MS >= needed;
}

/**
 * Whether the same track, reported again, is a different play of it.
 *
 * Two things give that away. The playhead back at the very start: the next
 * copy of the track beginning, or the streamer restarting it. Or a gap long
 * enough to have hidden one - the old play finishing and a new one getting as
 * far as this one is. That second check is what stops a request being credited
 * again when the playlist comes round to the same song while Queueify could
 * not see.
 *
 * Landing anywhere else after a jump backwards is somebody dragging the
 * playhead inside the song already playing: the same play by the same person.
 * Minting a new one for that lost the requester's name and logged the song as
 * played twice.
 */
function isAnotherPlay(active, playing, now) {
    const progress = playing.progressMs;
    const last = active.lastProgressMs;

    if (Number.isFinite(progress) && Number.isFinite(last)) {
        const backToStart = progress <= REPLAY_START_WINDOW_MS && progress + PROGRESS_RESET_GRACE_MS < last;
        if (backToStart) return true;
    }

    const remaining = active.durationMs - last;
    const unseen = now - active.lastSeenAt;
    if (!Number.isFinite(remaining) || !Number.isFinite(unseen) || !Number.isFinite(progress)) return true;

    return unseen + UNSEEN_SLACK_MS >= remaining + progress;
}

/**
 * When the playhead was actually read. spotify.js shares an answer for two
 * seconds, and timing a cached answer by the clock would make the song seem
 * further from its end than it is.
 */
function seenAt(playing, now) {
    const fetchedAt = playing && playing.fetchedAt;
    return Number.isFinite(fetchedAt) && fetchedAt <= now ? fetchedAt : now;
}

/** The song playing, with nobody credited. */
function unrequested(playing) {
    return {
        id: playing.id,
        name: playing.name,
        artists: playing.artists,
        durationMs: playing.durationMs,
        cover: playing.thumb || playing.cover || null,
        queuedBy: null,
        queuedAt: null,
        requestNumber: null,
        requesterId: null,
        requesterSub: null,
        requesterSubTier: null
    };
}

function normalizeActiveTrack(item) {
    if (!item || !item.id || !item.startedAt) return null;

    return {
        ...unrequested(item),
        ids: trackIds(item),
        queuedBy: item.queuedBy || null,
        queuedAt: item.queuedAt || null,
        requestNumber: item.requestNumber ?? null,
        requesterId: item.requesterId ?? null,
        requesterSub: item.requesterSub ?? null,
        requesterSubTier: item.requesterSubTier ?? null,
        startedAt: item.startedAt,
        lastProgressMs: Number.isFinite(item.lastProgressMs) ? item.lastProgressMs : null,
        lastSeenAt: Number.isFinite(item.lastSeenAt) ? item.lastSeenAt : null
    };
}

const settings = loadJSON(QUEUE_SETTINGS_FILE, {});
const playback = loadJSON(ACTIVE_TRACK_FILE, {}) || {};
const blacklistData = loadJSON(BLACKLIST_FILE, []);
const legacyUsers = Array.isArray(blacklistData) ? blacklistData : blacklistData.users;

const state = {
    blacklist: new Set(legacyUsers || []),
    blockedArtists: new Set(Array.isArray(blacklistData) ? [] : blacklistData.artists || []),
    blockedSongs: new Set(Array.isArray(blacklistData) ? [] : blacklistData.songs || []),
    queueEnabled: loadJSON(QUEUE_STATE_FILE, { enabled: true }).enabled ?? true,
    chatEnabled: loadJSON(QUEUE_SETTINGS_FILE, { chatEnabled: true }).chatEnabled ?? true,
    redeemsEnabled: loadJSON(QUEUE_SETTINGS_FILE, { redeemsEnabled: true }).redeemsEnabled ?? true,
    allowExplicit: settings.allowExplicit ?? true,
    // Turn a request away when Spotify's queue already has that song - see
    // services/queueSong.js. On unless switched off.
    blockQueuedSongs: settings.blockQueuedSongs ?? true,
    cooldownSeconds: settings.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    repeatBlockSeconds: settings.repeatBlockSeconds ?? DEFAULT_REPEAT_BLOCK_SECONDS,
    maxSongLength: settings.maxSongLength ?? DEFAULT_MAX_SONG_LENGTH,
    // Per command: { global, user } in seconds. Merged over the defaults rather
    // than replacing them, so a command nobody has touched still gets its
    // built-in wait and one that has been set keeps the number that was set.
    commandCooldowns: { ...DEFAULT_COMMAND_COOLDOWNS, ...(settings.commandCooldowns ?? {}) },
    activeWidgetPosition: settings.activeWidgetPosition ?? "topright",
    // Persisted so a restart knows which reward/channel it already owns,
    // instead of rediscovering them before anything can use them.
    spotifyRewardId: settings.spotifyRewardId ?? null,
    broadcasterId: settings.broadcasterId ?? null,
    // The last reward id we unlinked. Kept so an unlink is never a dead end:
    // the reward still exists on Twitch, and this is the only record of which
    // one it was once the link is gone.
    previousSpotifyRewardId: settings.previousSpotifyRewardId ?? null,
    pendingQueue: loadJSON(PENDING_QUEUE_FILE, []).map(normalizePendingItem),
    recentRequests: loadJSON(RECENT_REQUESTS_FILE, []),
    // Every song seen playing, requested or not - `queuedBy` says whether it
    // was. Only updateActiveTrack writes it.
    activeTrack: normalizeActiveTrack(playback.track),
    // When Spotify was last read successfully, playing or not. Everything
    // after it is a blind spot, and how long it was decides what can be
    // trusted - see couldHavePlayedUnseen.
    observedAt: Number.isFinite(playback.observedAt) ? playback.observedAt : null,
    // Spotify's queue as last read, and when. Each request's queueAt is a
    // position in it.
    lastSpotifyQueue: Array.isArray(playback.queue) ? playback.queue : null,
    lastSpotifyQueueAt: Number.isFinite(playback.queueAt) ? playback.queueAt : null,
    activeTrackSavedAt: 0,
    cooldowns: new Map(),
    widgetPresets: settings.widgetPresets ?? {},
    // Where each theme's widget was last seen on the OBS canvas, however it
    // got there - a !tr / !bc preset, or somebody dragging it. Presets say
    // where a theme belongs; this remembers where it actually was.
    widgetPositions: settings.widgetPositions ?? {},
    // What the widget plays when a viewer's song starts. See services/perks.js.
    perks: normalizePerks(settings.perks),

    saveBlacklist() {
        saveJSON(BLACKLIST_FILE, {
            users: [...this.blacklist],
            artists: [...this.blockedArtists],
            songs: [...this.blockedSongs]
        });
    },

    saveQueueState() {
        saveJSON(QUEUE_STATE_FILE, { enabled: this.queueEnabled });
    },

    saveSettings() {
        saveJSON(QUEUE_SETTINGS_FILE, {
            cooldownSeconds: this.cooldownSeconds,
            repeatBlockSeconds: this.repeatBlockSeconds,
            maxSongLength: this.maxSongLength,
            commandCooldowns: this.commandCooldowns,
            chatEnabled: this.chatEnabled,
            redeemsEnabled: this.redeemsEnabled,
            allowExplicit: this.allowExplicit,
            blockQueuedSongs: this.blockQueuedSongs,
            spotifyRewardId: this.spotifyRewardId,
            broadcasterId: this.broadcasterId,
            previousSpotifyRewardId: this.previousSpotifyRewardId,
            activeWidgetPosition: this.activeWidgetPosition,
            widgetPresets: this.widgetPresets,
            widgetPositions: this.widgetPositions,
            perks: this.perks
        });
    },

    /**
     * Drop the link to the channel point reward, remembering which one it was.
     *
     * Nothing is deleted on Twitch - the reward keeps existing, we just stop
     * claiming it. Every caller that clears the link goes through here so the
     * id is always recoverable afterwards; a bare `spotifyRewardId = null`
     * throws away the only pointer to a reward the user may have renamed.
     *
     * Returns whether anything was actually unlinked.
     */
    forgetSpotifyReward() {
        if (!this.spotifyRewardId) return false;

        this.previousSpotifyRewardId = this.spotifyRewardId;
        this.spotifyRewardId = null;
        this.saveSettings();
        return true;
    },

    saveWidgetPreset(name, transform) {
        this.widgetPresets[name] = {
            x: transform.positionX,
            y: transform.positionY,
            width: transform.width,
            height: transform.height,
            scaleX: transform.scaleX,
            scaleY: transform.scaleY
        };

        this.saveSettings();
    },

    getWidgetPreset(name) {
        return this.widgetPresets[name];
    },

    savePendingQueue() {
        saveJSON(PENDING_QUEUE_FILE, this.pendingQueue);
    },

    saveActiveTrack(now = Date.now()) {
        this.activeTrackSavedAt = now;
        saveJSON(ACTIVE_TRACK_FILE, {
            track: this.activeTrack,
            observedAt: this.observedAt,
            queue: this.lastSpotifyQueue && this.lastSpotifyQueue.map(item => ({ id: item.id, ids: trackIds(item) })),
            queueAt: this.lastSpotifyQueueAt
        });
    },

    saveRecentRequests() {
        saveJSON(RECENT_REQUESTS_FILE, this.recentRequests);
    },

    addPendingTrack(track, queuedBy, perk = {}) {
        if (!track?.id) return;

        this.pendingQueue.push(normalizePendingItem({
            ...track,
            ...perk,
            queuedBy,
            queuedAt: new Date().toISOString(),
            playingWhenQueued: this.activeTrack ? this.activeTrack.startedAt : null
        }));
        this.savePendingQueue();
    },

    pruneRecentRequests() {
        const cutoff = Date.now() - this.repeatBlockSeconds * 1000;

        this.recentRequests = this.recentRequests.filter(request => {
            const requestedAt = Date.parse(request.requestedAt);
            return Number.isFinite(requestedAt) && requestedAt >= cutoff;
        });

        this.saveRecentRequests();
    },

    rememberRecentRequest(username, trackId) {
        this.pruneRecentRequests();
        this.recentRequests.push({
            username,
            trackId,
            requestedAt: new Date().toISOString()
        });
        this.saveRecentRequests();
    },

    getRecentRequest(username, trackId) {
        this.pruneRecentRequests();
        return this.recentRequests.find(request => {
            return request.username === username && request.trackId === trackId;
        });
    },

    reconcileWithSpotifyQueue(spotifyQueue) {
        this.pendingQueue = reconcilePendingQueue(this.pendingQueue, spotifyQueue);
        this.savePendingQueue();
        return this.pendingQueue;
    },

    /**
     * Bring the song playing - and who asked for it - up to date with what
     * Spotify says, and drop the requests that have left its queue.
     *
     * `currentlyPlaying` and `spotifyQueue` have to describe the same moment;
     * services/syncQueue.js makes sure of that. Returns the song playing, or
     * null when nothing is.
     *
     * Spotify has no idea who queued anything, so the name comes from matching
     * what plays against Queueify's own pending list. A request is credited
     * only when what Spotify shows could not have come about another way:
     *
     * - That very copy has left Spotify's queue (sortPending follows each one
     *   by position, not just by song) and its song is what is playing now.
     *   Of several requests for the song that have left, the last is the one
     *   playing - the ones before it played first. This also covers a song
     *   that played while nobody was looking: the request is still matched,
     *   rather than lost because an older one was still in front of it.
     * - Or the streamer restarted a request part way through. It cannot have
     *   finished, so nothing else can have played: still that person's.
     *
     * The first also needs the time since Spotify was last read to be too
     * short for that request to have played right through already - see
     * couldHavePlayedUnseen. Anything else gets no name. Saying nothing is
     * always better than naming the wrong viewer.
     */
    updateActiveTrack(currentlyPlaying, spotifyQueue = null, now = Date.now()) {
        const playing = currentlyPlaying && currentlyPlaying.id ? currentlyPlaying : null;
        now = seenAt(playing, now);
        const observedAt = this.observedAt;
        this.observedAt = now;

        // Nothing playing: Spotify closed, a podcast, between devices. Nothing
        // else can have played either, so the song that was on is kept - when
        // it picks up again it is the same play by the same person. Wiping it
        // here lost the name of every request that was paused long enough for
        // Spotify to let go of the device. An empty queue is left alone too:
        // with no device it can read as empty, and believing that would drop
        // every request still waiting. One with songs in is real, and where
        // each request is in it is worth keeping track of.
        if (!playing) {
            if (this.activeTrack) this.activeTrack.lastSeenAt = now;
            if (Array.isArray(spotifyQueue) && spotifyQueue.length) {
                const sorted = this.followQueue(spotifyQueue, { playing: null, songStarted: false }, now);
                this.pendingQueue = sorted.waiting;
                this.savePendingQueue();
            }
            if (now - this.activeTrackSavedAt >= ACTIVE_TRACK_SAVE_MS) this.saveActiveTrack(now);
            return null;
        }

        const known = Array.isArray(spotifyQueue);
        const active = this.activeTrack;
        const expected = known ? expectedQueue(this.lastSpotifyQueue, this.lastSpotifyQueueAt, this.pendingQueue) : null;
        const moved = expected ? alignQueues(expected.map(entry => entry.track), spotifyQueue) : null;
        const playheadSays = !(active && sameTrack(active, playing) && !isAnotherPlay(active, playing, now));
        // The song at the front of the queue gone, and that same song playing:
        // either the next copy has just started (a skip), or its queued copy
        // was taken out while this one carries on. The playhead tells them
        // apart. A fresh copy cannot have got further than the time since the
        // last look; the old play cannot have gone backwards. When both fit -
        // the playhead at the start both times - there is no telling which it
        // was, and the request is credited anyway: either way the song that
        // viewer asked for is what is playing, straight away.
        const frontWent = Boolean(moved && expected.length && !moved.has(0) && sameTrack(expected[0].track, playing));
        const progress = playing.progressMs;
        const freshFits = Number.isFinite(progress) && progress <= REPLAY_START_WINDOW_MS &&
            !(active && Number.isFinite(active.lastSeenAt) && progress > now - active.lastSeenAt + PLAYHEAD_JITTER_MS);
        const carriedOnFits = Boolean(active && sameTrack(active, playing) &&
            !(Number.isFinite(progress) && Number.isFinite(active.lastProgressMs) && progress + PLAYHEAD_JITTER_MS < active.lastProgressMs));
        const frontStarted = frontWent && freshFits;
        const onlyTheFront = frontStarted && carriedOnFits && !playheadSays;
        const songStarted = playheadSays || frontStarted;
        const sorted = known
            // Only a play that is certainly new vouches that the front copy is what went.
            ? this.followQueue(spotifyQueue, { playing, songStarted: songStarted && !onlyTheFront, expected, moved, frontStarted }, now)
            : { waiting: this.pendingQueue, at: new Map(), left: [] };
        let waiting = sorted.waiting;
        const left = sorted.left;
        const leftCopy = lastIndexWhere(left, item => sameTrack(item, playing));

        // A request Spotify started before Queueify wrote it down is a new play
        // even with no jump in the playhead: it has never been in the queue
        // when read. One that has been is a different matter - leaving while
        // the same song carries on means it was taken out.
        const startedUnread = leftCopy !== -1 && !left[leftCopy].readSince &&
            (songStarted || active.startedAt !== left[leftCopy].playingWhenQueued);
        // The no-telling case above with no request among what left: either a
        // copy nobody asked for started, or it was taken out and this play
        // carries on. The song on is the same either way, so it keeps whoever
        // it already belonged to.
        const samePlay = (!songStarted || (onlyTheFront && leftCopy === -1)) && !startedUnread;

        if (samePlay) {
            active.lastProgressMs = playing.progressMs;
            active.lastSeenAt = now;
        } else {
            const trusted = item => item.creditable && !couldHavePlayedUnseen(item, playing, active, observedAt, now);
            let request = null;

            if (leftCopy !== -1) {
                if (trusted(left[leftCopy])) request = left[leftCopy];
            } else if (!known && waiting[0] && sameTrack(waiting[0], playing)) {
                // No queue to go on: only the head of the list can be it.
                request = waiting[0];
                waiting = waiting.slice(1);
            } else if (active && active.queuedBy && sameTrack(active, playing) && !couldHaveEnded(active, now) &&
                (!known || sorted.frontLeft === false)) {
                // Started again part way through: it cannot have finished, and
                // the queue has not moved, so nothing else can have started.
                request = active;
            }

            const base = request || unrequested(playing);
            this.activeTrack = normalizeActiveTrack({
                ...base,
                ids: [...new Set([...trackIds(base), ...trackIds(playing)])],
                durationMs: Number.isFinite(playing.durationMs) ? playing.durationMs : base.durationMs,
                startedAt: new Date(now).toISOString(),
                lastProgressMs: playing.progressMs,
                lastSeenAt: now
            });
        }

        if (known || waiting.length !== this.pendingQueue.length) {
            this.pendingQueue = waiting;
            this.savePendingQueue();
        }
        if (known || !samePlay || now - this.activeTrackSavedAt >= ACTIVE_TRACK_SAVE_MS) this.saveActiveTrack(now);

        return this.activeTrack;
    },

    /**
     * Line a fresh read of Spotify's queue up against the last one (see
     * sortPending), and note where each request still waiting now is.
     * Returns the split; the caller decides what to do with the ones that left.
     */
    followQueue(spotifyQueue, { playing, songStarted, expected, moved = null, frontStarted = false }, now) {
        const sorted = sortPending(this.pendingQueue, spotifyQueue, {
            playing,
            songStarted,
            frontStarted,
            // Which play is on, if it is the one already known: a new one has
            // no startedAt yet.
            playStartedAt: !songStarted && this.activeTrack ? this.activeTrack.startedAt : null,
            moved,
            // Positions from a read other than the last one saved - a crash
            // between the two writes - are no use to line up with, and
            // expectedQueue leaves them out.
            expected: expected !== undefined ? expected : expectedQueue(this.lastSpotifyQueue, this.lastSpotifyQueueAt, this.pendingQueue)
        });

        // No longer sure which copy is theirs: never credited from here.
        for (const item of sorted.ambiguous || []) item.creditable = false;
        for (const item of sorted.waiting) {
            const position = sorted.at.has(item) ? sorted.at.get(item) : null;
            if (position !== null) item.seenInQueue = true;
            item.readSince = true;
            item.queueAt = position;
            item.queueReadAt = now;
        }
        this.lastSpotifyQueue = spotifyQueue.map(item => ({ id: item.id, ids: trackIds(item) }));
        this.lastSpotifyQueueAt = now;

        return sorted;
    },

    /**
     * The cheap check between full syncs (services/playbackWatcher.js): keep
     * the playhead up to date while it is plainly the same play, without
     * asking Spotify for the queue.
     *
     * Returns false when it is not plainly the same play - a different song,
     * a restart, a gap that could hide one. That is never decided here: it
     * needs the queue, so the caller runs a full sync.
     */
    notePlayback(currentlyPlaying, now = Date.now()) {
        const playing = currentlyPlaying && currentlyPlaying.id ? currentlyPlaying : null;
        if (!playing) {
            this.updateActiveTrack(null, null, now);
            return true;
        }

        now = seenAt(playing, now);
        const active = this.activeTrack;
        if (!active || !sameTrack(active, playing) || isAnotherPlay(active, playing, now)) return false;

        this.observedAt = now;
        active.lastProgressMs = playing.progressMs;
        active.lastSeenAt = now;
        if (now - this.activeTrackSavedAt >= ACTIVE_TRACK_SAVE_MS) this.saveActiveTrack(now);
        return true;
    }
};

module.exports = state;
