const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Perks: a viewer's song starts with a burst for their tier, their own effect
 * as a sub, and a banner on a milestone. Counted from songs that went in.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-perks-'));
const historyFile = path.join(sandbox, 'queue-history.jsonl');
const picksFile = path.join(sandbox, 'viewer-effects.json');

// Before any require: history, core/state and perks all resolve these.
process.env.QUEUEIFY_DATA_DIR = sandbox;
process.env.QUEUEIFY_HISTORY_FILE = historyFile;
process.env.QUEUEIFY_SETTINGS_FILE = path.join(sandbox, 'queue-settings.json');
process.env.QUEUEIFY_VIEWER_EFFECTS_FILE = picksFile;

const modules = ['../services/history', '../services/analytics', '../services/perks', '../core/state', '../services/upNext', '../commands/fx', '../services/messages']
    .map(name => require.resolve(name));
for (const module of modules) delete require.cache[module];

// The chat replies are checked by key; the real ones are the user's to edit.
const said = [];
const messagesPath = require.resolve('../services/messages');
require.cache[messagesPath] = {
    id: messagesPath, filename: messagesPath, loaded: true,
    exports: { sayMessage: (client, channel, key, values) => said.push({ key, values }), message: key => key }
};

const perks = require('../services/perks');
const state = require('../core/state');
const { createUpNext } = require('../services/upNext');
const fx = require('../commands/fx');
const store = require('../services/themeStore');

