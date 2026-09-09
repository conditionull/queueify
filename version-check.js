const path = require('path');

const COLOR_PINK = '\x1b[95m';
const COLOR_RESET = '\x1b[0m';
const DEFAULT_UPDATE_URL = 'https://github.com/conditionull/queueify';
const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/conditionull/queueify/main/package.json';
const REMOTE_COMMIT_URL = 'https://api.github.com/repos/conditionull/queueify/commits/main';
// The changelog for the version they would be updating to. The one on their
// own dashboard describes the copy they are already running, which is not the
// question being asked here.
const CHANGELOG_URL = 'https://github.com/conditionull/queueify/blob/main/CHANGELOG.md';
const UPDATE_BOX_LINE = '────────────────────────────────────────────────────────────';

/**
 * The subject line of a commit, cut to fit the box.
 *
 * GitHub hands back the whole message, body and all - a merge commit or a
 * squash carries every bullet of the branch it came from. Pushed into the
 * notice unchanged that is a wall of text spilling out of a 60-column box, so
 * take the first line only and trim it to what fits beside the label.
 */
function summarise(commitMessage) {
    const subject = String(commitMessage).split(/\r?\n/)[0].trim();
    const room = UPDATE_BOX_LINE.length - '  Latest change: '.length;

    return subject.length > room ? `${subject.slice(0, room - 1).trimEnd()}…` : subject;
}

function printUpdateNotice(url = DEFAULT_UPDATE_URL, commitMessage = null) {
    const lines = [
        '',
        `${COLOR_PINK}${UPDATE_BOX_LINE}${COLOR_RESET}`,
        `${COLOR_PINK}  New Update Available on GitHub${COLOR_RESET}`,
        `${COLOR_PINK}  ${url}${COLOR_RESET}`
    ];

    if (commitMessage) {
        lines.push(`${COLOR_PINK}  Latest change: ${summarise(commitMessage)}${COLOR_RESET}`);
    }

    // The commit line is one change; the changelog is the whole story.
    lines.push(`${COLOR_PINK}  What's new: ${CHANGELOG_URL}${COLOR_RESET}`);

    // Queueify is installed by cloning, so an update is a pull - not a
    // re-download. Say so: the link above looks like a download page, and
    // somebody who has never used git will not guess the three commands.
    lines.push(`${COLOR_PINK}  To update: git pull, then npm install, then npm start${COLOR_RESET}`);

    lines.push(`${COLOR_PINK}${UPDATE_BOX_LINE}${COLOR_RESET}`, '');

    console.log(lines.join('\n'));
}

function compareVersions(a, b) {
    const parse = version => version
        .split('.')
        .map(part => Number(part.replace(/[^0-9]/g, '')) || 0);

    const aParts = parse(a);
    const bParts = parse(b);
    const length = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < length; i++) {
        const aValue = aParts[i] || 0;
        const bValue = bParts[i] || 0;

        if (aValue < bValue) return -1;
        if (aValue > bValue) return 1;
    }

    return 0;
}

async function fetchRemotePackage() {
    const response = await fetch(REMOTE_PACKAGE_URL, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Failed to fetch remote package: ${response.status}`);
    }

    return response.json();
}

async function fetchRemoteCommitMessage() {
    const response = await fetch(REMOTE_COMMIT_URL, {
        method: 'GET',
        headers: {
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch remote commit: ${response.status}`);
    }

    const data = await response.json();
    return data.commit?.message || null;
}

async function checkVersion() {
    try {
        const currentVersion = require('./package.json').version;
        let remotePackage;

        try {
            remotePackage = await fetchRemotePackage();
        } catch {
            return;
        }

        const latestVersion = remotePackage?.version;
        if (!latestVersion || compareVersions(currentVersion, latestVersion) >= 0) {
            return;
        }

        let commitMessage = null;
        try {
            commitMessage = await fetchRemoteCommitMessage();
        } catch {
            // commit msg optional
        }

        printUpdateNotice(DEFAULT_UPDATE_URL, commitMessage);
    } catch (err) {
        console.error('Update check failed:', err.message);
    }
}

module.exports = { checkVersion };
