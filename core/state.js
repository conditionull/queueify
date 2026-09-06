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
const PROGRESS_RESET_GRACE_MS = 5000;
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
            chatEnabled: this.chatEnabled,
            redeemsEnabled: this.redeemsEnabled,
            allowExplicit: this.allowExplicit,
            spotifyRewardId: this.spotifyRewardId,
            broadcasterId: this.broadcasterId,
            previousSpotifyRewardId: this.previousSpotifyRewardId,
            activeWidgetPosition: this.activeWidgetPosition,
            widgetPresets: this.widgetPresets
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
            if (
                Number.isFinite(currentlyPlaying.progressMs) &&
                Number.isFinite(this.activeTrack.lastProgressMs) &&
                currentlyPlaying.progressMs + PROGRESS_RESET_GRACE_MS < this.activeTrack.lastProgressMs
            ) {
                return this.startActiveTrack(currentlyPlaying);
            }

            this.activeTrack.lastProgressMs = currentlyPlaying.progressMs;
            return this.activeTrack;
        }

        return this.startActiveTrack(currentlyPlaying);
    }
};

module.exports = state;
