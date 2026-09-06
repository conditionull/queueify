const { spawn } = require('child_process');

/** Best-effort "open this URL for me". Never throws; callers print the URL too. */
function openBrowser(url) {
    try {
        const command = process.platform === 'win32' ? 'cmd'
            : process.platform === 'darwin' ? 'open'
                : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
        return true;
    } catch {
        return false;
    }
}

module.exports = openBrowser;
