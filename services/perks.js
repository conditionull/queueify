const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

/**
 * Viewer rewards ("perks" in the code and the settings file): what the
 * widget plays when a viewer's song starts.
 *
 * Everything is earned by songs that got queued - chat or channel points, as
 * long as it went in. A viewer's count sets their tier, and each tier has an
 * effect. Some counts are milestones, which take the widget over for a few
 * seconds. Subs get an effect of their own, which they pick with !fx - from
 * the effects their sub tier opens up.
 *
 * The count is worked out when a request goes in, not when it plays, and is
 * carried on the queued song (core/state.js). That is what makes "their
 * 100th" right on stream even with three of their songs waiting, and what
 * keeps a song from changing its number while it sits in the queue.
 *
 * Which effect plays is decided when the song starts instead, from the
 * settings and picks as they are then: a sub who picks a new effect while
 * their song waits gets the new one, and so does a streamer who changes a tier.
 */

// The effects widget/public/effects.js can draw. Names are what chat types
// after !fx, so they are short, lowercase, and never renamed.
//
// Only ever added to at the end. The !fx link packs who may pick each one in
// this order (accessCode), and the picker page reads it against its own copy of the order
// (ORDER in queueify-site's fx.vue) - so a page newer than the bot never
// offers an effect the bot has not got.
const EFFECTS = [
    // Bursts: particles all over the widget.
    'sparkles', 'stars', 'confetti', 'hearts', 'notes', 'fireworks', 'pixels', 'coins', 'embers', 'bubbles', 'petals',
    // The widget itself: its own parts move.
    'scatter', 'wave', 'jelly', 'glitch', 'heartbeat', 'spotlight',
    // Light shows over and around it.
    'comet', 'neon', 'warp', 'aurora', 'scanline', 'lightning', 'supernova', 'vortex',
    // Glow: soft light, drifting and glinting, from textures.
    'bokeh', 'glimmer', 'fairy', 'mist', 'shine', 'flare', 'halo', 'glitter', 'wisps', 'love', 'starfall', 'fountain', 'bloom',
    // Magic: spells, from the same textures.
    'ripple', 'rune', 'blaze', 'meteors', 'swirl', 'portal', 'poof', 'crackle', 'slash', 'impact'
];

// The effects there were before the ones after them. A list of what subs may
// pick that was saved back then says nothing about anything added since, so
// those are open to every sub rather than locked away by a list that never
// knew them. See subAccess in normalizeSettings().
const FIRST_EFFECTS = [
    'sparkles', 'confetti', 'stars', 'hearts', 'embers', 'bubbles', 'petals', 'notes',
    'fireworks', 'supernova', 'comet', 'vortex', 'lightning', 'pixels', 'coins'
];

// Twitch's three sub tiers. Prime counts as Tier 1.
const SUB_TIERS = [1, 2, 3];

// The colors an effect can be drawn in: the album's own, or a fixed set.
// Also names chat types, after the effect: `!fx hearts gold`.
const PALETTES = ['album', 'rainbow', 'gold', 'silver', 'ice', 'fire', 'candy', 'neon', 'sunset'];

// How each effect looks, set by the streamer: its colors, and how many, how
// big, and how fast its particles are, each as a multiple of the default.
const STYLE_LIMITS = { amount: [0.25, 3], size: [0.4, 2.5], speed: [0.4, 2.5] };

function defaultStyle(effect) {
    // Coins are gold, whatever the album looks like, until somebody says otherwise.
    return { colors: effect === 'coins' ? 'gold' : 'album', amount: 1, size: 1, speed: 1 };
}

