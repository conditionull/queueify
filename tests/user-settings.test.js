const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const userSettingsPath = path.join(__dirname, '..', 'config', 'userSettings.js');

function freshSettings() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-settings-'));
    const settingsFile = path.join(tempDir, 'settings.js');

    process.env.QUEUEIFY_USER_SETTINGS_FILE = settingsFile;
    delete require.cache[require.resolve(userSettingsPath)];

    return { settings: require(userSettingsPath), settingsFile };
}

function cleanup(settingsFile) {
    delete process.env.QUEUEIFY_USER_SETTINGS_FILE;
    delete require.cache[require.resolve(userSettingsPath)];
    if (settingsFile) delete require.cache[settingsFile];
}

/** Writes the file with a mtime the reader is guaranteed to see as newer. */
function writeSettings(settingsFile, users) {
    fs.writeFileSync(settingsFile, `module.exports = { allowedUsers: ${JSON.stringify(users)} };\n`);
    const ahead = new Date(Date.now() + 2000);
    fs.utimesSync(settingsFile, ahead, ahead);
}

test('a missing settings file is created empty instead of being copied by hand', () => {
    const { settings, settingsFile } = freshSettings();

    try {
        assert.deepStrictEqual(settings.allowedUsers, []);
        assert.ok(fs.existsSync(settingsFile), 'settings.js should have been created');

        // The created file has to be loadable as-is, not a broken stub.
        const created = require(settingsFile);
        assert.deepStrictEqual(created.allowedUsers, []);
    } finally {
        cleanup(settingsFile);
    }
});

test('an existing settings file is never overwritten', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-settings-'));
    const settingsFile = path.join(tempDir, 'settings.js');
    fs.writeFileSync(settingsFile, 'module.exports = { allowedUsers: ["keepme"] };\n');

    process.env.QUEUEIFY_USER_SETTINGS_FILE = settingsFile;
    delete require.cache[require.resolve(userSettingsPath)];

    try {
        const settings = require(userSettingsPath);
        assert.deepStrictEqual(settings.allowedUsers, ['keepme']);
    } finally {
        cleanup(settingsFile);
    }
});

test('edits are picked up without restarting the bot', () => {
    const { settings, settingsFile } = freshSettings();

    try {
        assert.strictEqual(settings.isAllowedUser('viewer'), false);

        writeSettings(settingsFile, ['Viewer']);

        assert.strictEqual(settings.isAllowedUser('viewer'), true, 'saved edit should apply immediately');
        assert.strictEqual(settings.isAllowedUser('VIEWER'), true, 'names are case-insensitive');

        writeSettings(settingsFile, []);
        assert.strictEqual(settings.isAllowedUser('viewer'), false, 'removals apply too');
    } finally {
        cleanup(settingsFile);
    }
});

test('a broken settings file degrades to no whitelist instead of throwing', () => {
    const { settings, settingsFile } = freshSettings();

    try {
        fs.writeFileSync(settingsFile, 'module.exports = { allowedUsers: [ oops };\n');
        const ahead = new Date(Date.now() + 2000);
        fs.utimesSync(settingsFile, ahead, ahead);

        assert.deepStrictEqual(settings.allowedUsers, []);
        assert.strictEqual(settings.isAllowedUser('viewer'), false);
    } finally {
        cleanup(settingsFile);
    }
});

test('non-string entries are ignored rather than crashing a lookup', () => {
    const { settings, settingsFile } = freshSettings();

    try {
        fs.writeFileSync(settingsFile, 'module.exports = { allowedUsers: ["viewer", 42, null] };\n');
        const ahead = new Date(Date.now() + 2000);
        fs.utimesSync(settingsFile, ahead, ahead);

        assert.deepStrictEqual(settings.allowedUsers, ['viewer']);
        assert.strictEqual(settings.isAllowedUser('viewer'), true);
    } finally {
        cleanup(settingsFile);
    }
});
