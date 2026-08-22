require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const state = require('./core/state');

const startEventSub = require("./eventsub");
const startWidgetServer = require("./widget/server");

const obs = require("./services/obs");
const { sayMessage } = require('./services/messages');
const aliases = require('./services/aliases');

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

const BROADCASTER = process.env.TWITCH_BROADCASTER_USERNAME?.toLowerCase();

const cooldowns = new Map();

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: `oauth:${process.env.TWITCH_ACCESS_TOKEN}`
  },
  channels: [process.env.TWITCH_BROADCASTER_USERNAME]
});

async function main() {
  await startWidgetServer();

  const { default: startCanvasApi } = await import("./Spotify-Canvas-API/index.js");
  startCanvasApi();

  const { checkVersion } = require('./version-check');
  await checkVersion();

  if (process.env.OBS_WEBSOCKET_IP) {
    try {
      await obs.connect();
    } catch (err) {
      console.warn("Failed to connect to OBS. Widget position commands will be unavailable.");
      console.warn(err.message);
    }
  } else {
    console.log("OBS not configured. Widget position commands are disabled.");
  }

  await client.connect();
  startEventSub(client);
}

main().catch(err => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});


client.on('message', async (channel, tags, message, self) => {
  if (self) return;

  message = sanitizeChatMessage(message);

  const username = tags.username.toLowerCase();
  const isMod = tags.mod || username === BROADCASTER;

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
    console.error(`Command ${command} failed:`, err);
    sayMessage(client, channel, 'general.commandFailed', { username });
  }
});

function sanitizeChatMessage(msg) {
  return msg
    .replace(/[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}