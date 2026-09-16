const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

// QUEUEIFY_DATA_DIR lets tests (and the setup sandbox) point the persisted
// state at a throwaway directory instead of the real project files.
const DATA_DIR = process.env.QUEUEIFY_DATA_DIR || path.join(__dirname, '..');

const BLACKLIST_FILE = path.join(DATA_DIR, 'queue-blacklist.json');
const QUEUE_STATE_FILE = path.join(DATA_DIR, 'queue-state.json');
const QUEUE_SETTINGS_FILE = process.env.QUEUEIFY_SETTINGS_FILE || path.join(DATA_DIR, 'queue-settings.json');
const PENDING_QUEUE_FILE = path.join(DATA_DIR, 'queue-pending.json');
const RECENT_REQUESTS_FILE = path.join(DATA_DIR, 'queue-recent.json');

const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_REPEAT_BLOCK_SECONDS = 600;
const DEFAULT_MAX_SONG_LENGTH = 360;
// Commands that are worth a brake out of the box. !np asks Spotify what is
// playing and what is queued, so it is the one that costs something to spam.
// Anything absent here has no wait at all, and a command the user has set is
// kept exactly as they set it - including a deliberate 0.
const DEFAULT_COMMAND_COOLDOWNS = {
    active: { global: 3, user: 20 }
};
const PROGRESS_RESET_GRACE_MS = 5000;
// How near the start the playhead has to land for a jump backwards to mean the
// track is beginning again, rather than somebody scrubbing inside the play that
// is already going. See updateActiveTrack.
const REPLAY_START_WINDOW_MS = 5000;
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
        queuedBy: item.queuedBy,
        queuedAt: item.queuedAt || new Date().toISOString()
    };
}

function reconcilePendingQueue(pendingQueue, spotifyQueue) {
    for (let startIndex = 0; startIndex < pendingQueue.length; startIndex += 1) {
        let spotifyIndex = 0;
        let matchesQueue = true;

        for (let pendingIndex = startIndex; pendingIndex < pendingQueue.length; pendingIndex += 1) {
            const matchingIndex = spotifyQueue.findIndex(
                (spotifyItem, index) => index >= spotifyIndex && spotifyItem.id === pendingQueue[pendingIndex].id
            );

            if (matchingIndex === -1) {
                matchesQueue = false;
                break;
            }

            spotifyIndex = matchingIndex + 1;
        }

        if (matchesQueue) {
            return pendingQueue.slice(startIndex);
        }
    }

    return [];
}

const settings = loadJSON(QUEUE_SETTINGS_FILE, {});
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
    activeTrack: null,
    cooldowns: new Map(),
    widgetPresets: settings.widgetPresets ?? {},
    // Where each theme's widget was last seen on the OBS canvas, however it
    // got there - a !tr / !bc preset, or somebody dragging it. Presets say
    // where a theme belongs; this remembers where it actually was.
    widgetPositions: settings.widgetPositions ?? {},

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
            spotifyRewardId: this.spotifyRewardId,
            broadcasterId: this.broadcasterId,
            previousSpotifyRewardId: this.previousSpotifyRewardId,
            activeWidgetPosition: this.activeWidgetPosition,
            widgetPresets: this.widgetPresets,
            widgetPositions: this.widgetPositions
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

    saveRecentRequests() {
        saveJSON(RECENT_REQUESTS_FILE, this.recentRequests);
    },

    addPendingTrack(track, queuedBy) {
        if (!track?.id) return;

        this.pendingQueue.push(normalizePendingItem({
            ...track,
            queuedBy,
            queuedAt: new Date().toISOString()
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

    startActiveTrack(currentlyPlaying) {
        const nextPending = this.pendingQueue[0];
        if (nextPending?.id !== currentlyPlaying.id) {
            this.activeTrack = null;
            return null;
        }

        this.activeTrack = {
            ...nextPending,
            startedAt: new Date().toISOString(),
            lastProgressMs: currentlyPlaying.progressMs
        };
        this.pendingQueue.shift();
        this.savePendingQueue();

        return this.activeTrack;
    },

    updateActiveTrack(currentlyPlaying) {
        if (!currentlyPlaying) {
            this.activeTrack = null;
            return null;
        }

        if (this.activeTrack && this.activeTrack.id === currentlyPlaying.id) {
            const wentBackwards =
                Number.isFinite(currentlyPlaying.progressMs) &&
                Number.isFinite(this.activeTrack.lastProgressMs) &&
                currentlyPlaying.progressMs + PROGRESS_RESET_GRACE_MS < this.activeTrack.lastProgressMs;

            // Back to the very start means this is the *next* copy of the track
            // beginning: the same song can sit in the queue twice, and the
            // second one belongs to whoever asked for it, so it is re-read from
            // the pending queue.
            //
            // Landing anywhere else is somebody dragging the playhead inside
            // the song already playing. That is the same play by the same
            // person, so startedAt is left alone - it is what tells everything
            // downstream this is not a new play, and minting a fresh one both
            // lost the requester's name and logged the song as played twice.
            if (wentBackwards && currentlyPlaying.progressMs <= REPLAY_START_WINDOW_MS) {
                return this.startActiveTrack(currentlyPlaying);
            }

            this.activeTrack.lastProgressMs = currentlyPlaying.progressMs;
            return this.activeTrack;
        }

        return this.startActiveTrack(currentlyPlaying);
    }
};

module.exports = state;
