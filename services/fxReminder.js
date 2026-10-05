const perks = require('./perks');

/**
 * The chat reminder for !fx: a line the bot says every so often, so viewers
 * find out subs can pick an effect at all.
 *
 * Read from the settings on every tick, never kept, so turning it on, the
 * wait, and the wording all change while the bot runs.
 *
 * It only speaks once chat has said enough since it last did - how much is
 * the streamer's to set. A bot left running with the stream off, or a quiet
 * chat, would otherwise fill up with nothing but reminders. And it says
 * nothing while reward effects are off, since !fx would only answer that
 * they are.
 */

const TICK_MS = 30 * 1000;

function createFxReminder({ say, settings = () => require('../core/state').perks, now = Date.now }) {
    let lastSaid = now();
    let chatSince = 0;

    /** Any chat message but the bot's own. */
    function noteChat() {
        chatSince++;
    }

    /** Says the reminder if it is due. Returns what it said, or null. */
    function tick() {
        const state = require('../core/state');

        if (!state.queueEnabled || (!state.chatEnabled && !state.redeemsEnabled)) {
            return null;
        }

        const current = settings() || {};
        const reminder = current.reminder;

        // The wait starts again from when it is switched on, rather than
        // going off the moment somebody does.
        if (!current.enabled || !reminder || !reminder.enabled) {
            lastSaid = now();
            chatSince = 0;
            return null;
        }

        if (now() - lastSaid < reminder.minutes * 60 * 1000) return null;
        if (chatSince < reminder.chatLines) return null;

        const text = reminder.message.replace(/{{\s*url\s*}}/g, perks.pickerLink('fx', current));
        lastSaid = now();
        chatSince = 0;
        say(text);
        return text;
    }

    return { noteChat, tick };
}

/** Starts it for the bot's chat client. */
function start(client) {
    const reminder = createFxReminder({
        say: text => {
            const channel = client.getChannels()[0] || `#${process.env.TWITCH_BROADCASTER_USERNAME}`;
            Promise.resolve(client.say(channel, text)).catch(err => {
                console.warn('Could not send the !fx reminder:', err?.message || err);
            });
        }
    });

    setInterval(reminder.tick, TICK_MS).unref?.();
    return reminder;
}

module.exports = { createFxReminder, start, TICK_MS };
