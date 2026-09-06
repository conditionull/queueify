const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so the file-writing fallback is what runs.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const { buildCatalogue, GROUPS, HELP } = require('../services/commandCatalogue');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function commandModules() {
    return fs.readdirSync(COMMANDS_DIR)
        .filter(file => file.endsWith('.js'))
        .map(file => require(path.join(COMMANDS_DIR, file)))
        .filter(command => command?.name && command?.execute);
}

test('the dashboard lists every command chat answers to', () => {
    const listed = buildCatalogue().flatMap(group => group.commands).map(command => command.name).sort();
    const actual = commandModules().map(command => command.name).sort();

    assert.deepStrictEqual(listed, actual);
});

/**
 * The point of this one: adding a command without describing it should fail
 * here rather than quietly showing up in the dashboard with a blank line.
 */
test('every command is documented', () => {
    const missing = commandModules()
        .map(command => command.name)
        .filter(name => !HELP[name]?.summary);

    assert.deepStrictEqual(missing, [], `add these to services/commandCatalogue.js: ${missing.join(', ')}`);
});

test('who may run a command comes from the command itself', () => {
    const commands = Object.fromEntries(
        buildCatalogue().flatMap(group => group.commands).map(command => [command.name, command])
    );

    for (const command of commandModules()) {
        const entry = commands[command.name];

        if (entry.audience === 'mods + whitelisted viewers') continue;

        assert.strictEqual(
            entry.audience,
            command.modOnly ? 'mods' : 'everyone',
            `${command.name} is described as "${entry.audience}"`
        );
    }

    // The two widget commands are the ones a whitelist can also reach.
    assert.strictEqual(commands.topright.audience, 'mods + whitelisted viewers');
    assert.strictEqual(commands.bottomcenter.audience, 'mods + whitelisted viewers');
});

test('commands arrive grouped, sorted and with their aliases', () => {
    const catalogue = buildCatalogue();

    for (const { group, commands } of catalogue) {
        assert.ok(GROUPS.includes(group), `unexpected group ${group}`);
        assert.deepStrictEqual(
            commands.map(command => command.name),
            [...commands.map(command => command.name)].sort(),
            `${group} is not in order`
        );
    }

    const queue = catalogue.flatMap(group => group.commands).find(command => command.name === 'queue');
    assert.ok(queue.aliases.includes('q'), 'aliases should come from the live alias list');
    assert.ok(queue.forms.length >= 2, 'a command with several forms should show them');
});

test('the API hands the dashboard the same list', async () => {
    const { createApp } = require('../setup/server');
    const server = await new Promise(resolve => {
        const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        const port = server.address().port;
        const { groups } = await (await fetch(`http://127.0.0.1:${port}/api/commands`)).json();

        assert.deepStrictEqual(
            groups.flatMap(group => group.commands).map(command => command.name).sort(),
            commandModules().map(command => command.name).sort()
        );
    } finally {
        await new Promise(done => server.close(done));
    }
});
