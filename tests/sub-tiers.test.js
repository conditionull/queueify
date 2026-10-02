const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A sub's tier comes from Twitch when the chat badge might undersell it: a
 * channel without its own Tier 2 and 3 badges gives a Tier 3 sub the Tier 1
 * badge, and !fx used to turn them away from Tier 3 effects.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-subtiers-'));

// Before any require: history, core/state and perks all resolve these.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = path.join(sandbox, 'queue-history.jsonl');
process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
process.env.QUEUEIFY_VIEWER_EFFECTS_FILE = path.join(sandbox, 'viewer-effects.json');

const modules = ['../services/history', '../services/analytics', '../services/perks', '../services/subTiers', '../core/state', '../commands/fx', '../services/messages', '../services/twitchAuth', '../twitch-token-store']
    .map(name => require.resolve(name));
for (const module of modules) delete require.cache[module];

function stub(name, exports) {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const said = [];
stub('../services/messages', { sayMessage: (client, channel, key, values) => said.push({ key, values }), message: key => key });

// Twitch, as far as these tests go: who subscribes at which tier, and what it
// answers when asked. Never the network, never the real login.
let token = 'with-scope';
let subs = {};
let answer = null;
const asked = [];
stub('../twitch-token-store', { loadToken: () => ({ access_token: token }) });
stub('../services/twitchAuth', {
    fetchTwitch: async (url, options, retry) => {
        asked.push({ url, retry });
        if (answer) return answer(url);
        const id = new URL(url).searchParams.get('user_id');
        const data = subs[id] ? [{ broadcaster_id: '9', tier: subs[id], is_gift: false }] : [];
        return { ok: true, status: 200, json: async () => ({ data }) };
    }
});

const perks = require('../services/perks');
const subTiers = require('../services/subTiers');
const state = require('../core/state');
const fx = require('../commands/fx');

test.after(async () => {
    await perks.flush();
    await new Promise(resolve => setTimeout(resolve, 250));
    for (const name of ['QUEUEIFY_DATA_DIR', 'QUEUEIFY_HISTORY_FILE', 'QUEUEIFY_SETTINGS_FILE', 'QUEUEIFY_VIEWER_EFFECTS_FILE']) {
        delete process.env[name];
    }
    for (const module of modules) delete require.cache[module];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test.beforeEach(() => {
    state.broadcasterId = '9';
    token = 'with-scope';
    subs = {};
    answer = null;
    asked.length = 0;
    subTiers.reset();
    perks.reset();
});

const tierThree = perks.normalizeSettings({ ...perks.DEFAULT_SETTINGS, subAccess: { warp: 3, comet: 2 } });

async function fxAs(id, effect, tags) {
    said.length = 0;
    await fx.execute({
        client: {}, channel: '#c', username: 'kip', message: `!fx ${effect}`, args: [effect],
        tags: { 'user-id': id, ...tags }, state: { perks: tierThree }
    });
    return said[0];
}

// What every sub wears in a channel without tier badges: the months, nothing more.
const plainBadge = { subscriber: true, badges: { subscriber: '6' } };

test('a Tier 3 sub with the plain sub badge can pick a Tier 3 effect', async () => {
    subs['300'] = '3000';
    assert.strictEqual((await fxAs('300', 'warp', plainBadge)).key, 'perks.set');
    assert.strictEqual(perks.pickOf('300'), 'warp');
    assert.match(asked[0].url, /helix\/subscriptions\?broadcaster_id=9&user_id=300$/);
    assert.strictEqual(asked[0].retry, false, 'a login without the scope must not refresh on every ask');
});

test('a Tier 2 sub with the plain badge gets Tier 2, not Tier 3', async () => {
    subs['200'] = '2000';
    assert.strictEqual((await fxAs('200', 'comet', plainBadge)).key, 'perks.set');
    const reply = await fxAs('200', 'warp', plainBadge);
    assert.strictEqual(reply.key, 'perks.needsTier');
    assert.strictEqual(reply.values.tier, 3);
});

test('a founder is asked about too', async () => {
    subs['301'] = '3000';
    const founder = { subscriber: true, badges: { founder: '0' } };
    assert.strictEqual((await fxAs('301', 'warp', founder)).key, 'perks.set');
});

test('a Tier 3 badge is believed without asking', async () => {
    assert.strictEqual((await fxAs('302', 'warp', { subscriber: true, badges: { subscriber: '3006' } })).key, 'perks.set');
    assert.strictEqual(asked.length, 0);
});

test('somebody who does not subscribe is never asked about', async () => {
    subs['400'] = '3000';
    assert.strictEqual((await fxAs('400', 'warp', { subscriber: false })).key, 'perks.notSub');
    assert.strictEqual(asked.length, 0);
});

test('Twitch answering nothing leaves the badge as it was', async () => {
    // Listed as nobody: odd for a chatter wearing a sub badge, but never a reason to lock them out.
    assert.strictEqual((await fxAs('500', 'sparkles', plainBadge)).key, 'perks.set');
    assert.strictEqual((await fxAs('500', 'warp', plainBadge)).key, 'perks.needsTier');
});

test('Twitch failing falls back to the badge, and is asked again next time', async () => {
    answer = () => { throw new Error('offline'); };
    assert.strictEqual((await fxAs('600', 'warp', plainBadge)).key, 'perks.needsTier');

    answer = null;
    subs['600'] = '3000';
    assert.strictEqual((await fxAs('600', 'warp', plainBadge)).key, 'perks.set');
    assert.strictEqual(asked.length, 2);
});

test('a login without the scope is asked once, then left alone until it changes', async () => {
    answer = () => ({ ok: false, status: 401, json: async () => ({ message: 'Missing scope: channel:read:subscriptions' }) });
    assert.strictEqual((await fxAs('700', 'warp', plainBadge)).key, 'perks.needsTier');
    assert.strictEqual((await fxAs('701', 'warp', plainBadge)).key, 'perks.needsTier');
    assert.strictEqual(asked.length, 1);

    // Reconnected: a new login, so ask again - no restart.
    token = 'reconnected';
    answer = null;
    subs['701'] = '3000';
    assert.strictEqual((await fxAs('701', 'warp', plainBadge)).key, 'perks.set');
    assert.strictEqual(asked.length, 2);
});

test('an answer is kept for a while, so a chatty sub is asked about once', async () => {
    subs['800'] = '3000';
    await fxAs('800', 'warp', plainBadge);
    await fxAs('800', 'warp', plainBadge);
    await perks.subTierFrom({ 'user-id': '800', ...plainBadge });
    assert.strictEqual(asked.length, 1);
});

test('two at once share the one question', async () => {
    subs['801'] = '3000';
    const tags = { 'user-id': '801', ...plainBadge };
    assert.deepStrictEqual(await Promise.all([perks.subTierFrom(tags), perks.subTierFrom(tags)]), [3, 3]);
    assert.strictEqual(asked.length, 1);
});

test('a channel that is not an affiliate or partner never asks', async () => {
    state.broadcasterId = null;
    assert.strictEqual(await perks.subTierFrom({ 'user-id': '900', ...plainBadge }), 1);
    assert.strictEqual(asked.length, 0);
});

test('a redeem gets the tier Twitch gives, so their song plays their Tier 3 effect', async () => {
    subs['310'] = '3000';
    assert.strictEqual(await perks.redeemerSubTier('310'), 3, 'never seen in chat, Twitch still knows');

    perks.setPick('310', 'kip', 'warp');
    const accepted = perks.accept({ userId: '310', userLogin: 'kip', sub: true, subTier: 3 });
    const song = { requestNumber: 1, queuedBy: 'kip', ...accepted };
    assert.strictEqual(perks.forSong(song, tierThree).effect, 'warp');
});

test('a redeem falls back to what chat last showed when Twitch cannot be asked', async () => {
    answer = () => { throw new Error('offline'); };
    assert.strictEqual(await perks.redeemerSubTier('320'), null, 'never seen anywhere: unknown');

    perks.noteChatter({ 'user-id': '320', ...plainBadge });
    assert.strictEqual(await perks.redeemerSubTier('320'), 1);
});

test('chat does not knock a known Tier 3 back down to its badge', async () => {
    subs['330'] = '3000';
    await perks.subTierFrom({ 'user-id': '330', ...plainBadge });
    perks.noteChatter({ 'user-id': '330', ...plainBadge });
    assert.strictEqual(perks.subscribes('330'), 3);
});