test.after(async () => {
    await perks.flush();
    // core/state debounces its writes.
    await new Promise(resolve => setTimeout(resolve, 250));
    for (const name of ['QUEUEIFY_DATA_DIR', 'QUEUEIFY_HISTORY_FILE', 'QUEUEIFY_SETTINGS_FILE', 'QUEUEIFY_VIEWER_EFFECTS_FILE']) {
        delete process.env[name];
    }
    for (const module of modules) delete require.cache[module];
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const request = (user, outcome = 'ok') => JSON.stringify({ v: 1, t: new Date().toISOString(), type: 'request', outcome, source: 'chat', user }) + '\n';

// Starts again from this log, once the last test's picks are on disk.
async function writeLog(lines) {
    await perks.flush();
    fs.writeFileSync(historyFile, lines.join(''));
    perks.reset();
}

const settings = (overrides = {}) => perks.normalizeSettings({ ...perks.DEFAULT_SETTINGS, ...overrides });

/* --------------------------------------------------------------- counting */

test('only songs that went in count, however they were turned away', async () => {
    await writeLog([
        request({ id: '222', login: 'kip' }),
        request({ id: '222', login: 'kip' }, 'cooldown'),
        request({ id: '222', login: 'kip' }, 'blockedSong'),
        request({ id: '222', login: 'kip' })
    ]);

    assert.strictEqual(perks.acceptedCount({ userId: '222', userLogin: 'kip' }), 2);
});

test('a viewer keeps their count through a rename, and owns what they queued before ids were logged', async () => {
    await writeLog([
        request({ id: null, login: 'nyx' }),
        request({ id: null, login: 'nyx' }),
        request({ id: '111', login: 'nyx' })
    ]);

    assert.strictEqual(perks.acceptedCount({ userId: '111', userLogin: 'nyx' }), 3);
    assert.strictEqual(perks.acceptedCount({ userId: '111', userLogin: 'nyx_renamed' }), 3);
});

test('a viewer seen with an id for the first time takes their older id-less songs with them', async () => {
    await writeLog([request({ id: null, login: 'olde' }), request({ id: null, login: 'olde' })]);

    assert.strictEqual(perks.accept({ userId: '444', userLogin: 'olde' }).requestNumber, 3);
    assert.strictEqual(perks.acceptedCount({ userLogin: 'olde' }), 3, 'asked by name alone, it is the same person');
});

test('each accepted request is numbered, carrying on from the log', async () => {
    await writeLog([request({ id: '222', login: 'kip' })]);

    assert.strictEqual(perks.accept({ userId: '222', userLogin: 'kip' }).requestNumber, 2);
    assert.strictEqual(perks.accept({ userId: '222', userLogin: 'kip' }).requestNumber, 3);
    assert.strictEqual(perks.acceptedCount({ userId: '222' }), 3);
});

test('whether a viewer subscribes comes from chat, or from their last chat message for a redeem', async () => {
    await writeLog([]);

    assert.strictEqual(perks.accept({ userId: '1', userLogin: 'a', sub: true }).requesterSub, true);
    assert.strictEqual(perks.accept({ userId: '2', userLogin: 'b' }).requesterSub, null, 'never seen: unknown');

    perks.noteChatter({ 'user-id': '2', subscriber: true, badges: { subscriber: '2006' } });
    const redeemed = perks.accept({ userId: '2', userLogin: 'b' });
    assert.deepStrictEqual([redeemed.requesterSub, redeemed.requesterSubTier], [true, 2], 'a redeem takes the tier chat last showed');

    // Their chat request said they no longer do, and a redeem after it believes that.
    perks.accept({ userId: '2', userLogin: 'b', sub: false });
    assert.strictEqual(perks.accept({ userId: '2', userLogin: 'b' }).requesterSub, false);
});

/* ------------------------------------------------------------ what plays */

const song = (requestNumber, extra = {}) => ({ id: 'T', queuedBy: 'kip', requestNumber, requesterId: '222', requesterSub: false, ...extra });

test('tiers give bigger bursts as a viewer queues more', () => {
    const plays = number => perks.forSong(song(number), settings({ milestones: [] }));

    assert.strictEqual(plays(9), null, 'nothing before the first tier');
    assert.deepStrictEqual([plays(10).tier, plays(10).effect, plays(10).power], ['Petal', 'sparkles', 1]);
    assert.deepStrictEqual([plays(64).tier, plays(64).effect, plays(64).power], ['Flower', 'stars', 2]);
    assert.deepStrictEqual([plays(300).tier, plays(300).effect, plays(300).power], ['Blossom', 'embers', 3]);
});

test('a milestone adds the banner, and gets one even with no effect', () => {
    const at = perks.forSong(song(25), settings());
    assert.strictEqual(at.milestone, 25);
    assert.strictEqual(at.effect, 'sparkles');
    assert.strictEqual(perks.forSong(song(26), settings()).milestone, null);

    const quiet = settings({ tiers: [], milestones: [5] });
    assert.deepStrictEqual(perks.forSong(song(5), quiet), {
        number: 5, milestone: 5, tier: null, effect: null, style: null, power: 1, sub: false, name: 'kip'
    });
});

test('the default milestones are the ones asked for', async () => {
    assert.deepStrictEqual(perks.DEFAULT_SETTINGS.milestones, [10, 25, 50, 100, 250, 500, 1000]);
});

test('a sub plays their own effect, never the smallest burst', async () => {
    await writeLog([]);
    perks.setPick('222', 'kip', 'bubbles');

    const played = perks.forSong(song(3, { requesterSub: true }), settings());
    assert.strictEqual(played.effect, 'bubbles');
    assert.strictEqual(played.power, 2);

    // Stopped subscribing: back to their tier's burst, however they picked.
    assert.strictEqual(perks.forSong(song(12, { requesterSub: false }), settings()).effect, 'sparkles');

    // A pick the streamer has since taken off the list falls back to the channel's effect for subs.
    assert.strictEqual(perks.forSong(song(3, { requesterSub: true }), settings({ subAccess: { bubbles: 0 } })).effect, 'sparkles');

    await perks.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(picksFile, 'utf8'))['222'].effect, 'bubbles');

    perks.reset();
    assert.strictEqual(perks.pickOf('222'), 'bubbles', 'read back from the file');

    perks.setPick('222', 'kip', null);
    assert.strictEqual(perks.pickOf('222'), null);
});

