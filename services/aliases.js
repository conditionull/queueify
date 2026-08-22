const fs = require('fs');
const path = require('path');

const ALIASES_FILE = path.join(__dirname, '../config/aliases.json');
const RELOAD_DELAY_MS = 100;

let defaultAliases = {};
let activeAliases = {};
let reloadTimer;
let onReloadCallback = null;

function setDefaultAliases(aliases) {
    defaultAliases = aliases;
    loadAliases();
}

function loadAliases() {
    activeAliases = { ...defaultAliases };

    try {
        const parsed = JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf8'));
        activeAliases = { ...defaultAliases, ...parsed };
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`Failed to load ${path.basename(ALIASES_FILE)}; keeping default aliases:`, err.message);
        }
    }

    onReloadCallback?.();
}

function getAliases(commandName) {
    return activeAliases[commandName] ?? defaultAliases[commandName] ?? [];
}

function onReload(callback) {
    onReloadCallback = callback;
}

function watchAliases() {
    const watcher = fs.watchFile(ALIASES_FILE, { interval: 500 }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadAliases, RELOAD_DELAY_MS);
    });

    watcher.unref?.();
}

watchAliases();

module.exports = { setDefaultAliases, getAliases, onReload };
