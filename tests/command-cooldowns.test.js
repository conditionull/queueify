const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cooldowns = require('../services/commandCooldowns');

test.beforeEach(() => cooldowns.reset());

// A state stub: only commandCooldowns is read.
const withLimits = commandCooldowns => ({ commandCooldowns });

test('a command with no wait set always runs', () => {
    const state = withLimits({});

    for (let i = 0; i < 5; i += 1) {
        assert.strictEqual(cooldowns.allow(state, 'queue', 'kip'), true);
    }
});

test('a per-user wait holds that person and nobody else', () => {
    const state = withLimits({ active: { global: 0, user: 20 } });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now), true);
    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now + 5000), false);

    // Someone else is on their own clock.
    assert.strictEqual(cooldowns.allow(state, 'active', 'nyx', now + 5000), true);

    // And kip is free once the wait is up.
    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now + 20001), true);
});

test('a global wait stops a room taking turns', () => {
    const state = withLimits({ active: { global: 10, user: 0 } });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now), true);
    assert.strictEqual(cooldowns.allow(state, 'active', 'nyx', now + 1000), false,
        'a different person is still inside the shared wait');
    assert.strictEqual(cooldowns.allow(state, 'active', 'ash', now + 10001), true);
});

test('the two waits are independent, and the stricter one decides', () => {
    const state = withLimits({ active: { global: 5, user: 60 } });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now), true);

    // Past the global wait, but kip personally is still holding.
    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now + 6000), false);
    assert.strictEqual(cooldowns.allow(state, 'active', 'nyx', now + 6000), true);
});

test('a refused run does not restart the clock', () => {
    const state = withLimits({ active: { global: 0, user: 10 } });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now), true);

    // Spamming through the wait must not keep pushing it back, or somebody
    // holding the key down would never be let through at all.
    for (let at = now + 1000; at < now + 10000; at += 1000) {
        assert.strictEqual(cooldowns.allow(state, 'active', 'kip', at), false);
    }

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now + 10001), true);
});

test('each command has its own clock', () => {
    const state = withLimits({
        active: { global: 30, user: 0 },
        queue: { global: 30, user: 0 }
    });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now), true);
    assert.strictEqual(cooldowns.allow(state, 'queue', 'kip', now), true,
        'a wait on one command should not hold up another');
    assert.strictEqual(cooldowns.allow(state, 'active', 'kip', now + 1000), false);
});

test('the name is matched however it was typed', () => {
    const state = withLimits({ active: { global: 0, user: 30 } });
    const now = Date.now();

    assert.strictEqual(cooldowns.allow(state, 'active', 'KipTheCat', now), true);
    assert.strictEqual(cooldowns.allow(state, 'active', '  kipthecat ', now + 1000), false,
        'the same person under a different spelling is still the same person');
});

test('nonsense in the settings reads as no wait rather than throwing', () => {
    const now = Date.now();

    for (const bad of [undefined, null, {}, { global: 'soon', user: -4 }, { global: NaN }]) {
        cooldowns.reset();
        assert.strictEqual(cooldowns.allow(withLimits({ active: bad }), 'active', 'kip', now), true);
        assert.strictEqual(cooldowns.allow(withLimits({ active: bad }), 'active', 'kip', now + 1), true);
    }

    assert.strictEqual(cooldowns.allow({}, 'active', 'kip', now), true, 'and no settings at all is fine');
});

test('!np is given a wait out of the box, and a saved 0 is kept', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-cd-'));
    const statePath = require.resolve('../core/state');

    try {
        // Nothing saved: the built-in default stands.
        process.env.QUEUEIFY_DATA_DIR = sandbox;
        process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'fresh.json');
        delete require.cache[statePath];

        const fresh = require('../core/state');
        assert.deepStrictEqual(fresh.commandCooldowns.active, { global: 3, user: 20 });

        // Somebody has deliberately turned it off. A 0 has to survive, or the
        // default would quietly put the wait back on every restart.
        const settingsFile = path.join(sandbox, 'chosen.json');
        fs.writeFileSync(settingsFile, JSON.stringify({
            commandCooldowns: { active: { global: 0, user: 0 } }
        }));

        process.env.QUEUEIFY_SETTINGS_FILE = settingsFile;
        delete require.cache[statePath];

        const chosen = require('../core/state');
        assert.deepStrictEqual(chosen.commandCooldowns.active, { global: 0, user: 0 });
    } finally {
        delete process.env.QUEUEIFY_DATA_DIR;
        delete process.env.QUEUEIFY_SETTINGS_FILE;
        delete require.cache[statePath];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
});