test('a sub who has not picked plays the channel\'s effect for subs, or their tier\'s when that is off', async () => {
    await writeLog([]);

    assert.strictEqual(perks.forSong(song(2, { requesterSub: true }), settings()).effect, 'sparkles');
    const none = { subDefaults: { 1: 'none', 2: 'none', 3: 'none' } };
    assert.strictEqual(perks.forSong(song(2, { requesterSub: true }), settings(none)), null);
    assert.strictEqual(perks.forSong(song(60, { requesterSub: true }), settings(none)).effect, 'stars');
});

test('nothing plays when rewards are off, or for a song queued before them', () => {
    assert.strictEqual(perks.forSong(song(100), settings({ enabled: false, milestonesEnabled: false })), null);
    assert.strictEqual(perks.forSong(song(null), settings()), null);
    assert.strictEqual(perks.forSong(null, settings()), null);
});

test('what goes to the widget does not include the viewer\'s id', () => {
    const played = perks.forSong(song(100), settings());
    assert.ok(!JSON.stringify(played).includes('222'));
});

/* --------------------------------------------------------------- settings */

test('settings that make no sense come back as the defaults', () => {
    assert.deepStrictEqual(perks.normalizeSettings(undefined), perks.DEFAULT_SETTINGS);
    assert.deepStrictEqual(perks.normalizeSettings('nonsense'), perks.DEFAULT_SETTINGS);

    const cleaned = perks.normalizeSettings({
        milestones: [50, 10, 10, -3, 'x', 2.5],
        tiers: [{ name: 'Big', at: 100, effect: 'stars' }, { name: '', at: 5, effect: 'explode' }, { at: 0 }],
        subDefaults: { 1: 'explode', 2: 'glitch' },
        subAccess: { hearts: 2, confetti: 9, explode: 1 },
        pickerUrl: 'javascript:alert(1)'
    });

    assert.deepStrictEqual(cleaned.milestones, [10, 50]);
    assert.deepStrictEqual(cleaned.tiers, [{ name: 'Tier', at: 5, effect: 'sparkles' }, { name: 'Big', at: 100, effect: 'stars' }]);
    assert.deepStrictEqual(cleaned.subDefaults, { 1: 'sparkles', 2: 'glitch', 3: 'lightning' });
    assert.strictEqual(cleaned.subAccess.hearts, 2);
    assert.strictEqual(cleaned.subAccess.confetti, 1, 'a tier that does not exist is every sub');
    assert.ok(!('explode' in cleaned.subAccess));
    assert.strictEqual(cleaned.pickerUrl, perks.DEFAULT_SETTINGS.pickerUrl);
});

test('the effects the server knows are the ones the widget draws', () => {
    const drawn = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'effects.js'), 'utf8');

    for (const name of perks.EFFECTS) {
        assert.match(drawn, new RegExp(`\\{ name: '${name}', label: '`), name + ' is listed');
        assert.match(drawn, new RegExp(`\\n        ${name}: \\{`), name + ' is drawn');
    }
});

// How the picker page reads `a` back (fx.vue in queueify-site).
function unpack(code) {
    const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    return perks.EFFECTS.map((effect, i) => {
        const packed = CODE.indexOf(code[Math.floor(i / 3)] ?? '');
        return packed < 0 ? 0 : (packed >> (4 - (i % 3) * 2)) & 3;
    });
}

test('the picker link names the command and packs who may pick what', () => {
    const only = Object.fromEntries(perks.EFFECTS.map(effect => [effect, 0]));
    const access = { ...only, stars: 1, hearts: 1, glitch: 2, warp: 3, impact: 3 };
    const link = new URL(perks.pickerLink('effect', settings({ subAccess: access })));

    assert.strictEqual(link.origin + link.pathname, 'https://queueify-docs.vercel.app/fx');
    assert.strictEqual(link.searchParams.get('c'), 'effect');
    assert.deepStrictEqual(unpack(link.searchParams.get('a')), perks.EFFECTS.map(effect => access[effect]));
});

