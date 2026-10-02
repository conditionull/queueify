const perks = require('../services/perks');
const { sayMessage } = require('../services/messages');

/**
 * !fx - the effect a sub's songs play when they start.
 *
 * On its own it gives out the picker page, which previews every effect and
 * copies "!fx <name>" when one is tapped, so pasting that back in chat is the
 * whole job. The page is told which name this command was typed as, so a
 * channel that renamed it gets the right thing copied. A color can follow
 * the effect - `!fx hearts gold` - and the page adds one when it is chosen.
 */
module.exports = {
    name: 'fx',
    aliases: ['effect'],

    async execute({ client, channel, username, tags, message, args, state }) {
        const settings = state.perks;
        const typed = String(message || '!fx').split(' ')[0].replace(/^!/, '').toLowerCase() || 'fx';
        const url = perks.pickerLink(typed, settings);

        if (!settings.enabled) {
            sayMessage(client, channel, 'perks.disabled', { username });
            return;
        }

        // Only letters: `!fx Sakura!` or a pasted "!fx sakura," still works.
        // Kept short, since a reply that repeats it back has to fit in one
        // chat message.
        const word = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 25);
        let wanted = word(args[0]);
        let colors = word(args[1]);

        // `!fx gold hearts` means `!fx hearts gold`.
        if (perks.PALETTES.includes(wanted) && perks.EFFECTS.includes(colors)) [wanted, colors] = [colors, wanted];

        if (!wanted) {
            sayMessage(client, channel, 'perks.link', { username, url });
            return;
        }

        // The broadcaster cannot subscribe to their own channel, and should
        // still be able to try everything out, so they count as Tier 3.
        const broadcaster = process.env.TWITCH_BROADCASTER_USERNAME?.toLowerCase();
        const subTier = username === broadcaster ? 3 : await perks.subTierFrom(tags);
        const id = tags?.['user-id'];

        if (!subTier || !id) {
            sayMessage(client, channel, 'perks.notSub', { username, url });
            return;
        }

        if (wanted === 'off' || wanted === 'default') {
            perks.setPick(id, username, null);
            sayMessage(client, channel, 'perks.cleared', { username });
            return;
        }

        if (!perks.EFFECTS.includes(wanted) || !settings.subAccess[wanted]) {
            sayMessage(client, channel, 'perks.unknown', { username, effect: wanted, url });
            return;
        }

        // There, but for a higher sub tier than theirs.
        if (!perks.canPick(wanted, subTier, settings)) {
            sayMessage(client, channel, 'perks.needsTier', { username, effect: wanted, tier: settings.subAccess[wanted], url });
            return;
        }

        // A color after it is optional: `!fx hearts gold`.
        if (colors && !perks.PALETTES.includes(colors)) {
            sayMessage(client, channel, 'perks.unknownColor', { username, colors, list: perks.PALETTES.join(', ') });
            return;
        }

        perks.setPick(id, username, wanted, colors || null);
        sayMessage(client, channel, 'perks.set', {
            username,
            effect: colors && colors !== 'album' ? `${wanted} (${colors})` : wanted
        });
    }
};
