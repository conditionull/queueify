const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so no test can reach a running Queueify.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const root = path.join(__dirname, '..');

// The check itself is one line in index.js's handleMessage, which cannot be
// required without starting the bot - so what is tested here is everything
// it stands on: the list as the bot reads it, and as the dashboard writes it.
const userSettingsPath = path.join(root, 'config', 'userSettings.js');
const adminPath = path.join(root, 'services', 'adminConfig.js');
const statePath = path.join(root, 'core', 'state.js');

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-blocklist-'));
    process.env.QUEUEIFY_USER_SETTINGS_FILE = path.join(dir, 'settings.js');
    process.env.QUEUEIFY_DATA_DIR = dir;
    process.env.QUEUEIFY_SETTINGS_FILE = path.join(dir, 'queue-settings.json');
    return dir;
}

function cleanup(dir) {
    for (const key of ['QUEUEIFY_USER_SETTINGS_FILE', 'QUEUEIFY_DATA_DIR', 'QUEUEIFY_SETTINGS_FILE']) {
        delete process.env[key];
    }
    for (const modulePath of [userSettingsPath, adminPath, statePath]) {
        delete require.cache[modulePath];
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

/** Writes the file with a mtime the reader is guaranteed to see as newer. */
function writeSettings(file, contents) {
    fs.writeFileSync(file, contents);
    const ahead = new Date(Date.now() + 2000);
    fs.utimesSync(file, ahead, ahead);
}

test('a file written before the blocklist existed still loads, with nobody blocked', () => {
    const dir = sandbox();

    try {
        writeSettings(process.env.QUEUEIFY_USER_SETTINGS_FILE, 'module.exports = { allowedUsers: ["viewer"] };\n');
        const settings = require(userSettingsPath);

        assert.deepStrictEqual(settings.allowedUsers, ['viewer']);
        assert.deepStrictEqual(settings.deniedUsers, []);
        assert.strictEqual(settings.isDeniedUser('viewer'), false);
    } finally {
        cleanup(dir);
    }
});

test('a blocklist edit applies without a restart, case-insensitively', () => {
    const dir = sandbox();

    try {
        const file = process.env.QUEUEIFY_USER_SETTINGS_FILE;
        const settings = require(userSettingsPath);
        assert.strictEqual(settings.isDeniedUser('TranslateBot'), false);

        writeSettings(file, 'module.exports = { allowedUsers: [], deniedUsers: ["translatebot"] };\n');
        assert.strictEqual(settings.isDeniedUser('TranslateBot'), true);

        writeSettings(file, 'module.exports = { allowedUsers: [], deniedUsers: ["translatebot", 7] };\n');
        assert.deepStrictEqual(settings.deniedUsers, ['translatebot'], 'anything that is not a name is dropped');
    } finally {
        cleanup(dir);
    }
});

test('saving one list from the dashboard keeps the other', () => {
    const dir = sandbox();

    try {
        const admin = require(adminPath);
        const file = process.env.QUEUEIFY_USER_SETTINGS_FILE;
        const read = () => {
            delete require.cache[require.resolve(file)];
            return require(file);
        };

        admin.writeWidgetAccess({ allowed: ['viewer'], denied: ['@TranslateBot', 'translatebot'] });
        assert.deepStrictEqual(read().deniedUsers, ['translatebot'], 'lower-cased, @ dropped, de-duplicated');

        // The whitelist is rewritten on its own - the blocklist must survive.
        admin.writeWhitelist(['someone_else']);
        assert.deepStrictEqual(read().allowedUsers, ['someone_else']);
        assert.deepStrictEqual(read().deniedUsers, ['translatebot']);

        // And the other way round.
        admin.writeWidgetAccess({ denied: [] });
        assert.deepStrictEqual(read().allowedUsers, ['someone_else']);
        assert.deepStrictEqual(read().deniedUsers, []);

        assert.throws(() => admin.writeWidgetAccess({ denied: ['not a name'] }), /not a Twitch username/);
        assert.throws(() => admin.writeWidgetAccess({ denied: 'everyone' }), /blocklist has to be a list/);
    } finally {
        cleanup(dir);
    }
});
