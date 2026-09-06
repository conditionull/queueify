const fs = require('fs');
const path = require('path');

/**
 * A missing package should not greet someone with a stack trace.
 *
 * Running `npm start` before `npm install` throws "Cannot find module 'dotenv'"
 * from somewhere deep in the entry file, which says nothing about what to do.
 * This runs first, using only built-in modules, and says the one useful thing.
 */

const ROOT = path.join(__dirname, '..');
const MINIMUM_NODE = 20;

function missingPackages() {
    let dependencies = {};

    try {
        dependencies = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {};
    } catch {
        return [];
    }

    return Object.keys(dependencies).filter(name => {
        try {
            // Resolving from the project root finds the real install, not
            // whatever happens to sit next to this helper.
            require.resolve(name, { paths: [ROOT] });
            return false;
        } catch {
            return true;
        }
    });
}

function nodeIsTooOld() {
    const major = Number(process.versions.node.split('.')[0]);
    return Number.isFinite(major) && major < MINIMUM_NODE;
}

function ensureDependencies() {
    if (nodeIsTooOld()) {
        console.error('');
        console.error(`  Queueify needs Node ${MINIMUM_NODE} or newer - this is Node ${process.versions.node}.`);
        console.error('  Install the current version from https://nodejs.org and try again.');
        console.error('');
        process.exit(1);
    }

    const missing = missingPackages();
    if (!missing.length) return;

    const installed = fs.existsSync(path.join(ROOT, 'node_modules'));

    console.error('');
    console.error(installed
        ? '  Some of Queueify\'s packages are missing or half-installed.'
        : '  Queueify\'s packages are not installed yet.');
    console.error('');
    console.error('      npm install');
    console.error('');
    console.error(`  Run that in ${ROOT}, then start Queueify again.`);
    console.error(`  (missing: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''})`);
    console.error('');

    process.exit(1);
}

module.exports = ensureDependencies;
