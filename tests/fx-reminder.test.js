const test = require('node:test');
const { beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const perks = require('../services/perks');
const { createFxReminder } = require('../services/fxReminder');
const state = require('../core/state');

const MINUTE = 60 * 1000;

let savedState;

beforeEach(() => {
    savedState = {
        queueEnabled: state.queueEnabled,
        chatEnabled: state.chatEnabled,
        redeemsEnabled: state.redeemsEnabled
    };
    // The reminder is only allowed to speak with the queue and effects on.
    Object.assign(state, { queueEnabled: true, chatEnabled: true, redeemsEnabled: true });
});

afterEach(() => {
    Object.assign(state, savedState);
});

function setup(reminder = {}, overrides = {}) {
    let clock = 0;
    const said = [];
    const current = perks.normalizeSettings({
        ...perks.DEFAULT_SETTINGS,
        reminder: { ...perks.DEFAULT_SETTINGS.reminder, enabled: true, minutes: 10, chatLines: 1, ...reminder },
        ...overrides
    });
    const reminderBot = createFxReminder({ say: text => said.push(text), settings: () => current, now: () => clock });
    return { reminder: reminderBot, said, current, wait: minutes => { clock += minutes * MINUTE; } };
}

test('settings from before the reminder have it off, with the default wait and wording', () => {
    const { reminder } = perks.normalizeSettings({ enabled: true });
    assert.deepStrictEqual(reminder, perks.DEFAULT_SETTINGS.reminder);
    assert.strictEqual(reminder.enabled, false);
});

test('the wait and the chat it needs are kept in range, and a blank message goes back to the default', () => {
    const at = value => perks.normalizeSettings({ reminder: { minutes: value } }).reminder.minutes;
    assert.strictEqual(at(1), 5);
    assert.strictEqual(at(999), 240);
    assert.strictEqual(at(12.4), 12);
    assert.strictEqual(at('nonsense'), perks.DEFAULT_SETTINGS.reminder.minutes);

    const lines = value => perks.normalizeSettings({ reminder: { chatLines: value } }).reminder.chatLines;
    assert.strictEqual(lines(0), 1);
    assert.strictEqual(lines(-3), 1);
    assert.strictEqual(lines(9999), 500);
    assert.strictEqual(lines(12), 12);
    assert.strictEqual(lines(undefined), perks.DEFAULT_SETTINGS.reminder.chatLines);

    assert.strictEqual(perks.normalizeSettings({ reminder: { message: '   ' } }).reminder.message,
        perks.DEFAULT_SETTINGS.reminder.message);
    // One chat message: no line breaks, and short enough to leave room for the link.
    assert.strictEqual(perks.normalizeSettings({ reminder: { message: 'a\n\nb' } }).reminder.message, 'a b');
    assert.strictEqual(perks.normalizeSettings({ reminder: { message: 'x'.repeat(900) } }).reminder.message.length,
        perks.REMINDER_MAX_LENGTH);
});

test('it speaks once the wait is up, with the picker link filled in', () => {
    const { reminder, said, current, wait } = setup({ message: 'Subs, pick an effect: {{url}} or {{ url }}' });
    reminder.noteChat();

    wait(9);
    assert.strictEqual(reminder.tick(), null);

    wait(1);
    const link = perks.pickerLink('fx', current);
    assert.strictEqual(reminder.tick(), `Subs, pick an effect: ${link} or ${link}`);
    assert.deepStrictEqual(said.length, 1);
    assert.ok(said[0].length <= 500, 'fits in one Twitch message');
});

test('it waits for somebody to chat since the last one', () => {
    const { reminder, said, wait } = setup();
    reminder.noteChat();
    wait(10);
    reminder.tick();

    wait(30);
    reminder.tick();
    assert.strictEqual(said.length, 1, 'a quiet chat gets no second reminder');

    reminder.noteChat();
    reminder.tick();
    assert.strictEqual(said.length, 2, 'it goes out as soon as somebody talks');
});

test('it waits for as much chat as the streamer set', () => {
    const { reminder, said, wait } = setup({ chatLines: 3 });
    wait(10);
    reminder.noteChat();
    reminder.noteChat();
    reminder.tick();
    assert.strictEqual(said.length, 0, 'two messages is not three');

    reminder.noteChat();
    reminder.tick();
    assert.strictEqual(said.length, 1);

    // And it counts again from nothing after.
    wait(10);
    reminder.noteChat();
    reminder.tick();
    assert.strictEqual(said.length, 1);
});

test('it says nothing while it, or reward effects, are off', () => {
    for (const [reminderSettings, overrides] of [[{ enabled: false }, {}], [{}, { enabled: false }]]) {
        const { reminder, said, wait } = setup(reminderSettings, overrides);
        reminder.noteChat();
        wait(60);
        reminder.tick();
        assert.strictEqual(said.length, 0);
    }
});

test('switched on, the wait starts from then rather than from when the bot started', () => {
    const { reminder, said, current, wait } = setup({ enabled: false });
    reminder.noteChat();
    wait(60);
    reminder.tick();

    current.reminder.enabled = true;
    reminder.noteChat();
    wait(5);
    reminder.tick();
    assert.strictEqual(said.length, 0);

    wait(5);
    reminder.tick();
    assert.strictEqual(said.length, 1);
});

test('it stays quiet while the queue is off, or chat and redeems are both off', () => {
    const attempt = (queueEnabled, chatEnabled, redeemsEnabled) => {
        Object.assign(state, { queueEnabled, chatEnabled, redeemsEnabled });
        const { reminder, said, wait } = setup();
        reminder.noteChat();
        wait(10);
        reminder.tick();
        return said.length;
    };

    // All off, or just the queue off, and it says nothing.
    for (const [q, c, r] of [[false, true, true], [true, false, false]]) {
        assert.strictEqual(attempt(q, c, r), 0, `queue=${q} chat=${c} redeems=${r}`);
    }

    // Either one of chat/redeems is enough, so these still send.
    for (const [q, c, r] of [[true, true, true], [true, true, false], [true, false, true]]) {
        assert.strictEqual(attempt(q, c, r), 1, `queue=${q} chat=${c} redeems=${r} should send`);
    }
});
