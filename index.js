require('./helpers/ensureDependencies')();
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const state = require('./core/state');

const startEventSub = require("./eventsub");
const startWidgetServer = require("./widget/server");

const obs = require("./services/obs");
const { sayMessage } = require('./services/messages');
const aliases = require('./services/aliases');
const { getVerifiedAccessToken } = require('./services/twitchAuth');
const openBrowser = require('./helpers/openBrowser');

const commands = new Map();

const commandFiles = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter(f => f.endsWith('.js'));

const loadedCommands = commandFiles
  .map(file => require(`./commands/${file}`))
  .filter(command => {
    if (!command.name || !command.execute) {
      console.warn(`Invalid command file: ${command.name || '(unknown)'}`);
      return false;
    }
    return true;
  });

function buildCommandMap() {
  commands.clear();

  for (const command of loadedCommands) {
    const commandNames = [command.name, ...aliases.getAliases(command.name)];

    for (const name of commandNames) {
      commands.set(name.toLowerCase(), command);
    }
  }
}

aliases.setDefaultAliases(
  Object.fromEntries(loadedCommands.map(command => [command.name, command.aliases || []]))
);
aliases.onReload(buildCommandMap);
buildCommandMap();

const cooldowns = new Map();

// Built after ensureSetup(), since setup may be what writes these env values.
function createClient() {
  return new tmi.Client({
    options: { debug: true },
    identity: {
      username: process.env.TWITCH_BOT_USERNAME,
      password: async () => `oauth:${await getVerifiedAccessToken()}`
    },
    channels: [process.env.TWITCH_BROADCASTER_USERNAME]
  });
}

function dashboardUrl() {
  return require('./config/liveEnv').getDashboardUrl();
}

/**
 * Blocks until Twitch, Spotify and the reward are configured, hosting the
 * setup dashboard while we wait. Returns the dashboard if it started one here,
 * so the caller can keep it up rather than closing it. No-op once setup is
 * done.
 */