test('the picker link stays short however it is set up, so its chat message is never dropped', () => {
    const tiers = [0, 1, 2, 3];
    for (let round = 0; round < 20; round++) {
        const access = Object.fromEntries(perks.EFFECTS.map((effect, i) => [effect, tiers[(i * 7 + round) % 4]]));
        const link = perks.pickerLink('a_very_long_command_name', settings({ subAccess: access }));
        assert.ok(link.length < 100, link);
        // The longest message it goes out in, with the longest username and a
        // mistyped effect as long as !fx lets through.
        const reply = `@${'u'.repeat(25)} there is no effect called "${'x'.repeat(25)}". Pick one here: ${link}`;
        assert.ok(reply.length <= 500, reply.length);
    }
});

test('the order of effects only ever grows at the end, since the picker link counts along it', () => {
    // The first 48, as 44.0.0 shipped them. New effects go after these.
    assert.deepStrictEqual(perks.EFFECTS.slice(0, 48), [
        'sparkles', 'stars', 'confetti', 'hearts', 'notes', 'fireworks', 'pixels', 'coins', 'embers', 'bubbles', 'petals',
        'scatter', 'wave', 'jelly', 'glitch', 'heartbeat', 'spotlight',
        'comet', 'neon', 'warp', 'aurora', 'scanline', 'lightning', 'supernova', 'vortex',
        'bokeh', 'glimmer', 'fairy', 'mist', 'shine', 'flare', 'halo', 'glitter', 'wisps', 'love', 'starfall', 'fountain', 'bloom',
        'ripple', 'rune', 'blaze', 'meteors', 'swirl', 'portal', 'poof', 'crackle', 'slash', 'impact'
    ]);
});

test('a picker link setting that is not a real address falls back to the docs page', () => {
    assert.strictEqual(settings({ pickerUrl: 'http://[' }).pickerUrl, perks.DEFAULT_SETTINGS.pickerUrl);
    assert.match(perks.pickerLink('fx', { ...settings(), pickerUrl: 'http://[' }), /^https:\/\/queueify-docs\.vercel\.app\/fx\?/);
});

/* -------------------------------------------------------------- the queue */

test('a queued song carries its number to the moment it plays', () => {
    const before = state.pendingQueue.length;
    state.addPendingTrack({ id: 'SONG', name: 'Song' }, 'kip', { requestNumber: 50, requesterId: '222', requesterSub: true });

    const queued = state.pendingQueue[state.pendingQueue.length - 1];
    assert.deepStrictEqual([queued.requestNumber, queued.requesterId, queued.requesterSub], [50, '222', true]);
    state.pendingQueue.length = before;

    state.addPendingTrack({ id: 'OLD', name: 'Old' }, 'kip');
    assert.strictEqual(state.pendingQueue[state.pendingQueue.length - 1].requestNumber, null, 'queued without a count');
    state.pendingQueue.length = before;
});

test('the widget hears the perk of the request playing, and of nothing else', async () => {
    const fake = {
        activeTrack: { id: 'A', queuedBy: 'kip', requestNumber: 100, requesterId: '222', requesterSub: false },
        pendingQueue: [],
        perks: settings()
    };
    const read = createUpNext({ state: fake, syncWithQueue: async () => ({ queue: [] }) });

    const playing = await read({ id: 'A' });
    assert.strictEqual(playing.perk.milestone, 100);
    assert.strictEqual(playing.perk.effect, 'embers');

    assert.strictEqual((await read({ id: 'Z' })).perk, null, 'a song the streamer put on');
});

/* ------------------------------------------------------------------- !fx */

async function run(message, tags = {}) {
    said.length = 0;
    const [typed, ...args] = message.slice(1).split(' ');
    await fx.execute({
        client: {}, channel: '#c', username: tags.username || 'kip', message, args,
        tags: { 'user-id': '222', ...tags }, state: { perks: settings(tags.perks) }
    });
    assert.ok(typed);
    return said[0];
}

