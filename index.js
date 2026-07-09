require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const state = require('./core/state');

const startEventSub = require("./eventsub");
const startWidgetServer = require("./widget/server");
const startCanvasApi = require("./Spotify-Canvas-API/index");

const obs = require("./services/obs");

const commands = new Map();

const commandFiles = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);

  if (!command.name || !command.execute) {
    console.warn(`Invalid command file: ${file}`);
    continue;
  }

  const commandNames = [command.name, ...(command.aliases || [])];

  for (const name of commandNames) {
    commands.set(name.toLowerCase(), command);
  }
}

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
  startWidgetServer();

  const { default: startCanvasApi } = await import("./Spotify-Canvas-API/index.js");
  startCanvasApi();

  await obs.connect();
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
    client.say(channel, `@${username} you don't have permission to use this command. wuh`);
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
    client.say(channel, `@${username} command failed. umm`);
  }
});

function sanitizeChatMessage(msg) {
  return msg
    .replace(/[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}