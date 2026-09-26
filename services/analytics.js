const fs = require('fs');

const history = require('./history');

/**
 * Turning the request log into the numbers the stats page shows.
 *
 * Everything here is derived on read. Nothing is ever written back: a running
 * total kept on disk is a derived value that can drift with no way to tell, and
 * re-reading the log is always right. At the sizes this reaches - a few tens of
 * thousands of lines after years of streaming - a full pass is a couple of
 * hundred milliseconds, once, and then it is cached until the file changes.
 *
 * Revisit that if the log ever passes ~50MB or a cold read passes ~500ms: the
 * fix is to split it by year and cache the years that are closed. Appending is
 * what makes that possible later, which is why it is not done now.
 */

// How long a quiet stretch has to be before it counts as a different stream.
// A constant, not a setting, and deliberately not written into the log - the
// moment it is stored, tuning it makes every stored value a lie.
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

const TOP_N = 10;

// Beyond this many people, comparing everybody with everybody stops being
// free. The overlap is a bit of fun, so it is only computed for the regulars.
const TWIN_CANDIDATES = 50;

// A play that ended before this much of the track had run is treated as cut
// short. Most skips happen inside Spotify and are invisible to us, so this is
// a floor on the real number.
const PLAYED_THROUGH = 0.75;

let cache = { key: null, value: null };

/* --------------------------------------------------------------- identity */

/**
 * Which rows are the same person.
 *
 * The id is the only thing that survives a rename, but it has not always been
 * recorded. Chat has always sent the lowercase login, so a login seen *with* an
 * id anywhere in the log is enough to claim every earlier id-less row for that
 * person. This is why the log is never rewritten to back-fill ids - reading it
 * this way recovers them anyway.
 */
function buildLoginIndex(events) {
    const loginToId = new Map();

    for (const event of events) {
        const user = event.user;
        if (user?.id && user.login && !loginToId.has(user.login)) {
            loginToId.set(user.login, user.id);
        }
    }

    return loginToId;
}

function identityKey(user, loginToId) {
    if (!user) return null;
    if (user.id) return `u:${user.id}`;

    if (user.login) {
        const known = loginToId.get(user.login);
        return known ? `u:${known}` : `l:${user.login}`;
    }

    if (user.display) return `n:${user.display.toLowerCase()}`;
    return null;
}

/* ----------------------------------------------------------------- shapes */

function trackKey(track) {
    if (!track) return null;
    // ISRC first: a remaster is a different Spotify id and the same recording,
    // and counting those apart makes "most requested song" quietly wrong.
    return track.isrc ? `isrc:${track.isrc}` : `id:${track.id}`;
}

function artistLabel(track) {
    return (track?.artists || []).map(artist => artist.name).join(', ');
}

function releaseYear(releaseDate) {
    // Spotify's precision varies between "1997", "1997-01" and "1997-01-20",
    // so the year is taken off the front rather than the string being parsed.
    const year = Number(String(releaseDate || '').slice(0, 4));
    return Number.isFinite(year) && year > 1900 ? year : null;
}

function increment(map, key, seed) {
    if (key === null || key === undefined) return null;

    if (!map.has(key)) map.set(key, seed());
    const entry = map.get(key);
    entry.count += 1;
    return entry;
}

function topBy(map, howMany = TOP_N, field = 'count') {
    return [...map.values()]
        .sort((a, b) => b[field] - a[field])
        .slice(0, howMany);
}

// Guards every ratio on the page. An install with no history must render
// zeroes, not NaN.
function ratio(part, whole) {
    return whole > 0 ? part / whole : 0;
}

/* ---------------------------------------------------------------- reading */