test('!fx on its own links the picker, named the way it was typed', async () => {
    const reply = await run('!effect');
    assert.strictEqual(reply.key, 'perks.link');
    assert.match(reply.values.url, /[?&]c=effect&/);
});

test('!fx <effect> is for subs', async () => {
    await writeLog([]);

    assert.strictEqual((await run('!fx bubbles')).key, 'perks.notSub');
    assert.strictEqual(perks.pickOf('222'), null);

    assert.strictEqual((await run('!fx Bubbles', { subscriber: true })).key, 'perks.set');
    assert.strictEqual(perks.pickOf('222'), 'bubbles');

    assert.strictEqual((await run('!fx explode', { subscriber: true })).key, 'perks.unknown');
    assert.strictEqual(perks.pickOf('222'), 'bubbles', 'an unknown one changes nothing');

    assert.strictEqual((await run('!fx off', { subscriber: true })).key, 'perks.cleared');
    assert.strictEqual(perks.pickOf('222'), null);
});

test('!fx only offers what the streamer allows, and says so when perks are off', async () => {
    assert.strictEqual((await run('!fx bubbles', { subscriber: true, perks: { subAccess: { bubbles: 0 } } })).key, 'perks.unknown');
    assert.strictEqual((await run('!fx', { perks: { enabled: false } })).key, 'perks.disabled');
});

/* ------------------------------------------------------------------ theme */

test('a theme saved before perks does not play them; a new one does', () => {
    const old = store.normalizeModel({ version: 9, canvas: { width: 600, height: 200 }, modules: [{ type: 'art' }] });

    assert.strictEqual(old.properties.perks, false);
    assert.strictEqual(store.normalizeModel(store.defaultModel()).properties.perks, true);
});

test('perks add nothing to a theme\'s stylesheet', () => {
    const model = store.normalizeModel(store.defaultModel());
    const off = store.normalizeModel({ ...model, properties: { ...model.properties, perks: false } });

    assert.strictEqual(store.generateCss(model), store.generateCss(off));
});

test('every premade plays perks', () => {
    for (const preset of store.listPresets()) {
        assert.strictEqual(store.presetModel(preset.id).properties.perks, true, preset.id);
    }
});

/* ---------------------------------------------------------------- styles */

test('each effect has a style: colors, and how many, how big, and how fast', () => {
    const cleaned = perks.normalizeSettings({
        styles: {
            hearts: { colors: 'gold', amount: 9, size: 0.1, speed: '1.5' },
            stars: { colors: 'plaid' },
            nonsense: { colors: 'gold' }
        }
    });

    assert.deepStrictEqual(cleaned.styles.hearts, { colors: 'gold', amount: 3, size: 0.4, speed: 1.5 });
    assert.deepStrictEqual(cleaned.styles.stars, { colors: 'album', amount: 1, size: 1, speed: 1 });
    assert.strictEqual(cleaned.styles.coins.colors, 'gold', 'coins start gold');
    assert.ok(!('nonsense' in cleaned.styles));
});

test('what plays carries the streamer\'s style, in the sub\'s own colors if they chose some', async () => {
    await writeLog([]);
    const styled = settings({ styles: { embers: { colors: 'ice', amount: 2 }, bubbles: { colors: 'fire' } } });

    assert.deepStrictEqual(perks.forSong(song(150), styled).style, { colors: 'ice', amount: 2, size: 1, speed: 1 });

    perks.setPick('222', 'kip', 'bubbles', 'neon');
    assert.strictEqual(perks.forSong(song(3, { requesterSub: true }), styled).style.colors, 'neon');

    perks.setPick('222', 'kip', 'bubbles');
    assert.strictEqual(perks.forSong(song(3, { requesterSub: true }), styled).style.colors, 'fire', 'no colors of their own');
    perks.setPick('222', 'kip', null);
});

