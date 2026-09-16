/**
 * How often a command may be run.
 *
 * Two waits per command, both optional and both set in the Admin Panel:
 *
 * - `global` - how long after anybody runs it before it answers again. Stops a
 *   room of people taking turns holding a command down, which a per-person
 *   wait on its own cannot
 * - `user` - how long that one person waits before their next go
 *
 * Only commands that actually cost something need one: !np reaches Spotify
 * twice, where !qon just flips a flag. Everything is 0 - no wait - unless it
 * has been given one.
 *
 * The clocks live here in memory, not in queue-settings.json. A wait that
 * survived a restart would hold people up for something they did before the
 * bot went down, and the moment a command was last run is not worth a disk
 * write per message.
 */

const lastRunAt = new Map();      // command -> when it last ran for anyone
const lastRunByUser = new Map();  // "command:user" -> when it last ran for them

function secondsOf(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** The pair configured for a command, with anything missing reading as no wait. */
function limitsFor(state, command) {
    const configured = state?.commandCooldowns?.[command] ?? {};

    return {
        global: secondsOf(configured.global),
        user: secondsOf(configured.user)
    };
}

/**
 * Whether to run it, recording the attempt when the answer is yes.
 *
 * Being turned down is silent by design, so this returns a plain boolean and
 * says nothing: telling everybody who asks to wait turns one person spamming a
 * command into the bot spamming the channel, which is the thing the wait is
 * there to prevent.
 */
function allow(state, command, username, now = Date.now()) {
    const { global, user } = limitsFor(state, command);
    if (!global && !user) return true;

    if (global) {
        const last = lastRunAt.get(command);
        if (last !== undefined && now - last < global * 1000) return false;
    }

    const key = String(username ?? '').trim().toLowerCase();

    if (user && key) {
        const last = lastRunByUser.get(`${command}:${key}`);
        if (last !== undefined && now - last < user * 1000) return false;
    }

    lastRunAt.set(command, now);
    if (key) lastRunByUser.set(`${command}:${key}`, now);

    return true;
}

/** Forgets every clock. For tests, and for nothing else. */
function reset() {
    lastRunAt.clear();
    lastRunByUser.clear();
}

module.exports = { allow, limitsFor, reset };
