const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so no test can reach a running Queueify.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const adminPath = path.join(__dirname, '..', 'services', 'adminConfig.js');
const statePath = path.join(__dirname, '..', 'core', 'state.js');
const userSettingsPath = path.join(__dirname, '..', 'config', 'userSettings.js');
const messagesPath = path.join(__dirname, '..', 'services', 'messages.js');

function freshAdmin() {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-admin-'));

    process.env.QUEUEIFY_DATA_DIR = sandbox;
    process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
    process.env.QUEUEIFY_USER_SETTINGS_FILE = path.join(sandbox, 'settings.js');
    process.env.QUEUEIFY_MESSAGES_FILE = path.join(sandbox, 'messages.json');
    process.env.QUEUEIFY_ALIASES_FILE = path.join(sandbox, 'aliases.json');

    for (const modulePath of [statePath, userSettingsPath, adminPath]) {
        delete require.cache[require.resolve(modulePath)];
    }

    return { admin: require(adminPath), sandbox };
}

function cleanup(sandbox) {
    for (const key of ['QUEUEIFY_DATA_DIR', 'QUEUEIFY_SETTINGS_FILE', 'QUEUEIFY_USER_SETTINGS_FILE',
        'QUEUEIFY_MESSAGES_FILE', 'QUEUEIFY_ALIASES_FILE']) {
        delete process.env[key];
    }
    for (const modulePath of [statePath, userSettingsPath, adminPath]) {
        delete require.cache[require.resolve(modulePath)];
    }
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
}

test('queue settings written from the admin page are the ones the bot uses', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const state = require(statePath);

        await admin.writeQueueSettings({ cooldownSeconds: 45, allowExplicit: false, queueEnabled: false });

        assert.strictEqual(state.cooldownSeconds, 45, 'the running bot sees it immediately');
        assert.strictEqual(state.allowExplicit, false);
        assert.strictEqual(state.queueEnabled, false);

        await new Promise(resolve => setTimeout(resolve, 250));
        const saved = JSON.parse(fs.readFileSync(process.env.QUEUEIFY_SETTINGS_FILE, 'utf8'));
        assert.strictEqual(saved.cooldownSeconds, 45, 'and it survives a restart');
    } finally {
        cleanup(sandbox);
    }
});

test('a setting outside its limits is refused, with the limits in the message', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        await assert.rejects(() => admin.writeQueueSettings({ cooldownSeconds: 99999 }), /between 0 and 3600/);
        await assert.rejects(() => admin.writeQueueSettings({ maxSongLength: 0 }), /between 1 and 3600/);
        await assert.rejects(() => admin.writeQueueSettings({ cooldownSeconds: 'soon' }), /between/);
    } finally {
        cleanup(sandbox);
    }
});

test('the whitelist is rewritten as a file the bot can still load', () => {
    const { admin, sandbox } = freshAdmin();

    try {
        admin.writeWhitelist([' SomeViewer ', 'another_one', 'SOMEVIEWER']);

        const file = process.env.QUEUEIFY_USER_SETTINGS_FILE;
        delete require.cache[require.resolve(file)];

        // Written as real JavaScript, lower-cased, with the duplicate dropped.
        assert.deepStrictEqual(require(file).allowedUsers, ['someviewer', 'another_one']);
    } finally {
        cleanup(sandbox);
    }
});

test('something that is not a username is refused', () => {
    const { admin, sandbox } = freshAdmin();

    try {
        assert.throws(() => admin.writeWhitelist(['not a name']), /not a Twitch username/);
        assert.throws(() => admin.writeWhitelist(['"); process.exit(1); //']), /not a Twitch username/);
        assert.throws(() => admin.writeWhitelist('everyone'), /list of names/);
    } finally {
        cleanup(sandbox);
    }
});

test('two commands cannot be given the same alias', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        await assert.rejects(
            () => admin.writeAliases({ skip: ['next'], active: ['next'] }),
            /set on both/
        );

        // Nor can an alias shadow another command's own name.
        await assert.rejects(() => admin.writeAliases({ skip: ['queue'] }), /already the name/);
        await assert.rejects(() => admin.writeAliases({ nonsense: ['x'] }), /no command called/);
        await assert.rejects(() => admin.writeAliases({ skip: ['not valid!'] }), /cannot be a command name/);
    } finally {
        cleanup(sandbox);
    }
});