const DEFAULT_SETTINGS = {
    // The two halves are switched on and off apart: the effect a viewer's
    // song starts with, and the milestone takeover.
    enabled: true,
    milestonesEnabled: true,
    milestones: [10, 25, 50, 100, 250, 500, 1000],
    tiers: [
        { name: 'Petal', at: 10, effect: 'sparkles' },
        { name: 'Flower', at: 50, effect: 'stars' },
        { name: 'Blossom', at: 100, effect: 'embers' }
    ],
    // What a sub's songs play before they pick one of their own, by sub tier.
    subDefaults: { 1: 'sparkles', 2: 'scatter', 3: 'lightning' },
    // Which sub tier an effect needs to be picked: 1 is every sub, 2 is Tier 2
    // and up, 3 is Tier 3 only, and 0 is nobody.
    subAccess: Object.fromEntries(EFFECTS.map(effect => [effect, 1])),
    styles: Object.fromEntries(EFFECTS.map(effect => [effect, defaultStyle(effect)])),
    // Viewers cannot reach the streamer's machine, so the page they pick from
    // lives on the public docs site. See the /fx page in queueify-site.
    pickerUrl: 'https://queueify-docs.vercel.app/fx',
    // A line the bot says in chat every so often, so viewers find out !fx
    // exists. Off until the streamer turns it on: an update should never start
    // talking in somebody's chat. See services/fxReminder.js.
    reminder: {
        enabled: false,
        minutes: 20,
        // Chat messages since the last one, before it says it again.
        chatLines: 5,
        message: 'Subs: pick the effect your requested songs start with! Choose one here and paste it in chat: {{url}}'
    }
};

const MAX_MILESTONE = 1000000;

// Often enough to be seen, never so often it is all chat reads.
const REMINDER_MINUTES = [5, 240];
const REMINDER_CHAT_LINES = [1, 500];
// Twitch drops a message over 500 characters unsent, and the link {{url}}
// becomes is around 70 of them.
const REMINDER_MAX_LENGTH = 400;
const MAX_TIERS = 6;

// Settings file overrides cover the settings; this one covers the picks.
// Read at first use rather than at load, but tests should still set it first.
function picksFile() {
    return process.env.QUEUEIFY_VIEWER_EFFECTS_FILE || path.join(
        process.env.QUEUEIFY_DATA_DIR || path.join(__dirname, '..'),
        'viewer-effects.json'
    );
}

/* -------------------------------------------------------------- settings */

function effectOr(value, fallback, allowNone = true) {
    if (allowNone && value === 'none') return 'none';
    return EFFECTS.includes(value) ? value : fallback;
}

/**
 * Settings as stored, with anything missing or broken put back to the default.
 *
 * Also the validation for the admin page: what goes in is exactly what comes
 * back, so a value the page sends that makes no sense quietly becomes the
 * default instead of reaching the widget.
 */
