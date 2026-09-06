const fs = require('fs');
const path = require('path');

// config/settings.js is user-owned and git-ignored: it names the viewers who
// are allowed to move the widget alongside mods. Rather than making people
// copy an example file into place (and remember to), it is created empty on
// first use and re-read whenever it changes - editing it never needs a
// restart, and a broken edit degrades to "no whitelist" instead of taking the
// bot down.
const SETTINGS_FILE = process.env.QUEUEIFY_USER_SETTINGS_FILE || path.join(__dirname, 'settings.js');

const TEMPLATE = `// Viewers who may move the widget with !topright / !bottomcenter even though
// they are not mods. Usernames are case-insensitive.
//
// Queueify re-reads this file whenever it changes, so save and use the command
// straight away - no restart needed.

module.exports = {
    allowedUsers: [
        // "viewer_name",
    ]
};
`;

const EMPTY = { allowedUsers: [] };

let cached = EMPTY;
// mtime + size of the file behind `cached`, so an unchanged file is not
// re-parsed on every chat command.
let cachedStamp = null;

function ensureFile() {
    if (fs.existsSync(SETTINGS_FILE)) return;

    try {
        // wx: never clobber a file that appeared since the check above.
        fs.writeFileSync(SETTINGS_FILE, TEMPLATE, { flag: 'wx' });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            console.warn(`Could not create ${SETTINGS_FILE}: ${err.message}`);
        }
    }
}

function fileStamp() {
    try {
        const stats = fs.statSync(SETTINGS_FILE);
        return `${stats.mtimeMs}:${stats.size}`;
    } catch {
        return null;
    }
}

function load() {
    ensureFile();

    const stamp = fileStamp();
    if (stamp === cachedStamp) return cached;

    cachedStamp = stamp;

    if (stamp === null) {
        cached = EMPTY;
        return cached;
    }

    try {
        // require() caches by path, so the previous copy has to go before a
        // saved edit can be seen.
        delete require.cache[require.resolve(SETTINGS_FILE)];
        const settings = require(SETTINGS_FILE);

        cached = {
            allowedUsers: Array.isArray(settings.allowedUsers)
                ? settings.allowedUsers.filter(user => typeof user === 'string')
                : []
        };
    } catch (err) {
        console.warn(`Ignoring ${path.basename(SETTINGS_FILE)} - it could not be loaded: ${err.message}`);
        cached = EMPTY;
    }

    return cached;
}

function isAllowedUser(username) {
    if (!username) return false;

    const name = String(username).toLowerCase();
    return load().allowedUsers.some(allowed => allowed.toLowerCase() === name);
}

// Eagerly, at startup: the file has to exist on disk for the user to find and
// edit it, not appear the first time somebody happens to run a command.
load();

module.exports = {
    SETTINGS_FILE,
    isAllowedUser,
    // Getter, not a snapshot: readers see the file as it is now.
    get allowedUsers() {
        return load().allowedUsers;
    }
};