test('!fx <effect> <colors> saves both, and turns away colors it does not know', async () => {
    await writeLog([]);

    assert.strictEqual((await run('!fx fireworks Gold', { subscriber: true })).key, 'perks.set');
    assert.strictEqual(perks.pickOf('222'), 'fireworks');
    assert.strictEqual(perks.pickColorsOf('222'), 'gold');

    assert.strictEqual((await run('!fx comet plaid', { subscriber: true })).key, 'perks.unknownColor');
    assert.strictEqual(perks.pickOf('222'), 'fireworks', 'nothing changed');
    perks.setPick('222', 'kip', null);
});

test('!fx forgives the color first, and punctuation after', async () => {
    await writeLog([]);

    assert.strictEqual((await run('!fx gold hearts', { subscriber: true })).key, 'perks.set');
    assert.strictEqual(perks.pickOf('222'), 'hearts');
    assert.strictEqual(perks.pickColorsOf('222'), 'gold');

    assert.strictEqual((await run('!fx Bokeh!', { subscriber: true })).key, 'perks.set');
    assert.strictEqual(perks.pickOf('222'), 'bokeh');
    perks.setPick('222', 'kip', null);
});

test('every effect is in one of the groups people pick from', () => {
    const drawn = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'effects.js'), 'utf8');
    for (const name of perks.EFFECTS) {
        assert.match(drawn, new RegExp(`\{ name: '${name}', label: '[^']+', group: '(burst|widget|light|glow|magic)' \}`), name);
    }
    assert.strictEqual(perks.EFFECTS.length, 48);
});

test('every texture the Glow effects draw with is there, with its license beside them', () => {
    const drawn = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'effects.js'), 'utf8');
    const folder = path.join(__dirname, '..', 'widget', 'public', 'fx-textures');
    const used = new Set([...drawn.matchAll(/'((?:circle|light|star|flare|magic|muzzle|flame|trace|smoke|twirl|scorch|scratch|slash|spark|symbol)_\d\d)'/g)].map(m => m[1]));

    assert.ok(used.size >= 50, `only ${used.size} textures found in effects.js`);
    for (const name of used) assert.ok(fs.existsSync(path.join(folder, name + '.png')), name);
    assert.match(fs.readFileSync(path.join(folder, 'LICENSE.txt'), 'utf8'), /Kenney[\s\S]*CC0/);
});

test('a Glow effect takes a color like any other', async () => {
    await writeLog([]);

    assert.strictEqual((await run('!fx rune gold', { subscriber: true })).key, 'perks.set');
    assert.strictEqual(perks.pickOf('222'), 'rune');
    assert.strictEqual(perks.pickColorsOf('222'), 'gold');
    perks.setPick('222', 'kip', null);
});

test('subs start with Sparkles at Tier 1, Scatter at Tier 2, and Lightning at Tier 3', () => {
    assert.deepStrictEqual(perks.DEFAULT_SETTINGS.subDefaults, { 1: 'sparkles', 2: 'scatter', 3: 'lightning' });
    assert.deepStrictEqual(perks.normalizeSettings({}).subDefaults, { 1: 'sparkles', 2: 'scatter', 3: 'lightning' });
});

test('the default tiers are Petal, Flower, and Blossom', () => {
    assert.deepStrictEqual(perks.DEFAULT_SETTINGS.tiers.map(tier => [tier.name, tier.at, tier.effect]),
        [['Petal', 10, 'sparkles'], ['Flower', 50, 'stars'], ['Blossom', 100, 'embers']]);
});

test('the server and the widget agree on the colors', () => {
    const drawn = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'effects.js'), 'utf8');
    for (const name of perks.PALETTES) assert.match(drawn, new RegExp(`\{ name: '${name}', label: '`), name);
});

/* -------------------------------------------------------------- milestone */

