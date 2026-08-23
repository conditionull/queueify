const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const BLACKLIST_FILE = path.join(__dirname, '../queue-blacklist.json');
const QUEUE_STATE_FILE = path.join(__dirname, '../queue-state.json');
const QUEUE_SETTINGS_FILE = path.join(__dirname, '../queue-settings.json');
const PENDING_QUEUE_FILE = path.join(__dirname, '../queue-pending.json');
const RECENT_REQUESTS_FILE = path.join(__dirname, '../queue-recent.json');

const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_REPEAT_BLOCK_SECONDS = 600;
const DEFAULT_MAX_SONG_LENGTH = 360;
const PROGRESS_RESET_GRACE_MS = 5000;
const MAX_WRITE_RETRY = 3;

const pendingWrites = new Map();

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

function scheduleWrite(file, value, retries = 0) {
    if (pendingWrites.has(file)) {
        clearTimeout(pendingWrites.get(file).timer);
    }

    const timer = setTimeout(async () => {
        pendingWrites.delete(file);
        try {
            await fsPromises.writeFile(file, JSON.stringify(value, null, 2));
        } catch (err) {
            console.error(`Failed to save ${path.basename(file)}:`, err.message);
            if (retries < MAX_WRITE_RETRY) {
                const retryDelay = 200;
                console.warn(`Retrying write to ${path.basename(file)} in ${retryDelay}ms (${retries + 1}/${MAX_WRITE_RETRY})`);
                setTimeout(() => scheduleWrite(file, value, retries + 1), retryDelay);
            } else {
                console.error(`Max retries exceeded for ${path.basename(file)}`);
            }
        }
    }, 100);

    pendingWrites.set(file, { timer, value });
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
    const remainingCounts = new Map();
    for (const spotifyItem of spotifyQueue) {
        remainingCounts.set(spotifyItem.id, (remainingCounts.get(spotifyItem.id) || 0) + 1);
    }

    const result = [...pendingQueue];

    while (result.length > 0) {
        const remaining = remainingCounts.get(result[0].id);

        if (!remaining) {
            result.shift();
            continue;
        }

        remainingCounts.set(result[0].id, remaining - 1);
        break;
    }

    return result;
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
    themeTakeoverDurationSeconds: settings.themeTakeoverDurationSeconds ?? 3600,
    activeWidgetPosition: settings.activeWidgetPosition ?? "topright",
    themeTakeoverRewardId: settings.themeTakeoverRewardId ?? null,
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
            themeTakeoverDurationSeconds: this.themeTakeoverDurationSeconds,
            chatEnabled: this.chatEnabled,
            redeemsEnabled: this.redeemsEnabled,
            allowExplicit: this.allowExplicit,
            spotifyRewardId: this.spotifyRewardId,
            themeTakeoverRewardId: this.themeTakeoverRewardId,
            activeWidgetPosition: this.activeWidgetPosition,
            widgetPresets: this.widgetPresets
        });
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
