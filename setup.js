require('./helpers/ensureDependencies')();
require('dotenv').config({ quiet: true });

const { startSetupServer } = require('./setup/server');
const openBrowser = require('./helpers/openBrowser');

(async () => {
    try {
        const { url, close } = await startSetupServer();

        console.log('');
        console.log(`  Queueify setup:  ${url}`);
        console.log('');
        console.log('  Press Ctrl+C when you are done.');

        openBrowser(url);

        const shutdown = async () => {
            await close();
            process.exit(0);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            const port = Number(process.env.SETUP_PORT) || 3002;
            // Queueify keeps this dashboard up while it runs, so this is the
            // normal case rather than a problem: point at the one already there.
            console.error(`The dashboard is already open at http://127.0.0.1:${port} - use that.`);
            console.error('If something else is using that port, set SETUP_PORT in .env.');
        } else {
            console.error('Could not start setup:', err.message);
        }
        process.exit(1);
    }
})();