test('aliases are tidied on the way in', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const saved = await admin.writeAliases({ skip: ['  !NEXT ', 'next', 'nextsong'] });

        // The leading !, the case and the duplicate all go.
        assert.deepStrictEqual(saved.skip, ['next', 'nextsong']);
        assert.deepStrictEqual(
            JSON.parse(fs.readFileSync(process.env.QUEUEIFY_ALIASES_FILE, 'utf8')).skip,
            ['next', 'nextsong']
        );
    } finally {
        cleanup(sandbox);
    }
});

test('a message that drops a placeholder is refused, not silently broken', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        await assert.rejects(
            () => admin.writeMessages({ queue: { cooldown: 'wait a bit' } }),
            /needs to keep {{username}}|needs to keep {{seconds}}/
        );

        await assert.rejects(() => admin.writeMessages({ queue: { cooldown: '' } }), /cannot be empty/);
        await assert.rejects(() => admin.writeMessages({ nope: { a: 'b' } }), /no message group/);
        await assert.rejects(() => admin.writeMessages({ queue: { nope: 'b' } }), /no message called/);
        await assert.rejects(
            () => admin.writeMessages({ queue: { cooldown: '@{{username}} {{seconds}} ' + 'x'.repeat(500) } }),
            /too long for Twitch chat/
        );
    } finally {
        cleanup(sandbox);
    }
});

test('a good message edit is written and read back as customised', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        await admin.writeMessages({ queue: { closed: '@{{username}} the queue is shut, sorry!' } });

        const groups = admin.readMessages();
        const queue = groups.find(group => group.category === 'queue');
        const closed = queue.messages.find(entry => entry.key === 'closed');

        assert.strictEqual(closed.text, '@{{username}} the queue is shut, sorry!');
        assert.strictEqual(closed.customised, true);
        assert.ok(closed.fallback.includes('{{username}}'), 'the original is kept for the reset button');
        assert.deepStrictEqual(closed.placeholders, ['{{username}}']);
    } finally {
        cleanup(sandbox);
    }
});

test('every message the bot can say is editable from the admin page', () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const defaults = require(messagesPath).defaults;
        const listed = admin.readMessages();

        assert.deepStrictEqual(
            listed.map(group => group.category).sort(),
            Object.keys(defaults).sort()
        );

        for (const group of listed) {
            assert.deepStrictEqual(
                group.messages.map(entry => entry.key).sort(),
                Object.keys(defaults[group.category]).sort(),
                `${group.category} is missing messages`
            );
        }
    } finally {
        cleanup(sandbox);
    }
});

/**
 * !redeemon and !redeemoff do two things: flip the flag, and enable or disable
 * the reward on Twitch. The admin toggle was only doing the first, so viewers
 * could still spend points on a reward the bot was ignoring.
 */
test('turning channel point requests on needs the reward to exist', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const state = require(statePath);
        state.spotifyRewardId = null;
        state.broadcasterId = null;
        state.redeemsEnabled = false;

        await assert.rejects(
            () => admin.writeQueueSettings({ redeemsEnabled: true }),
            /reward is not set up yet/
        );

        // And the flag is left alone, so the bot and Twitch cannot disagree.
        assert.strictEqual(state.redeemsEnabled, false);
    } finally {
        cleanup(sandbox);
    }
});

test('a refusal from Twitch does not take the other settings down with it', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const state = require(statePath);
        state.spotifyRewardId = 'reward-id';
        state.broadcasterId = 'broadcaster-id';
        state.redeemsEnabled = false;

        await assert.rejects(() => admin.writeQueueSettings({
            cooldownSeconds: 90,
            redeemsEnabled: true
        }), /Twitch would not enable the reward/);

        // The reward is the only part anybody else gets a say in, so it is done
        // last: the wait is already saved by the time Twitch refuses.
        assert.strictEqual(state.cooldownSeconds, 90);
        assert.strictEqual(state.redeemsEnabled, false);
    } finally {
        cleanup(sandbox);
    }
});

test('a refusal from Twitch leaves the setting as it was', async () => {
    const { admin, sandbox } = freshAdmin();

    try {
        const state = require(statePath);
        state.spotifyRewardId = 'reward-id';
        state.broadcasterId = 'broadcaster-id';
        state.redeemsEnabled = false;

        // No Twitch token in a sandbox, so the call cannot succeed.
        await assert.rejects(
            () => admin.writeQueueSettings({ redeemsEnabled: true }),
            error => /Twitch would not enable the reward/.test(error.message)
        );

        assert.strictEqual(state.redeemsEnabled, false, 'the flag only moves once Twitch agrees');
    } finally {
        cleanup(sandbox);
    }
});