test('a milestone takes the widget over, for as long as the theme says', () => {
    assert.deepStrictEqual(store.normalizeModel(store.defaultModel()).properties.milestone, { enabled: true, seconds: 4 });

    const long = store.normalizeModel({
        ...store.defaultModel(),
        properties: { ...store.defaultModel().properties, milestone: { seconds: 99, mode: 'banner', x: 10 } }
    });
    assert.deepStrictEqual(long.properties.milestone, { enabled: true, seconds: 15 }, 'no banner, and no place to put one');
});

/* --------------------------------------------------------------- ambience */

test('no theme has an ambience until it asks for one', () => {
    const old = store.normalizeModel({ version: 9, canvas: { width: 600, height: 200 }, modules: [{ type: 'art' }] });
    assert.deepStrictEqual(old.properties.ambience, { style: 'none', amount: 1, speed: 1, colors: 'album' });
    assert.strictEqual(store.normalizeModel(store.defaultModel()).properties.ambience.style, 'none');

    // A premade can come with one - Grimoire's embers - but the one every
    // install starts on does not.
    assert.strictEqual(store.presetModel('default').properties.ambience.style, 'none');
});

test('an ambience is one of the drifts, kept within its limits', () => {
    const model = store.normalizeModel({
        ...store.defaultModel(),
        properties: { ...store.defaultModel().properties, ambience: { style: 'snow', amount: 9, speed: 0, colors: 'plaid' } }
    });
    assert.deepStrictEqual(model.properties.ambience, { style: 'snow', amount: 3, speed: 0.25, colors: 'album' });

    const odd = store.normalizeModel({ ...store.defaultModel(), properties: { ambience: { style: 'confetti' } } });
    assert.strictEqual(odd.properties.ambience.style, 'none', 'a burst is never an ambience');
});

test('the drifts the theme knows are the ones the widget draws', () => {
    const drawn = fs.readFileSync(path.join(__dirname, '..', 'widget', 'public', 'effects.js'), 'utf8');
    for (const name of store.AMBIENCES) assert.match(drawn, new RegExp(`\{ name: '${name}', label: '`), name);
});

test('milestones and ambience change nothing in the stylesheet', () => {
    const model = store.normalizeModel(store.defaultModel());
    const other = store.normalizeModel({
        ...model,
        properties: { ...model.properties, milestone: { seconds: 9 }, ambience: { style: 'embers', amount: 2 } }
    });
    assert.strictEqual(store.generateCss(model), store.generateCss(other));
});

/* -------------------------------------------------------------- sub tiers */

test('a sub\'s tier comes from their badge, and a founder or Prime sub is Tier 1', () => {
    assert.strictEqual(perks.subTierOf({ subscriber: false }), 0);
    assert.strictEqual(perks.subTierOf({ subscriber: true, badges: { subscriber: '12' } }), 1);
    assert.strictEqual(perks.subTierOf({ subscriber: true, badges: { subscriber: '2003' } }), 2);
    assert.strictEqual(perks.subTierOf({ subscriber: true, badges: { subscriber: '3024' } }), 3);
    assert.strictEqual(perks.subTierOf({ subscriber: true, badges: { founder: '0' } }), 1);
});

test('an effect set to a higher tier is only for subs of that tier', async () => {
    await writeLog([]);
    const tiered = settings({ subAccess: { glitch: 2, warp: 3 } });

    assert.ok(perks.canPick('glitch', 2, tiered) && perks.canPick('glitch', 3, tiered));
    assert.ok(!perks.canPick('glitch', 1, tiered));
    assert.ok(!perks.canPick('warp', 2, tiered));

    // Picked while Tier 3, now Tier 1: their tier's default instead.
    perks.setPick('222', 'kip', 'warp');
    assert.strictEqual(perks.forSong(song(3, { requesterSub: true, requesterSubTier: 3 }), tiered).effect, 'warp');
    assert.strictEqual(perks.forSong(song(3, { requesterSub: true, requesterSubTier: 1 }), tiered).effect, 'sparkles');
    perks.setPick('222', 'kip', null);
});