function sortByTime(events) {
    // Requests from different people run in parallel, so the order lines were
    // written in is the order they finished, not the order they were asked.
    return [...events].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function sessionize(events) {
    const sessions = [];
    let current = null;

    for (const event of events) {
        const at = Date.parse(event.t);
        if (!Number.isFinite(at)) continue;

        if (!current || at - current.lastAt > SESSION_GAP_MS) {
            current = { startedAt: event.t, endedAt: event.t, lastAt: at, events: [] };
            sessions.push(current);
        }

        current.endedAt = event.t;
        current.lastAt = at;
        current.events.push(event);
    }

    return sessions;
}

/* ------------------------------------------------------------- the numbers */

function summarize(allEvents) {
    const events = sortByTime(allEvents);
    const loginToId = buildLoginIndex(events);

    const requests = events.filter(event => event.type === 'request');
    const accepted = requests.filter(event => event.outcome === 'ok');
    const plays = events.filter(event => event.type === 'play');
    const skips = events.filter(event => event.type === 'skip');

    const viewers = new Map();
    const tracks = new Map();
    const artists = new Map();
    const rejections = new Map();
    const decades = new Map();
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);

    let queuedMs = 0;
    let explicitCount = 0;
    let popularityTotal = 0;
    let popularityCount = 0;

    for (const event of requests) {
        const at = new Date(event.t);
        if (Number.isFinite(at.getTime())) {
            hours[at.getHours()] += 1;
            weekdays[at.getDay()] += 1;
        }

        const key = identityKey(event.user, loginToId);
        const viewer = increment(viewers, key, () => ({
            key,
            name: event.user?.display || event.user?.login || 'someone',
            aliases: new Set(),
            count: 0,
            accepted: 0,
            rejected: 0,
            firstSeen: event.t,
            lastSeen: event.t,
            tracks: new Map(),
            artists: new Set(),
            outcomes: new Map()
        }));

        if (viewer) {
            // Events are in time order, so the last name seen wins and the
            // earlier ones become "also known as".
            if (event.user?.display && event.user.display !== viewer.name) {
                viewer.aliases.add(viewer.name);
                viewer.name = event.user.display;
            }
            viewer.lastSeen = event.t;
            viewer.outcomes.set(event.outcome, (viewer.outcomes.get(event.outcome) || 0) + 1);
        }

        if (event.outcome !== 'ok') {
            increment(rejections, event.outcome, () => ({ outcome: event.outcome, count: 0 }));
            if (viewer) viewer.rejected += 1;
            continue;
        }

        if (viewer) viewer.accepted += 1;

        const track = event.track;
        if (!track) continue;

        queuedMs += track.durationMs || 0;
        if (track.explicit) explicitCount += 1;

        if (Number.isFinite(track.popularity)) {
            popularityTotal += track.popularity;
            popularityCount += 1;
        }

        const tKey = trackKey(track);
        const trackEntry = increment(tracks, tKey, () => ({
            key: tKey,
            name: track.name,
            artists: artistLabel(track),
            durationMs: track.durationMs,
            releaseDate: track.releaseDate,
            popularity: track.popularity,
            explicit: track.explicit,
            count: 0,
            requesters: new Set()
        }));
        if (trackEntry && viewer) trackEntry.requesters.add(viewer.key);

        if (viewer && tKey) {
            viewer.tracks.set(tKey, (viewer.tracks.get(tKey) || 0) + 1);
        }

        // Counted per artist, not per credit line: a collaboration is a
        // request for both of them.
        for (const artist of track.artists || []) {
            const aKey = artist.id || `name:${artist.name}`;
            const entry = increment(artists, aKey, () => ({
                id: artist.id,
                name: artist.name,
                count: 0,
                tracks: new Set()
            }));
            if (entry && tKey) entry.tracks.add(tKey);
            if (viewer) viewer.artists.add(aKey);
        }

        const year = releaseYear(track.releaseDate);
        if (year) {
            const decade = Math.floor(year / 10) * 10;
            increment(decades, decade, () => ({ decade, count: 0 }));
        }
    }

    const sessions = sessionize(events);

    for (const [key, viewer] of viewers) {
        viewer.count = viewer.accepted + viewer.rejected;
        viewer.sessions = sessions.filter(session =>
            session.events.some(event =>
                event.type === 'request' && identityKey(event.user, loginToId) === key)
        ).length;
    }

    return {
        generatedAt: new Date().toISOString(),
        empty: events.length === 0,
        since: events[0]?.t ?? null,
        until: events[events.length - 1]?.t ?? null,
        totals: {
            events: events.length,
            requests: requests.length,
            accepted: accepted.length,
            rejected: requests.length - accepted.length,
            plays: plays.length,
            skips: skips.length,
            sessions: sessions.length,
            viewers: viewers.size,
            artists: artists.size,
            tracks: tracks.size
        },
        acceptanceRate: ratio(accepted.length, requests.length),
        explicitRatio: ratio(explicitCount, accepted.length),
        obscurity: popularityCount > 0 ? popularityTotal / popularityCount : null,
        queuedMs,
        sources: {
            chat: requests.filter(event => event.source === 'chat').length,
            redeem: requests.filter(event => event.source === 'redeem').length
        },
        hours,
        weekdays,
        rejections: topBy(rejections, 20),
        decades: [...decades.values()].sort((a, b) => a.decade - b.decade),
        topRequesters: topBy(viewers, TOP_N, 'accepted').map(viewerRow),
        topTracks: topBy(tracks).map(trackRow),
        topArtists: topBy(artists).map(artist => ({
            id: artist.id,
            name: artist.name,
            count: artist.count,
            tracks: artist.tracks.size
        })),
        oneHitWonders: [...artists.values()].filter(artist => artist.count === 1).length,
        extremes: extremesOf(tracks),
        signatures: signatureTracks(viewers, tracks),
        twins: tasteTwins(viewers),
        streaks: streaks(viewers, sessions, loginToId),
        mostSkipped: mostSkipped(plays),
        sessions: sessions.map(session => sessionRow(session, loginToId)).reverse()
    };
}

