const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const state = require('../core/state');
const setRewardEnabled = require('./setRewardEnabled');
const aliases = require('./aliases');
const userSettings = require('../config/userSettings');
const { buildCatalogue } = require('./commandCatalogue');

/**
 * Reading and writing the things the bot is configured with, for the admin
 * pages.
 *
 * Everything here goes to the same files the bot already watches - queue
 * settings through `core/state`, aliases and messages as their own JSON - so a
 * change from the browser lands exactly where a change by hand would, and is
 * picked up without a restart.
 */

const MESSAGES_FILE = process.env.QUEUEIFY_MESSAGES_FILE
    || path.join(__dirname, '..', 'config', 'messages.json');

const ALIASES_FILE = process.env.QUEUEIFY_ALIASES_FILE
    || path.join(__dirname, '..', 'config', 'aliases.json');

class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.code = 'invalid_config';
    }
}

/* ------------------------------------------------------------- settings */

// Everything an admin can change about how the queue behaves, with the limits
// the chat commands enforce, so both routes agree.
const QUEUE_FIELDS = {
    cooldownSeconds: { label: 'Wait between requests', min: 0, max: 3600, unit: 'seconds' },
    repeatBlockSeconds: { label: 'Block the same song for', min: 0, max: 86400, unit: 'seconds' },
    maxSongLength: { label: 'Longest song allowed', min: 1, max: 3600, unit: 'seconds' },
    chatEnabled: { label: 'Requests from chat', type: 'boolean' },
    redeemsEnabled: { label: 'Channel point requests', type: 'boolean' },
    allowExplicit: { label: 'Allow explicit tracks', type: 'boolean' },
    queueEnabled: { label: 'Queue open', type: 'boolean' }
};

function readQueueSettings() {
    const values = {};

    for (const key of Object.keys(QUEUE_FIELDS)) {
        values[key] = state[key];
    }

    return values;
}

/**
 * Applies the queue settings, doing whatever the matching chat command does.
 *
 * Most of these are just a flag the bot reads. Channel point requests are not:
 * !redeemon and !redeemoff also enable or disable the reward on Twitch, so
 * that viewers cannot spend points on something the bot is ignoring. Setting
 * the flag alone left the reward live and the points being taken.
 */
async function writeQueueSettings(input = {}) {
    const changed = [];

    for (const [key, field] of Object.entries(QUEUE_FIELDS)) {
        if (!(key in input)) continue;
        if (key === 'redeemsEnabled') continue;   // handled below, it talks to Twitch

        if (field.type === 'boolean') {
            const value = Boolean(input[key]);
            if (state[key] === value) continue;
            state[key] = value;
        } else {
            const value = Number(input[key]);

            if (!Number.isFinite(value) || value < field.min || value > field.max) {
                throw new ConfigError(`${field.label} must be between ${field.min} and ${field.max}.`);
            }

            const rounded = Math.round(value);
            if (state[key] === rounded) continue;
            state[key] = rounded;
        }

        changed.push(key);
    }

    if (changed.length) {
        state.saveSettings();
        // Whether the queue is open lives in its own file.
        if (changed.includes('queueEnabled')) state.saveQueueState();
    }

    // Last, because it is the only one that can be refused by somebody else.
    // Everything above is already saved by then, so a sulking Twitch does not
    // take an unrelated change down with it.
    if ('redeemsEnabled' in input && Boolean(input.redeemsEnabled) !== state.redeemsEnabled) {
        await setRedeemsEnabled(Boolean(input.redeemsEnabled));
        changed.push('redeemsEnabled');
    }

    return { changed };
}

/**
 * Turns the channel point reward on or off on Twitch, then records it.
 *
 * The order matters: if Twitch refuses, the flag is left alone, so the bot and
 * the reward never disagree about whether points should be spent.
 */
async function setRedeemsEnabled(enabled) {
    if (!state.spotifyRewardId || !state.broadcasterId) {
        throw new ConfigError(
            'The channel point reward is not set up yet. Create it on the setup dashboard first.'
        );
    }

    try {
        await setRewardEnabled(state.broadcasterId, state.spotifyRewardId, enabled);
    } catch (err) {
        // Twitch's own explanation is more use than a generic failure, but
        // only its first line: the rest is a wall of advice for the terminal.
        const [reason] = String(err.message).split(/\r?\n/);
        throw new ConfigError(`Twitch would not ${enabled ? 'enable' : 'disable'} the reward: ${reason}`);
    }

    state.redeemsEnabled = enabled;
    state.saveSettings();
}

/* ------------------------------------------------------------ whitelist */