test('each sub tier can start with its own effect, and Tier 3 gets the biggest', () => {
    const tiered = settings({ subDefaults: { 1: 'hearts', 2: 'stars', 3: 'fireworks' } });
    const play = subTier => perks.forSong(song(2, { requesterSub: true, requesterSubTier: subTier }), tiered);

    assert.deepStrictEqual([play(1).effect, play(1).power], ['hearts', 2]);
    assert.deepStrictEqual([play(2).effect, play(2).power], ['stars', 2]);
    assert.deepStrictEqual([play(3).effect, play(3).power], ['fireworks', 3]);
});

test('a list of what subs could pick, saved before later effects existed, does not lock them out', () => {
    const old = perks.normalizeSettings({ subEffects: ['sparkles', 'stars', 'hearts'], subDefault: 'stars' });

    assert.strictEqual(old.subAccess.sparkles, 1);
    assert.strictEqual(old.subAccess.confetti, 0, 'one it knew about and left out stays out');
    assert.strictEqual(old.subAccess.glitch, 1, 'one added since is open to every sub');
    assert.strictEqual(old.subAccess.warp, 1);
    assert.deepStrictEqual(old.subDefaults, { 1: 'stars', 2: 'stars', 3: 'stars' });
});

test('!fx turns away an effect above the sub\'s tier, and says which tier it needs', async () => {
    await writeLog([]);
    const reply = await run('!fx warp', { subscriber: true, badges: { subscriber: '6' }, perks: { subAccess: { warp: 3 } } });
    assert.strictEqual(reply.key, 'perks.needsTier');
    assert.strictEqual(reply.values.tier, 3);
    assert.strictEqual(perks.pickOf('222'), null);

    assert.strictEqual((await run('!fx warp', { subscriber: true, badges: { subscriber: '3001' }, perks: { subAccess: { warp: 3 } } })).key, 'perks.set');
    perks.setPick('222', 'kip', null);
});

/* ------------------------------------------------------ milestone switch */

test('milestones switch on and off apart from the effects', () => {
    const effectsOnly = settings({ milestonesEnabled: false });
    const milestonesOnly = settings({ enabled: false });

    const a = perks.forSong(song(100), effectsOnly);
    assert.deepStrictEqual([a.effect, a.milestone], ['embers', null]);

    const b = perks.forSong(song(100), milestonesOnly);
    assert.deepStrictEqual([b.effect, b.milestone], [null, 100]);
    assert.strictEqual(perks.forSong(song(64), milestonesOnly), null, 'no milestone, no effect: nothing');

    assert.strictEqual(perks.forSong(song(100), settings({ enabled: false, milestonesEnabled: false })), null);
});

test('settings from before the milestone switch keep off as off', () => {
    assert.strictEqual(perks.normalizeSettings({ enabled: false }).milestonesEnabled, false);
    assert.strictEqual(perks.normalizeSettings({ enabled: true }).milestonesEnabled, true);
    assert.strictEqual(perks.normalizeSettings({}).milestonesEnabled, true);
});

test('a theme has its own milestone switch, following its rewards switch when it has none', () => {
    const old = store.normalizeModel({ version: 9, canvas: { width: 600, height: 200 }, modules: [{ type: 'art' }] });
    assert.strictEqual(old.properties.milestone.enabled, false, 'a theme from before rewards has neither');

    const noSwitch = store.normalizeModel({ ...store.defaultModel(), properties: { ...store.defaultModel().properties, milestone: { seconds: 6 } } });
    assert.strictEqual(noSwitch.properties.milestone.enabled, true, 'rewards on, so milestones on');

    const off = store.normalizeModel({ ...store.defaultModel(), properties: { ...store.defaultModel().properties, milestone: { enabled: false } } });
    assert.deepStrictEqual([off.properties.perks, off.properties.milestone.enabled], [true, false]);
});