function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};

    const milestones = Array.isArray(raw.milestones)
        ? [...new Set(raw.milestones.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= MAX_MILESTONE))]
            .sort((a, b) => a - b)
        : [...DEFAULT_SETTINGS.milestones];

    const tiers = Array.isArray(raw.tiers)
        ? raw.tiers
            .filter(tier => tier && typeof tier === 'object')
            .map(tier => ({
                name: String(tier.name || '').trim().slice(0, 24) || 'Tier',
                at: Math.round(Number(tier.at)),
                effect: effectOr(tier.effect, 'sparkles')
            }))
            .filter(tier => Number.isFinite(tier.at) && tier.at > 0 && tier.at <= MAX_MILESTONE)
            .sort((a, b) => a.at - b.at)
            .slice(0, MAX_TIERS)
        : DEFAULT_SETTINGS.tiers.map(tier => ({ ...tier }));

    // Saved as the tier each effect needs. Settings from before tiers kept a
    // plain list of what subs may pick: in it is every tier, out of it is
    // nobody - but only for the effects that list could have known about.
    const accessIn = raw.subAccess && typeof raw.subAccess === 'object' ? raw.subAccess : {};
    const legacy = Array.isArray(raw.subEffects) ? raw.subEffects : null;
    const subAccess = Object.fromEntries(EFFECTS.map(effect => {
        const given = Number(accessIn[effect]);
        if (accessIn[effect] !== undefined && [0, 1, 2, 3].includes(given)) return [effect, given];
        if (legacy && FIRST_EFFECTS.includes(effect)) return [effect, legacy.includes(effect) ? 1 : 0];
        return [effect, 1];
    }));

    const defaultsIn = raw.subDefaults && typeof raw.subDefaults === 'object' ? raw.subDefaults : {};
    // One effect for every sub, from before tiers, fills in for all three.
    const oneDefault = raw.subDefault !== undefined ? effectOr(raw.subDefault, null) : null;
    const subDefaults = Object.fromEntries(SUB_TIERS.map(tier =>
        [tier, effectOr(defaultsIn[tier], oneDefault || DEFAULT_SETTINGS.subDefaults[tier])]));

    const stylesIn = raw.styles && typeof raw.styles === 'object' ? raw.styles : {};
    const styles = Object.fromEntries(EFFECTS.map(effect => {
        const given = stylesIn[effect] && typeof stylesIn[effect] === 'object' ? stylesIn[effect] : {};
        const style = defaultStyle(effect);
        if (PALETTES.includes(given.colors)) style.colors = given.colors;
        for (const [key, [min, max]] of Object.entries(STYLE_LIMITS)) {
            const value = Number(given[key]);
            if (given[key] !== undefined && given[key] !== null && Number.isFinite(value)) {
                style[key] = Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
            }
        }
        return [effect, style];
    }));

    const pickerUrl = isWebAddress(raw.pickerUrl) ? String(raw.pickerUrl).trim() : DEFAULT_SETTINGS.pickerUrl;

    const reminderIn = raw.reminder && typeof raw.reminder === 'object' ? raw.reminder : {};
    const minutes = Math.round(Number(reminderIn.minutes));
    const [fewest, most] = REMINDER_MINUTES;
    const chatLines = Math.round(Number(reminderIn.chatLines));
    const [fewestLines, mostLines] = REMINDER_CHAT_LINES;
    const reminder = {
        enabled: reminderIn.enabled === true,
        minutes: Number.isFinite(minutes) ? Math.min(most, Math.max(fewest, minutes)) : DEFAULT_SETTINGS.reminder.minutes,
        chatLines: Number.isFinite(chatLines)
            ? Math.min(mostLines, Math.max(fewestLines, chatLines))
            : DEFAULT_SETTINGS.reminder.chatLines,
        message: String(reminderIn.message ?? '').replace(/\s+/g, ' ').trim().slice(0, REMINDER_MAX_LENGTH) ||
            DEFAULT_SETTINGS.reminder.message
    };

    return {
        enabled: raw.enabled !== false,
        // Before milestones had a switch of their own, `enabled` was the one
        // switch for everything - so off stays off for both.
        milestonesEnabled: raw.milestonesEnabled !== undefined ? raw.milestonesEnabled !== false : raw.enabled !== false,
        milestones,
        tiers,
        subDefaults,
        subAccess,
        styles,
        pickerUrl,
        reminder
    };
}

function isWebAddress(value) {
    const text = String(value || '').trim();
    if (!/^https?:\/\/\S+$/i.test(text)) return false;
    try {
        new URL(text);
        return true;
    } catch {
        return false;
    }
}

function settings() {
    return require('../core/state').perks || normalizeSettings();
}

/** Whether a sub of this tier may pick this effect. */
function canPick(effect, subTier, perkSettings = settings()) {
    const needs = perkSettings.subAccess ? perkSettings.subAccess[effect] : 0;
    return Boolean(needs) && Number(subTier) >= needs;
}

/** Every effect a sub of this tier may pick. */
function effectsFor(subTier, perkSettings = settings()) {
    return EFFECTS.filter(effect => canPick(effect, subTier, perkSettings));
}

/**
 * A chatter's sub tier from their chat tags: 0 when they do not subscribe.
 *
 * Twitch numbers the subscriber badge by tier - the months for Tier 1 (and
 * Prime), 2000 and up for Tier 2, 3000 and up for Tier 3. A founder wears
 * the founder badge instead, which says nothing of tier, so they count as
 * Tier 1 - still a sub, never locked out.
 */
