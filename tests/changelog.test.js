const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const changelogPath = path.join(__dirname, '..', 'services', 'changelog.js');
const { parse } = require(changelogPath);

test('the shipped changelog reads as releases with entries in them', () => {
    // The real file, so a broken edit is caught before anyone opens the page.
    delete require.cache[require.resolve(changelogPath)];
    const releases = require(changelogPath).readChangelog();

    assert.ok(releases.length, 'CHANGELOG.md has at least one release');

    const current = releases[0];
    assert.strictEqual(current.version, require('../package.json').version,
        'the newest release is the version this copy reports');
    assert.ok(current.groups.length, 'and it says what changed');
    assert.ok(current.groups.every(group => group.entries.length));
});

test('a release is read into groups and entries, wrapped lines and all', () => {
    const releases = parse([
        '# Changelog',
        '',
        '## 2.0.0 - 2026-01-02',
        '',
        '### New',
        '',
        '- **A thing.** It does something,',
        '  and the sentence carries on.',
        '- Another thing.',
        '',
        '### Fixed',
        '',
        '- It stopped doing the wrong thing.',
        '',
        '## 1.0.0',
        '',
        '- The first one.'
    ].join('\n'));

    assert.strictEqual(releases.length, 2);
    assert.strictEqual(releases[0].version, '2.0.0');
    assert.strictEqual(releases[0].date, '2026-01-02');
    assert.deepStrictEqual(releases[0].groups.map(group => group.name), ['New', 'Fixed']);

    // The wrapped line is joined back into one entry, and ** becomes bold.
    assert.strictEqual(releases[0].groups[0].entries[0],
        '<strong>A thing.</strong> It does something, and the sentence carries on.');

    // A release with no groups still gets one, so the page has nothing to
    // special-case.
    assert.strictEqual(releases[1].groups.length, 1);
    assert.deepStrictEqual(releases[1].groups[0].entries, ['The first one.']);
});

test('an indented list stays inside the entry it belongs to', () => {
    const [release] = parse([
        '## 3.0.0',
        '',
        '### New',
        '',
        '- **A stats page.** It shows:',
        '  - One thing',
        '  - Another thing that wraps',
        '    onto a second line',
        '- A separate feature.'
    ].join('\n'));

    const { entries } = release.groups[0];

    // Two headline entries, not five: the sub-points are not features.
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[1], 'A separate feature.');

    assert.strictEqual(entries[0],
        '<strong>A stats page.</strong> It shows:'
        + '<ul><li>One thing</li><li>Another thing that wraps onto a second line</li></ul>',
        'the wrapped line belongs to the sub-point, not to the parent');
});

test('the shipped changelog keeps its sub-points out of the feature list', () => {
    delete require.cache[require.resolve(changelogPath)];
    const [current] = require(changelogPath).readChangelog();

    for (const group of current.groups) {
        for (const entry of group.entries) {
            // A stray "- " at the start of a wrapped line splits an entry in
            // two, which reads as a feature that begins mid-sentence.
            assert.ok(!/^[a-z]/.test(entry.replace(/<[^>]+>/g, '')),
                `an entry starts mid-sentence, so a wrapped line was read as a bullet: ${entry}`);
        }
    }
});

test('a changelog entry cannot smuggle markup into the page', () => {
    const [release] = parse('## 1.0.0\n\n- <img src=x onerror=alert(1)> and `code` too.\n');
    const [entry] = release.groups[0].entries;

    assert.ok(!entry.includes('<img'), 'the tag is escaped, not rendered');
    assert.ok(entry.includes('&lt;img'));
    assert.ok(entry.includes('<code>code</code>'), 'but the markdown we do allow still works');
});

test('a missing changelog is empty, not an error', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-log-'));

    try {
        process.env.QUEUEIFY_CHANGELOG_FILE = path.join(sandbox, 'nothing.md');
        delete require.cache[require.resolve(changelogPath)];

        assert.deepStrictEqual(require(changelogPath).readChangelog(), []);
    } finally {
        delete process.env.QUEUEIFY_CHANGELOG_FILE;
        delete require.cache[require.resolve(changelogPath)];
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
});