async function ensureSetup() {
  const { setupIsComplete, waitForSetup, setHealthIssues } = require('./setup/server');
  const { repairSetupState } = require('./services/setupHealth');

  // Verify the saved credentials still work with the configured Twitch app
  // before trusting them. Anything unusable is cleared, which routes the user
  // into the matching setup step instead of failing later.
  const issues = await repairSetupState();
  setHealthIssues(issues);

  for (const issue of issues) {
    console.warn(`Setup needs attention: ${issue.message}`);
  }

  if (setupIsComplete()) return null;

  const { url, close } = await openDashboard(null);

  if (close) {
    openBrowser(url);
  } else {
    // Setup is already open in another terminal - just wait for it to finish.
    console.log('Setup is already running elsewhere.');
  }

  console.log('');
  console.log(`  Queueify needs setup. Open:  ${url}`);
  console.log('');

  if (close) {
    await waitForSetup();
  } else {
    // Not our server, so poll instead of waiting on our own signal.
    while (!setupIsComplete()) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('Setup complete. Starting Queueify...');

  // Deliberately left running: the same page is the settings page from here on.
  return close ? { url, close } : null;
}

/** Is a dashboard - another Queueify, or `npm run setup` - already serving? */
async function dashboardIsServed(url) {
  const controller = new AbortController();
  // Cleared in `finally`: a live timer here would outlast the probe and keep
  // the process from exiting promptly on Ctrl+C.
  const timer = setTimeout(() => controller.abort(), 700);

  try {
    const res = await fetch(`${url}/api/status`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps the dashboard reachable for the whole session, so fixing a scene name
 * or a stale cookie never means stopping the bot. Someone else's dashboard on
 * the port is fine - the URL still works, we just do not own it.
 *
 * The port is asked before it is taken: Windows lets a second process bind a
 * port that is already listening, so EADDRINUSE alone would let two instances
 * fight over which one the browser reaches.
 */
async function openDashboard(existing) {
  if (existing) return existing;

  const { startSetupServer } = require('./setup/server');
  const url = dashboardUrl();

  if (await dashboardIsServed(url)) return { url, close: null };

  try {
    return await startSetupServer();
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    return { url, close: null };
  }
}

/** The size the browser source needs, which follows the sharpness setting. */
async function widgetSourceSize() {
  try {
    const res = await fetch('http://localhost:3001/api/widget/config');
    const config = await res.json();
    return { width: config.width || 680, height: config.height || 192 };
  } catch {
    return { width: 680, height: 192 };
  }
}

function printBanner(dashboard, widget) {
  const line = '  ' + '-'.repeat(62);

  console.log('');
  console.log(line);
  console.log('   Queueify is running.');
  console.log('');
  console.log(`   Widget (OBS browser source)   http://localhost:3001   ${widget.width} x ${widget.height}`);
  console.log(`   Settings dashboard            ${dashboard.url}`);
  console.log('');
  console.log('   Open the dashboard any time to reconnect an account, fix your');
  console.log('   OBS scene or source, or paste a new Spotify cookie. Changes');
  console.log('   apply straight away - no need to stop the bot.');
  console.log(line);
  console.log('');
}

/**
 * A port already in use almost always means Queueify is running in another
 * window. That deserves a sentence, not a stack trace - and stopping here is
 * right, because a second copy would fight the first over OBS and the queue.
 */
function reportBusyPort(err, what) {
  if (err?.code !== 'EADDRINUSE') return false;

  console.error('');
  console.error(`  Queueify cannot start: ${what} needs port ${err.port}, and something else has it.`);
  console.error('');
  console.error('  If Queueify is already running in another terminal, close that one first.');
  console.error('  Otherwise, quit whatever is using the port and try again.');
  console.error('');

  return true;
}

async function main() {
  const startedDashboard = await ensureSetup();

  try {
    await startWidgetServer();
  } catch (err) {
    if (reportBusyPort(err, 'the widget')) process.exit(1);
    throw err;
  }

  const { default: startCanvasApi } = await import("./Spotify-Canvas-API/index.js");

  try {
    await startCanvasApi();
  } catch (err) {
    if (reportBusyPort(err, 'the Canvas API')) process.exit(1);
    throw err;
  }

  const { checkVersion } = require('./version-check');
  await checkVersion();

  // Best effort only: OBS settings are re-read from .env on every widget
  // command, so filling them in (or fixing them) later takes effect on the
  // next !tr / !bc without restarting the bot.
  const { getObsConfig } = require('./config/liveEnv');

  const widgetLayout = require('./services/widgetLayout');

  // Registered before connecting, and kept whether or not that succeeds: these
  // are listeners on the OBS client itself, so opening OBS an hour from now
  // still resizes and reloads the widget.
  widgetLayout.watchObsResizes();
  widgetLayout.refreshOnConnect();

  if (getObsConfig().connectable) {
    try {
      await obs.connect();

      // Give the widget the pixels it needs for the space it has in OBS, so
      // nobody has to redo their layout after switching themes.
      const layout = await widgetLayout.reconcile();

      if (layout.applied && layout.changed) {
        console.log(`Widget now renders at ${layout.width} x ${layout.height}, matching its size in OBS.`);
        if (layout.presetsAdjusted) {
          console.log(`Adjusted ${layout.presetsAdjusted} saved !tr / !bc preset(s) to match.`);
        }
      }
    } catch (err) {
      console.warn("Could not connect to OBS yet:", err.message);
      console.warn("Queueify will retry on the next widget command.");
    }
  } else {
    console.log('OBS is not set up yet. The dashboard link below adds it - no restart needed afterwards.');
  }

  const client = createClient();
  client.on('message', (channel, tags, message, self) => handleMessage(client, channel, tags, message, self));

  await client.connect();
  const eventSub = startEventSub(client);

  const dashboard = await openDashboard(startedDashboard);
  printBanner(dashboard, await widgetSourceSize());

  const shutdown = async () => {
    console.log('Shutting down...');
    eventSub.stop();
    if (dashboard.close) await dashboard.close().catch(() => {});
    await client.disconnect().catch(() => {});
    // Give debounced state writes (core/state.js, ~100ms) a moment to flush.
    // Registering a signal handler suppresses Node's default terminate-on-signal
    // behavior, and the widget/canvas HTTP servers keep the event loop alive
    // indefinitely, so an explicit exit is required here.
    await new Promise(resolve => setTimeout(resolve, 250));
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(err => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});


async function handleMessage(client, channel, tags, message, self) {
  if (self) return;

  message = sanitizeChatMessage(message);

  const broadcaster = process.env.TWITCH_BROADCASTER_USERNAME?.toLowerCase();
  const username = tags.username.toLowerCase();
  const isMod = tags.mod || username === broadcaster;

  if (!message.startsWith('!')) return;

  const args = message.slice(1).split(' ').filter(Boolean);

  const command = args.shift().toLowerCase();

  const handler = commands.get(command);
  if (!handler) return;

  if (handler.modOnly && !isMod) {
    sayMessage(client, channel, 'general.permissionDenied', { username });
    return;
  }

  const context = {
    client,
    channel,
    tags,
    message,
    username,
    isMod,
    args,
    state,
    cooldowns
  };

  try {
    await handler.execute(context);
  } catch (err) {
    const networkCode = err?.code || err?.cause?.code;
    if (networkCode) {
      console.error(`Command ${command} failed: could not reach Twitch (${networkCode}). Try again in a moment.`);
    } else {
      console.error(`Command ${command} failed:`, err);
    }
    sayMessage(client, channel, 'general.commandFailed', { username });
  }
}

function sanitizeChatMessage(msg) {
  return msg
    .replace(/[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}