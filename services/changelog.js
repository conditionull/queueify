const fs = require('fs');
const path = require('path');

/**
 * The changelog, read from CHANGELOG.md so there is one copy of it.
 *
 * The file is the thing people read on GitHub; this turns it into something
 * the dashboard can lay out, rather than keeping a second list in JavaScript
 * that would quietly fall behind.
 *
 * The shape it expects:
 *
 *     ## 40.0.0                <- a release
 *     ### New                  <- a group inside it
 *     - Something that changed  <- an entry, **bold** allowed
 */

const CHANGELOG_FILE = process.env.QUEUEIFY_CHANGELOG_FILE
    || path.join(__dirname, '..', 'CHANGELOG.md');

/** Turns the little markdown the entries use into the little HTML we allow. */
function renderInline(text) {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return escaped
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // <https://example.com> and [text](https://example.com), nothing else:
        // a changelog has no reason to link anywhere but the open web.
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
        .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
            '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

function parse(markdown) {
    const releases = [];
    let release = null;
    let group = null;
    let entry = null;

    const finishEntry = () => {
        if (entry) entry.html = renderInline(entry.lines.join(' ').trim());
        entry = null;
    };

    for (const raw of String(markdown).split(/\r?\n/)) {
        const line = raw.trim();

        const heading = line.match(/^##\s+(.+)$/);
        if (heading && !line.startsWith('###')) {
            finishEntry();

            // "40.0.0" or "40.0.0 - 2026-09-06", either way.
            const [, version, , date] = heading[1].match(/^(\S+)(\s+[-—]\s+(.+))?$/) || [];
            release = { version: version || heading[1], date: date || null, groups: [] };
            releases.push(release);
            group = null;
            continue;
        }

        const subheading = line.match(/^###\s+(.+)$/);
        if (subheading && release) {
            finishEntry();
            group = { name: subheading[1], entries: [] };
            release.groups.push(group);
            continue;
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet && release) {
            finishEntry();

            // A release that lists entries without a group still gets one, so
            // the page never has to special-case it.
            if (!group) {
                group = { name: '', entries: [] };
                release.groups.push(group);
            }

            entry = { lines: [bullet[1]] };
            group.entries.push(entry);
            continue;
        }

        // A wrapped bullet: markdown lets a list item run over several lines.
        if (line && entry) {
            entry.lines.push(line);
            continue;
        }

        if (!line) finishEntry();
    }

    finishEntry();

    return releases
        .map(item => ({
            version: item.version,
            date: item.date,
            groups: item.groups
                .map(g => ({ name: g.name, entries: g.entries.map(e => e.html) }))
                .filter(g => g.entries.length)
        }))
        .filter(item => item.groups.length);
}

/**
 * The releases, newest first, or an empty list if the file has gone missing -
 * a changelog is never worth failing a page load over.
 */
function readChangelog() {
    let markdown;

    try {
        markdown = fs.readFileSync(CHANGELOG_FILE, 'utf8');
    } catch {
        return [];
    }

    return parse(markdown);
}

module.exports = { readChangelog, parse, CHANGELOG_FILE };
