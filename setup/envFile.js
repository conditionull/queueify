const fs = require('fs');
const path = require('path');

const ENV_FILE = process.env.QUEUEIFY_ENV_FILE || path.join(__dirname, '..', '.env');
const EXAMPLE_FILE = path.join(__dirname, '..', '.env.example');

function splitLine(line) {
    const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(line);
    if (!match) return null;

    const [, indent, key, separator, rest] = match;

    // Keep any trailing "# comment" intact when we rewrite the value. The
    // comment can also be the whole of `rest` - "OBS_SCENE=   # set me" leaves
    // nothing else behind once the separator has eaten the spaces - and
    // reading that back as the value hands the bot a scene named "# set me".
    const commentMatch = /(?:^|\s)#.*$/.exec(rest);
    let comment = commentMatch ? commentMatch[0] : '';
    const value = comment ? rest.slice(0, rest.length - comment.length) : rest;

    // Re-separate a comment that sat flush against the separator, so writing a
    // value back cannot glue the two together.
    if (comment && !/^\s/.test(comment)) comment = ` ${comment}`;

    return { indent, key, separator, value, comment };
}

function readEnvFile() {
    try {
        return fs.readFileSync(ENV_FILE, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

/** Current .env values as a plain object (empty object if there's no .env). */
function readEnv() {
    const contents = readEnvFile();
    if (contents === null) return {};

    const values = {};
    for (const line of contents.split(/\r?\n/)) {
        const parsed = splitLine(line);
        if (parsed) values[parsed.key] = parsed.value.trim();
    }
    return values;
}

/**
 * A value containing a line break would define extra keys the next time .env
 * is read back, so a secret that picked one up on the way in (a wrapped paste,
 * or a deliberate injection) has to fail loudly. Stripping it silently instead
 * would hand back a plausible-looking but wrong credential.
 */
function assertSingleLine(key, value) {
    if (/[\r\n]/.test(String(value))) {
        const err = new Error(`${key} cannot contain a line break.`);
        err.code = 'invalid_value';
        throw err;
    }
}

/**
 * Write key/values into .env, preserving existing order, comments and blank
 * lines. Unknown keys are appended. Creates .env from .env.example if missing.
 */
function updateEnv(updates) {
    const keys = Object.keys(updates);
    if (!keys.length) return;

    // Validate everything up front so a bad value can't leave a half-written file.
    for (const key of keys) assertSingleLine(key, updates[key]);

    let contents = readEnvFile();

    if (contents === null) {
        try {
            contents = fs.readFileSync(EXAMPLE_FILE, 'utf8');
        } catch {
            contents = '';
        }
    }

    const remaining = new Set(keys);
    const lines = contents.split(/\r?\n/);

    const rewritten = lines.map(line => {
        const parsed = splitLine(line);
        if (!parsed || !remaining.has(parsed.key)) return line;

        remaining.delete(parsed.key);

        // "KEY=   # comment" has its padding in the separator; keeping it would
        // write "KEY=   value". A key that already had a value keeps its own
        // spacing exactly as the user wrote it.
        const separator = parsed.value === '' ? parsed.separator.replace(/\s+$/, '') : parsed.separator;

        return `${parsed.indent}${parsed.key}${separator}${updates[parsed.key]}${parsed.comment}`;
    });

    for (const key of keys) {
        if (remaining.has(key)) rewritten.push(`${key}=${updates[key]}`);
    }

    let output = rewritten.join('\n');
    if (!output.endsWith('\n')) output += '\n';

    fs.writeFileSync(ENV_FILE, output, { mode: 0o600 });

    // Keep the running process in sync so callers see their own writes.
    for (const [key, value] of Object.entries(updates)) {
        process.env[key] = value;
    }
}

module.exports = { ENV_FILE, readEnv, updateEnv };