function subTierOf(tags) {
    if (!tags || !tags.subscriber) return 0;
    const badge = Number(tags.badges && tags.badges.subscriber);
    if (badge >= 3000) return 3;
    if (badge >= 2000) return 2;
    return 1;
}

/**
 * A chatter's sub tier, asking Twitch when the badge could be wrong.
 *
 * The badge always knows whether they subscribe, and a Tier 3 badge is
 * always right. Anything less might be a Tier 2 or 3 sub in a channel without
 * badges of its own for those - see services/subTiers.js. Twitch can only
 * ever raise it: a sub is never locked out because Twitch did not answer.
 */
async function subTierFrom(tags) {
    const badge = subTierOf(tags);
    if (!badge || badge >= 3) return badge;
    const asked = await require('./subTiers').tierOf(tags['user-id']);
    return Math.max(badge, asked || 0);
}

/**
 * A redeemer's sub tier. A redeem carries no badge, so it is Twitch's word,
 * or failing that what chat last showed - and null if neither knows.
 */
async function redeemerSubTier(id) {
    const asked = await require('./subTiers').tierOf(id);
    const seen = subscribes(id);
    if (asked === null) return seen;
    return Math.max(asked, seen || 0);
}

/* --------------------------------------------------------------- counting */

// Accepted requests per viewer. Built from the log once, then kept up by
// accept() - the log only ever grows by the lines accept() already counted.
let counts = null;
let loginToId = null;

function userOf(requester = {}, username) {
    const login = requester.userLogin ?? username;

    return {
        id: requester.userId ? String(requester.userId) : null,
        login: login ? String(login).trim().toLowerCase() : null
    };
}