function viewerRow(viewer) {
    return {
        key: viewer.key,
        name: viewer.name,
        aliases: [...viewer.aliases],
        accepted: viewer.accepted,
        rejected: viewer.rejected,
        sessions: viewer.sessions,
        firstSeen: viewer.firstSeen,
        lastSeen: viewer.lastSeen
    };
}

function trackRow(track) {
    return {
        key: track.key,
        name: track.name,
        artists: track.artists,
        count: track.count,
        requesters: track.requesters.size,
        durationMs: track.durationMs,
        releaseDate: track.releaseDate,
        popularity: track.popularity
    };
}

function extremesOf(tracks) {
    const all = [...tracks.values()];
    if (all.length === 0) {
        return { longest: null, shortest: null, oldest: null, newest: null, obscurest: null, mainstream: null };
    }

    const withDuration = all.filter(track => Number.isFinite(track.durationMs));
    const withYear = all.filter(track => releaseYear(track.releaseDate));
    const withPopularity = all.filter(track => Number.isFinite(track.popularity));

    const pick = (list, compare) =>
        list.length ? trackRow(list.reduce(compare)) : null;

    return {
        longest: pick(withDuration, (a, b) => (b.durationMs > a.durationMs ? b : a)),
        shortest: pick(withDuration, (a, b) => (b.durationMs < a.durationMs ? b : a)),
        oldest: pick(withYear, (a, b) => (releaseYear(b.releaseDate) < releaseYear(a.releaseDate) ? b : a)),
        newest: pick(withYear, (a, b) => (releaseYear(b.releaseDate) > releaseYear(a.releaseDate) ? b : a)),
        obscurest: pick(withPopularity, (a, b) => (b.popularity < a.popularity ? b : a)),
        mainstream: pick(withPopularity, (a, b) => (b.popularity > a.popularity ? b : a))
    };
}

/**
 * The track that is most *theirs*.
 *
 * Scored as their plays squared over the total, so a song nobody else has ever
 * asked for beats one they happen to have queued twice and everybody else
 * queues too.
 */
function signatureTracks(viewers, tracks) {
    const signatures = [];

    for (const viewer of viewers.values()) {
        let best = null;

        for (const [key, mine] of viewer.tracks) {
            const track = tracks.get(key);
            if (!track) continue;

            const score = (mine * mine) / track.count;
            if (!best || score > best.score) {
                best = { score, mine, track };
            }
        }

        if (best) {
            signatures.push({
                viewer: viewer.name,
                key: viewer.key,
                name: best.track.name,
                artists: best.track.artists,
                count: best.mine,
                exclusive: best.track.requesters.size === 1
            });
        }
    }

    return signatures
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_N);
}

/** How much two people's taste in artists overlaps, for the regulars only. */
function tasteTwins(viewers) {
    const candidates = [...viewers.values()]
        .filter(viewer => viewer.artists.size >= 3)
        .sort((a, b) => b.accepted - a.accepted)
        .slice(0, TWIN_CANDIDATES);

    const pairs = [];

    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
            const a = candidates[i];
            const b = candidates[j];

            let shared = 0;
            for (const artist of a.artists) {
                if (b.artists.has(artist)) shared += 1;
            }
            if (shared === 0) continue;

            const union = a.artists.size + b.artists.size - shared;
            pairs.push({ a: a.name, b: b.name, shared, overlap: ratio(shared, union) });
        }
    }

    return pairs.sort((x, y) => y.overlap - x.overlap).slice(0, TOP_N);
}

/** Streams in a row with at least one request, counted in streams not days. */
function streaks(viewers, sessions, loginToId) {
    const attended = new Map();

    sessions.forEach((session, index) => {
        for (const event of session.events) {
            if (event.type !== 'request') continue;
            const key = identityKey(event.user, loginToId);
            if (!key) continue;

            if (!attended.has(key)) attended.set(key, new Set());
            attended.get(key).add(index);
        }
    });

    const rows = [];

    for (const [key, indexes] of attended) {
        const sorted = [...indexes].sort((a, b) => a - b);
        let longest = 1;
        let running = 1;

        for (let i = 1; i < sorted.length; i += 1) {
            running = sorted[i] === sorted[i - 1] + 1 ? running + 1 : 1;
            if (running > longest) longest = running;
        }

        // Only a streak that reaches the most recent stream is still alive.
        const current = sorted[sorted.length - 1] === sessions.length - 1 ? running : 0;

        rows.push({ key, name: viewers.get(key)?.name ?? key, current, longest });
    }

    return rows.sort((a, b) => b.longest - a.longest).slice(0, TOP_N);
}

