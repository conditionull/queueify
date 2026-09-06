require('./helpers/ensureDependencies')();
require('dotenv').config({ quiet: true });

const { authorizeDevice, REQUIRED_SCOPES } = require('./services/twitchDeviceAuth');
const { TOKEN_FILE } = require('./twitch-token-store');
const openBrowser = require('./helpers/openBrowser');

const BROADCASTER = process.env.TWITCH_BROADCASTER_USERNAME;

(async () => {
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.once('SIGINT', onSigint);

    try {
        const result = await authorizeDevice({
            scopes: REQUIRED_SCOPES,
            signal: controller.signal,
            onPrompt: prompt => {
                console.log('');
                console.log('  Authorize Queueify on Twitch:');
                console.log('');
                console.log(`    ${prompt.verificationUri}`);
                console.log('');
                console.log(`  If the page asks for a code, enter:  ${prompt.userCode}`);
                console.log('');

                if (openBrowser(prompt.verificationUri)) {
                    console.log('  (opening that page in your browser...)');
                }

                console.log('  Waiting for you to approve...');
            }
        });

        console.log('');
        console.log('Twitch authorization complete.');

        if (result.identity) {
            console.log(`Authorized as: ${result.identity.displayName || result.identity.login}`);

            if (BROADCASTER && result.identity.login.toLowerCase() !== BROADCASTER.toLowerCase()) {
                console.warn('');
                console.warn(`WARNING: you authorized as "${result.identity.login}", but TWITCH_BROADCASTER_USERNAME is "${BROADCASTER}".`);
                console.warn('Channel point redemptions require the authorizing account to be the broadcaster or a moderator of that channel.');
            }
        }

        if (result.missingScopes.length) {
            console.warn('');
            console.warn('WARNING: these scopes were not granted:', result.missingScopes.join(', '));
            console.warn('Some features will not work. Re-run this command and approve all requested permissions.');
        }

        if (!result.refreshToken) {
            console.warn('');
            console.warn('WARNING: no refresh token was issued, so the access token cannot renew itself.');
        }

        console.log('');
        console.log(`Tokens saved to ${TOKEN_FILE}`);
        console.log('You can now run: npm start');
        process.exit(0);
    } catch (err) {
        console.error('');

        switch (err.code) {
            case 'cancelled':
                console.error('Cancelled.');
                break;
            case 'denied':
                console.error('Authorization was denied on Twitch. Re-run this command and click Authorize.');
                break;
            case 'expired':
                console.error('The code expired before it was approved. Re-run this command to get a new one.');
                break;
            case 'config':
                console.error(err.message);
                console.error('Set TWITCH_CLIENT_ID in .env to a Twitch application with its client type set to "Public".');
                break;
            case 'network':
                console.error(err.message);
                console.error('Check your internet connection and try again.');
                break;
            default:
                console.error(`Twitch authorization failed: ${err.message}`);
        }

        process.exit(1);
    } finally {
        process.removeListener('SIGINT', onSigint);
    }
})();
