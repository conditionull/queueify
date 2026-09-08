#!/usr/bin/env node

/**
 * Refuses to let a credential reach the repository.
 *
 * Two things go wrong in practice, and this catches both:
 *
 * 1. A file that should be ignored becomes tracked - `git add -f`, or a
 *    .gitignore edit that stops covering it. That has already happened here
 *    once: `.github/` was ignored wholesale, which silently meant no workflow
 *    could ever ship.
 * 2. A token gets pasted into a source file or a test fixture.
 *
 * Deliberately self-contained: no third-party action, nothing downloaded, so
 * the check itself is not a way in. Run it locally with `npm run check:secrets`.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

/** Files whose contents are credentials. None of these may ever be tracked. */
const NEVER_TRACKED = [
    /^\.env$/,
    /^\.env\.[^.]*$/,          // .env.local and friends - .env.example is allowed below
    /(^|\/)spotify-token\.json$/,
    /(^|\/)twitch-token\.json$/,
    /(^|\/)queue-settings\.json$/,
    /^config\/settings\.js$/
];

/** The one .env-shaped file that is meant to be here, because it is empty. */
const ALLOWED = [/^\.env\.example$/];

/**
 * Credential shapes, kept narrow on purpose. A pattern that fires on ordinary
 * code gets switched off by whoever it annoys, and then catches nothing.
 */
const PATTERNS = [
    { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
    { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
    { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
    { name: 'Twitch OAuth token', re: /\boauth:[a-z0-9]{28,}\b/ },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'Spotify sp_dc cookie', re: /\bSP_DC\s*=\s*\S{40,}/ },
    // Quoted literal only. Without the quotes this fires on every
    // `const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET`, which is a
    // read, not a leak. Real .env files are caught by name above, so their
    // unquoted values need no pattern here.
    { name: 'hard-coded secret', re: /\b(CLIENT_SECRET|WEBSOCKET_PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN)\s*[=:]\s*["'][A-Za-z0-9_\-.]{16,}["']/ }
];

/** Content that is not worth scanning, and would be noise if it were. */
const SKIP_CONTENT = [
    /^package-lock\.json$/,
    /^assets\//,
    /^Spotify-Canvas-API\//,
    // This file necessarily contains every pattern it looks for.
    /^scripts\/check-secrets\.js$/
];

function tracked() {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
}

function main() {
    const files = tracked();
    const problems = [];

    for (const file of files) {
        if (ALLOWED.some(rule => rule.test(file))) continue;

        if (NEVER_TRACKED.some(rule => rule.test(file))) {
            problems.push(`${file}: this file holds credentials and must never be committed`);
            continue;
        }

        if (SKIP_CONTENT.some(rule => rule.test(file))) continue;

        let contents;
        try {
            contents = fs.readFileSync(file, 'utf8');
        } catch {
            continue;   // binary, or gone from the working tree
        }

        // A NUL byte means binary; scanning it only produces false positives.
        if (contents.includes('\0')) continue;

        for (const { name, re } of PATTERNS) {
            const lines = contents.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                if (re.test(lines[i])) {
                    problems.push(`${file}:${i + 1}: looks like a ${name}`);
                }
            }
        }
    }

    if (!problems.length) {
        console.log(`Checked ${files.length} tracked files. No credentials found.`);
        return;
    }

    console.error('Credentials must not be committed:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
        '\nIf one of these is a false positive, narrow the pattern in' +
        ' scripts/check-secrets.js rather than deleting the check.'
    );
    process.exit(1);
}

main();
