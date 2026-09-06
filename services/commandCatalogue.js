const fs = require('fs');
const path = require('path');

/**
 * What the dashboard shows on its Commands tab.
 *
 * Names, aliases and who may run a command are read from the command modules
 * themselves - including any aliases the user has renamed in
 * config/aliases.json - so the list cannot drift from what chat actually
 * accepts. Only the prose lives here.
 */

const COMMANDS_DIR = process.env.QUEUEIFY_COMMANDS_DIR || path.join(__dirname, '..', 'commands');

const GROUPS = ['Queue', 'Playback', 'Widget', 'Moderation', 'Settings'];

// group: which card it appears under.
// audience: who chat lets run it - 'mods' comes from the module, this is only
// for the two commands whitelisted viewers may also use.
// forms: the ways it can be typed, most useful first.
const HELP = {
    queue: {
        group: 'Queue',
        summary: 'Request a song, or see what is waiting.',
        forms: [
            ['<spotify link>', 'Add that track to the Spotify queue'],
            ['', 'Show up to 10 songs still pending']
        ]
    },
    qon: { group: 'Queue', summary: 'Open the queue so viewers can request songs.' },
    qoff: { group: 'Queue', summary: 'Close the queue. Requests are turned away until it reopens.' },
    chaton: { group: 'Queue', summary: 'Allow requests typed in chat.' },
    chatoff: { group: 'Queue', summary: 'Stop taking requests from chat. Channel point redeems still work.' },
    redeemon: { group: 'Queue', summary: 'Enable the channel point reward for song requests.' },
    redeemoff: { group: 'Queue', summary: 'Disable the channel point reward. Points spent while it is off are refunded.' },

    active: { group: 'Playback', summary: 'Say what is playing right now.' },
    skip: { group: 'Playback', summary: 'Skip to the next track. Needs Spotify Premium and an active device.' },

    topright: {
        group: 'Widget',
        audience: 'mods + whitelisted viewers',
        summary: 'Move the widget to your saved "top right" spot.',
        forms: [
            ['', 'Move the widget there'],
            ['set', 'Save the widget\'s current position in OBS as this spot (mods only)']
        ]
    },
    bottomcenter: {
        group: 'Widget',
        audience: 'mods + whitelisted viewers',
        summary: 'Move the widget to your saved "bottom center" spot.',
        forms: [
            ['', 'Move the widget there'],
            ['set', 'Save the widget\'s current position in OBS as this spot (mods only)']
        ]
    },
    where: { group: 'Widget', summary: 'Report the widget\'s current X and Y position in OBS.' },
    theme: {
        group: 'Widget',
        summary: 'Switch the widget\'s look, including themes you made in the editor.',
        forms: [
            ['', 'List every theme available'],
            ['<name>', 'Switch to that theme']
        ]
    },

    deny: { group: 'Moderation', summary: 'Stop a viewer from queueing songs.', forms: [['<username>', '']] },
    allow: { group: 'Moderation', summary: 'Let a blocked viewer queue songs again.', forms: [['<username>', '']] },
    blockartist: { group: 'Moderation', summary: 'Block an artist, including when they are only featured.', forms: [['<artist>', '']] },
    unblockartist: { group: 'Moderation', summary: 'Unblock an artist.', forms: [['<artist>', '']] },
    blocksong: { group: 'Moderation', summary: 'Block one specific song.', forms: [['<spotify link>', '']] },
    unblocksong: { group: 'Moderation', summary: 'Unblock a song.', forms: [['<spotify link>', '']] },
    explicit: { group: 'Moderation', summary: 'Allow or refuse explicit tracks.', forms: [['on | off', '']] },

    delay: {
        group: 'Settings',
        summary: 'How long a viewer waits between requests.',
        forms: [['', 'Show the current cooldown'], ['<seconds>', 'Change it (0-3600)']]
    },
    repeatdelay: {
        group: 'Settings',
        summary: 'How long before the same song can be requested again.',
        forms: [['', 'Show the current window'], ['<seconds>', 'Change it (0-86400)']]
    },
    duration: {
        group: 'Settings',
        summary: 'The longest song the queue will accept.',
        forms: [['', 'Show the current limit (anyone)'], ['<seconds>', 'Change it (mods only)']]
    }
};

let cache = null;

function loadModules() {
    const files = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith('.js'));
    const modules = [];

    for (const file of files) {
        try {
            const command = require(path.join(COMMANDS_DIR, file));
            if (command?.name && command?.execute) modules.push(command);
        } catch (err) {
            console.warn(`Could not read ${file} for the command list: ${err.message}`);
        }
    }

    return modules;
}

/**
 * Every command chat will answer to, grouped for display. Built once and kept,
 * except for aliases, which are re-read so a rename in config/aliases.json
 * shows up without a restart.
 */
function buildCatalogue() {
    const aliases = require('./aliases');

    if (!cache) {
        const modules = loadModules();

        // Registering the built-in aliases is normally index.js's job; doing it
        // here too means the dashboard is right when it runs on its own.
        aliases.setDefaultAliases(
            Object.fromEntries(modules.map(command => [command.name, command.aliases || []]))
        );

        cache = modules.map(command => {
            const help = HELP[command.name] || {};

            return {
                name: command.name,
                group: help.group || 'Settings',
                audience: help.audience || (command.modOnly ? 'mods' : 'everyone'),
                summary: help.summary || '',
                forms: help.forms || [],
                documented: Boolean(help.summary)
            };
        });
    }

    const commands = cache
        .map(command => ({ ...command, aliases: aliases.getAliases(command.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return GROUPS
        .map(group => ({ group, commands: commands.filter(command => command.group === group) }))
        .filter(entry => entry.commands.length);
}

module.exports = { buildCatalogue, GROUPS, HELP };
