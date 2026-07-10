const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const BLACKLIST_FILE = path.join(__dirname, '../queue-blacklist.json');
const QUEUE_STATE_FILE = path.join(__dirname, '../queue-state.json');
const QUEUE_SETTINGS_FILE = path.join(__dirname, '../queue-settings.json');
const PENDING_QUEUE_FILE = path.join(__dirname, '../queue-pending.json');
const RECENT_REQUESTS_FILE = path.join(__dirname, '../queue-recent.json');

const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_REPEAT_BLOCK_SECONDS = 600;
const DEFAULT_MAX_SONG_LENGTH = 360;
const PROGRESS_RESET_GRACE_MS = 5000;

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

function saveJSON(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
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
    const result = [];
    let searchStart = 0;

    for (const localItem of pendingQueue) {
        const matchIndex = spotifyQueue.findIndex((spotifyItem, index) => {
            return index >= searchStart && spotifyItem.id === localItem.id;
        });

        if (matchIndex === -1) continue;

        result.push(localItem);
        searchStart = matchIndex + 1;
    }

    return result;
}

const settings = loadJSON(QUEUE_SETTINGS_FILE, {});

const state = {
    blacklist: new Set(loadJSON(BLACKLIST_FILE, [])),
    queueEnabled: loadJSON(QUEUE_STATE_FILE, { enabled: true }).enabled ?? true,
    chatEnabled: loadJSON(QUEUE_SETTINGS_FILE, { chatEnabled: true }).chatEnabled ?? true,
    redeemsEnabled: loadJSON(QUEUE_SETTINGS_FILE, { redeemsEnabled: true }).redeemsEnabled ?? true,
    cooldownSeconds: settings.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    repeatBlockSeconds: settings.repeatBlockSeconds ?? DEFAULT_REPEAT_BLOCK_SECONDS,
    maxSongLength: settings.maxSongLength ?? DEFAULT_MAX_SONG_LENGTH,
    pendingQueue: loadJSON(PENDING_QUEUE_FILE, []).map(normalizePendingItem),
    recentRequests: loadJSON(RECENT_REQUESTS_FILE, []),
    activeTrack: null,
    cooldowns: new Map(),
    widgetPresets: settings.widgetPresets ?? {},

    saveBlacklist() {
        saveJSON(BLACKLIST_FILE, [...this.blacklist]);
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
            spotifyRewardId: this.spotifyRewardId,
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