function load() {
    if (counts) return;

    const { readEvents } = require('./history');
    const { buildLoginIndex, identityKey } = require('./analytics');

    const events = readEvents();
    loginToId = buildLoginIndex(events);
    counts = new Map();

    for (const event of events) {
        if (event.type !== 'request' || event.outcome !== 'ok') continue;
        const key = identityKey(event.user, loginToId);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
}

function keyOf(user) {
    load();
    const { identityKey } = require('./analytics');

    // Somebody seen with an id for the first time owns what they queued
    // before ids were recorded, the same as on the stats page.
    if (user.id && user.login && !loginToId.has(user.login)) {
        loginToId.set(user.login, user.id);
        const before = counts.get(`l:${user.login}`);
        if (before) {
            counts.set(`u:${user.id}`, (counts.get(`u:${user.id}`) || 0) + before);
            counts.delete(`l:${user.login}`);
        }
    }

    return identityKey(user, loginToId);
}

/** How many songs this viewer has had queued so far. */
function acceptedCount(requester, username) {
    const key = keyOf(userOf(requester, username));
    return key ? counts.get(key) || 0 : 0;
}

/**
 * Counts a request that went in, and returns what the queued song carries:
 * which of theirs it is, and their sub tier.
 *
 * Called once per accepted request, just before it is logged, so the count
 * and the log never disagree.
 */
function accept(requester, username) {
    const user = userOf(requester, username);
    const key = keyOf(user);
    const number = key ? (counts.get(key) || 0) + 1 : null;
    if (key) counts.set(key, number);

    // From chat, the request says; a redeem does not, so it is whatever was
    // seen of them in chat last.
    const known = typeof requester?.sub === 'boolean';
    const subTier = known ? (requester.sub ? Number(requester.subTier) || 1 : 0) : subscribes(user.id);
    if (user.id && known) noteSub(user.id, subTier);

    return {
        requestNumber: number,
        requesterId: user.id,
        requesterSub: subTier === null ? null : subTier > 0,
        requesterSubTier: subTier
    };
}

/** For tests: forget the counts, so the next call reads the log again. */
function reset() {
    counts = null;
    loginToId = null;
    picks = null;
    subs.clear();
}

/* ------------------------------------------------------------------ tiers */

function tierOf(count, tiers = settings().tiers) {
    let tier = null;
    for (const candidate of tiers) if (count >= candidate.at) tier = candidate;
    return tier;
}

function isMilestone(count, milestones = settings().milestones) {
    return milestones.includes(count);
}

/* ------------------------------------------------------------------ picks */

// id -> { effect, login, at }. Small: only viewers who have run !fx <name>.
let picks = null;
let pickWrites = Promise.resolve();

// Each viewer's sub tier (0 for none), as of the last chat message we saw
// from them. A channel point redeem does not say, so this is what answers.
const subs = new Map();

function readPicks() {
    if (picks) return picks;

    try {
        const parsed = JSON.parse(fs.readFileSync(picksFile(), 'utf8'));
        picks = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Failed to read viewer-effects.json:', err.message);
        picks = {};
    }

    return picks;
}

function savePicks() {
    const body = JSON.stringify(picks, null, 2);
    const file = picksFile();

    // Written beside it and moved into place, so the file is never half
    // written: not to a reader, and not after a crash mid-write.
    pickWrites = pickWrites
        .then(async () => {
            await fsPromises.writeFile(file + '.tmp', body);
            await fsPromises.rename(file + '.tmp', file);
        })
        .catch(err => {
            console.error('Failed to save viewer-effects.json:', err.message);
        });
    return pickWrites;
}

function noteSub(id, tier) {
    if (id) subs.set(String(id), Number(tier) || 0);
}

/** A viewer's sub tier as last seen in chat - 0 for none - or null if never seen. */
function subscribes(id) {
    return id ? subs.get(String(id)) ?? null : null;
}

/** Any chat message: remember its sender's sub tier. */
function noteChatter(tags) {
    const id = tags?.['user-id'];
    if (!id) return;
    // What Twitch said of their tier beats the badge, which may undersell it.
    const badge = subTierOf(tags);
    noteSub(id, badge ? Math.max(badge, require('./subTiers').cached(id) || 0) : 0);
}

function pickOf(id) {
    return id ? readPicks()[String(id)]?.effect || null : null;
}

/** The colors a viewer picked with their effect, or null for the streamer's. */
function pickColorsOf(id) {
    const colors = id ? readPicks()[String(id)]?.colors : null;
    return PALETTES.includes(colors) ? colors : null;
}

/** Saves a viewer's own effect, and colors if they chose some; `null` goes back to the default. */
function setPick(id, login, effect, colors = null) {
    if (!id) return false;
    const all = readPicks();

    if (effect) {
        all[String(id)] = {
            effect,
            ...(PALETTES.includes(colors) && colors !== 'album' ? { colors } : {}),
            login: login ? String(login).toLowerCase() : null,
            at: new Date().toISOString()
        };
    } else if (all[String(id)]) {
        delete all[String(id)];
    } else {
        return false;
    }

    savePicks();
    return true;
}

/** For tests: wait for the picks file to be written. */
function flush() {
    return pickWrites;
}

/* ------------------------------------------------------------------- song */

/**
 * What to play for a queued song as it starts, or null for nothing.
 *
 * A sub's own effect wins - if their sub tier still opens it - then the
 * channel's effect for their sub tier, then the effect for how many songs
 * they have requested. A milestone takes the widget over on top of whichever
 * that is, and a milestone with no effect still does.
 *
 * Only what the widget draws leaves here: the number, the name to put in
 * the banner, and the effect. Not the viewer's id.
 */
function forSong(item, perkSettings = settings()) {
    if (!item || (!perkSettings.enabled && !perkSettings.milestonesEnabled)) return null;

    const number = Number(item.requestNumber);
    if (!Number.isInteger(number) || number < 1) return null;

    const tiers = perkSettings.tiers;
    const tier = tierOf(number, tiers);
    const sub = item.requesterSub === true;
    // Queued before tiers were recorded: a sub, so Tier 1.
    const subTier = sub ? clampTier(item.requesterSubTier) : 0;

    let effect = null;
    let colors = null;
    let power = tier ? tiers.indexOf(tier) + 1 : 0;

    if (sub && perkSettings.enabled) {
        const own = pickOf(item.requesterId);
        const mine = Boolean(own && canPick(own, subTier, perkSettings));
        const chosen = mine ? own : (perkSettings.subDefaults || {})[subTier];
        if (chosen && chosen !== 'none') {
            effect = chosen;
            if (mine) colors = pickColorsOf(item.requesterId);
            // A sub's effect is never the smallest, whatever their count, and
            // a Tier 3 sub gets the biggest.
            power = Math.max(power, subTier >= 3 ? 3 : 2);
        }
    }

    if (!effect && tier && tier.effect !== 'none' && perkSettings.enabled) effect = tier.effect;

    const milestone = perkSettings.milestonesEnabled && isMilestone(number, perkSettings.milestones) ? number : null;
    if (!effect && !milestone) return null;

    // The streamer's look for the effect, in the sub's own colors if they chose some.
    const style = effect ? { ...((perkSettings.styles && perkSettings.styles[effect]) || defaultStyle(effect)) } : null;
    if (style && colors) style.colors = colors;

    return {
        number,
        milestone,
        tier: tier ? tier.name : null,
        effect,
        style,
        power: Math.min(Math.max(power, 1), 3),
        sub,
        name: String(item.queuedBy || '')
    };
}

function clampTier(tier) {
    const n = Math.round(Number(tier));
    return n >= 1 && n <= 3 ? n : 1;
}

// The characters `a` is written in: safe in a link, as they are.
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Who may pick each effect, packed short: the sub tier each one needs, in
 * EFFECTS order - 1 every sub, 2 Tier 2 and up, 3 Tier 3, 0 nobody - three
 * effects to a character. 48 effects make 16 characters, however they are set.
 *
 * setup/public/admin.html packs it again for its Open button, from settings
 * not yet saved - a change here has to go there too.
 */
function accessCode(perkSettings = settings()) {
    const access = perkSettings.subAccess || {};
    const tiers = EFFECTS.map(effect => ([1, 2, 3].includes(access[effect]) ? access[effect] : 0));
    let code = '';
    for (let i = 0; i < tiers.length; i += 3) code += CODE[(tiers[i] << 4) | ((tiers[i + 1] || 0) << 2) | (tiers[i + 2] || 0)];
    return code;
}

/**
 * The link !fx gives out: the picker page, told the command, and who may
 * pick what as accessCode() - the page unpacks it.
 *
 * The page cannot ask the bot anything, so the link has to carry it all -
 * but naming every effect would crowd the chat message it goes out in
 * towards Twitch's 500 characters, past which the message is dropped unsent.
 */
function pickerLink(command, perkSettings = settings()) {
    const url = new URL(isWebAddress(perkSettings.pickerUrl) ? perkSettings.pickerUrl : DEFAULT_SETTINGS.pickerUrl);
    url.searchParams.set('c', command);
    url.searchParams.set('a', accessCode(perkSettings));
    return url.toString();
}

module.exports = {
    EFFECTS,
    SUB_TIERS,
    PALETTES,
    STYLE_LIMITS,
    REMINDER_MINUTES,
    REMINDER_CHAT_LINES,
    REMINDER_MAX_LENGTH,
    defaultStyle,
    DEFAULT_SETTINGS,
    normalizeSettings,
    acceptedCount,
    accept,
    tierOf,
    isMilestone,
    noteChatter,
    subscribes,
    subTierOf,
    subTierFrom,
    redeemerSubTier,
    canPick,
    effectsFor,
    pickOf,
    pickColorsOf,
    setPick,
    forSong,
    pickerLink,
    accessCode,
    flush,
    reset
};