/**
 * Tracks that kept getting cut short.
 *
 * Inferred from how long the next play took to arrive, because a skip inside
 * the Spotify client never reaches us. Never stored - it is only knowable once
 * the *following* play has happened.
 */
function mostSkipped(plays) {
    const counts = new Map();

    for (let i = 0; i < plays.length - 1; i += 1) {
        const play = plays[i];
        const heardFor = Date.parse(plays[i + 1].t) - Date.parse(play.t);

        if (!Number.isFinite(heardFor) || !play.durationMs) continue;
        // A gap longer than the track means the stream stopped or nobody made
        // a request for a while, not that anything was skipped.
        if (heardFor > play.durationMs) continue;
        if (heardFor >= play.durationMs * PLAYED_THROUGH) continue;

        increment(counts, play.trackId, () => ({
            trackId: play.trackId,
            name: play.name,
            artists: play.artists,
            count: 0
        }));
    }

    return topBy(counts);
}

function sessionRow(session, loginToId) {
    const requests = session.events.filter(event => event.type === 'request');
    const accepted = requests.filter(event => event.outcome === 'ok');
    const first = session.events.find(event => event.type === 'play')
        ?? accepted[0];

    const people = new Map();
    for (const event of requests) {
        const key = identityKey(event.user, loginToId);
        if (!key) continue;
        if (!people.has(key)) people.set(key, { name: event.user?.display || key, count: 0 });
        if (event.outcome === 'ok') people.get(key).count += 1;
    }

    const top = [...people.values()].sort((a, b) => b.count - a.count)[0] ?? null;

    return {
        // The first event's timestamp: a fact, stable, and enough to look the
        // session up again with a plain filter.
        id: session.startedAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: Date.parse(session.endedAt) - Date.parse(session.startedAt),
        requests: requests.length,
        accepted: accepted.length,
        rejected: requests.length - accepted.length,
        viewers: people.size,
        firstTrack: first
            ? {
                name: first.name ?? first.track?.name ?? null,
                artists: first.artists ?? artistLabel(first.track),
                by: first.queuedBy ?? first.user?.display ?? null
            }
            : null,
        topRequester: top
    };
}

/* ------------------------------------------------------------------ public */

/**
 * The log, cached until the file changes underneath us.
 *
 * Keyed on size and mtime rather than on what this process last appended: the
 * bot, the dashboard and a test can all be writing, so the file is the only
 * thing worth trusting.
 */
function cachedSummary() {
    let key = 'missing';

    try {
        const stat = fs.statSync(history.HISTORY_FILE);
        key = `${stat.size}:${stat.mtimeMs}`;
    } catch {
        // No log yet. Falls through to the empty summary below.
    }

    if (cache.key === key && cache.value) return cache.value;

    const value = summarize(history.readEvents());
    cache = { key, value };
    return value;
}

function getOverview() {
    const summary = cachedSummary();

    return {
        generatedAt: summary.generatedAt,
        empty: summary.empty,
        since: summary.since,
        until: summary.until,
        totals: summary.totals,
        acceptanceRate: summary.acceptanceRate,
        explicitRatio: summary.explicitRatio,
        obscurity: summary.obscurity,
        queuedMs: summary.queuedMs,
        sources: summary.sources,
        hours: summary.hours,
        weekdays: summary.weekdays,
        rejections: summary.rejections,
        decades: summary.decades,
        latestSession: summary.sessions[0] ?? null
    };
}

function getLeaderboards() {
    const summary = cachedSummary();

    return {
        empty: summary.empty,
        topRequesters: summary.topRequesters,
        topTracks: summary.topTracks,
        topArtists: summary.topArtists,
        mostSkipped: summary.mostSkipped,
        extremes: summary.extremes,
        signatures: summary.signatures,
        twins: summary.twins,
        streaks: summary.streaks,
        oneHitWonders: summary.oneHitWonders
    };
}

function getSessions() {
    return cachedSummary().sessions;
}

function clearCache() {
    cache = { key: null, value: null };
}

module.exports = {
    summarize,
    sessionize,
    getOverview,
    getLeaderboards,
    getSessions,
    clearCache,
    SESSION_GAP_MS
};
