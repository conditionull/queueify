const path = require('path');

const COLOR_PINK = '\x1b[95m';
const COLOR_RESET = '\x1b[0m';
const DEFAULT_UPDATE_URL = 'https://github.com/conditionull/queueify';
const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/conditionull/queueify/main/package.json';
const REMOTE_COMMIT_URL = 'https://api.github.com/repos/conditionull/queueify/commits/main';
const UPDATE_BOX_LINE = '────────────────────────────────────────────────────────────';

function printUpdateNotice(url = DEFAULT_UPDATE_URL, commitMessage = null) {
    const lines = [
        '',
        `${COLOR_PINK}${UPDATE_BOX_LINE}${COLOR_RESET}`,
        `${COLOR_PINK}  New Update Available on GitHub${COLOR_RESET}`,
        `${COLOR_PINK}  ${url}${COLOR_RESET}`
    ];

    if (commitMessage) {
        lines.push(`${COLOR_PINK}  What's new: ${commitMessage}${COLOR_RESET}`);
    }

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