function writeWhitelist(users) {
    if (!Array.isArray(users)) throw new ConfigError('The whitelist has to be a list of names.');

    const cleaned = [...new Set(users
        .map(user => String(user || '').trim().toLowerCase())
        .filter(Boolean))];

    for (const user of cleaned) {
        if (!/^[a-z0-9_]{1,25}$/.test(user)) {
            throw new ConfigError(`"${user}" is not a Twitch username.`);
        }
    }

    const body = `// Viewers who may move the widget with !topright / !bottomcenter even though
// they are not mods. Usernames are case-insensitive.
//
// Queueify re-reads this file whenever it changes, so save and use the command
// straight away - no restart needed.

module.exports = {
    allowedUsers: [
${cleaned.map(user => `        ${JSON.stringify(user)}`).join(',\n')}${cleaned.length ? '\n' : ''}    ]
};
`;

    fs.writeFileSync(userSettings.SETTINGS_FILE, body);
    return cleaned;
}

/* -------------------------------------------------------------- aliases */

function readAliases() {
    const commands = buildCatalogue().flatMap(group => group.commands);

    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf8'));
    } catch {
        // No file yet, or a broken one: the defaults stand on their own.
    }

    return commands.map(command => ({
        name: command.name,
        group: command.group,
        summary: command.summary,
        defaults: aliases.getDefaults(command.name),
        aliases: command.aliases,
        customised: Array.isArray(saved[command.name])
    }));
}

async function writeAliases(input = {}) {
    const known = new Set(buildCatalogue().flatMap(group => group.commands).map(command => command.name));
    const cleaned = {};
    const taken = new Map();

    for (const [name, list] of Object.entries(input)) {
        if (!known.has(name)) throw new ConfigError(`There is no command called "${name}".`);
        if (!Array.isArray(list)) throw new ConfigError(`Aliases for "${name}" have to be a list.`);

        const names = [...new Set(list
            .map(alias => String(alias || '').trim().toLowerCase().replace(/^!/, ''))
            .filter(Boolean))];

        for (const alias of names) {
            if (!/^[a-z0-9_-]{1,30}$/.test(alias)) {
                throw new ConfigError(`"${alias}" cannot be a command name - use letters, numbers, - and _.`);
            }

            // Two commands answering to one word means one of them never runs.
            const owner = taken.get(alias);
            if (owner && owner !== name) {
                throw new ConfigError(`"!${alias}" is set on both ${owner} and ${name}.`);
            }
            if (known.has(alias) && alias !== name) {
                throw new ConfigError(`"!${alias}" is already the name of another command.`);
            }

            taken.set(alias, name);
        }

        cleaned[name] = names;
    }

    await fsPromises.writeFile(ALIASES_FILE, JSON.stringify(cleaned, null, 4) + '\n');
    return cleaned;
}

/* ------------------------------------------------------------- messages */

function readMessages() {
    const defaults = require('./messages').defaults;

    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    } catch {
        // Same as above: the defaults are the fallback.
    }

    const groups = [];

    for (const [category, entries] of Object.entries(defaults)) {
        groups.push({
            category,
            messages: Object.entries(entries).map(([key, fallback]) => {
                const current = saved[category]?.[key];

                return {
                    key,
                    text: typeof current === 'string' ? current : fallback,
                    fallback,
                    // The bits that get replaced at runtime, so the editor can
                    // warn when one goes missing.
                    placeholders: [...new Set((fallback.match(/{{\s*[\w.]+\s*}}/g) || []))],
                    customised: typeof current === 'string' && current !== fallback
                };
            })
        });
    }

    return groups;
}

async function writeMessages(input = {}) {
    const defaults = require('./messages').defaults;
    const output = {};

    for (const [category, entries] of Object.entries(input)) {
        if (!defaults[category]) throw new ConfigError(`There is no message group called "${category}".`);
        output[category] = {};

        for (const [key, text] of Object.entries(entries)) {
            const fallback = defaults[category][key];
            if (typeof fallback !== 'string') throw new ConfigError(`There is no message called "${category}.${key}".`);

            const value = String(text ?? '').trim();
            if (!value) throw new ConfigError(`"${category}.${key}" cannot be empty.`);
            if (value.length > 480) throw new ConfigError(`"${category}.${key}" is too long for Twitch chat.`);

            // A message that drops a placeholder loses the very thing it was
            // meant to say, so that is refused rather than half-working.
            for (const placeholder of fallback.match(/{{\s*[\w.]+\s*}}/g) || []) {
                if (!value.includes(placeholder)) {
                    throw new ConfigError(`"${category}.${key}" needs to keep ${placeholder}.`);
                }
            }

            output[category][key] = value;
        }
    }

    await fsPromises.writeFile(MESSAGES_FILE, JSON.stringify(output, null, 2) + '\n');
    return output;
}

module.exports = {
    ConfigError,
    QUEUE_FIELDS,
    MESSAGES_FILE,
    ALIASES_FILE,
    readQueueSettings,
    writeQueueSettings,
    setRedeemsEnabled,
    writeWhitelist,
    readAliases,
    writeAliases,
    readMessages,
    writeMessages
};
