require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const tmi  = require('tmi.js');
const { addToQueue }  = require('./spotify');

const COOLDOWN_SECONDS = 120; // change this to adjust how often users can add songs in seconds
const COOLDOWN_MS = COOLDOWN_SECONDS * 1000;
const BROADCASTER = process.env.TWITCH_BROADCASTER_USERNAME;

const BLACKLIST_FILE = path.join(__dirname, 'queue-blacklist.json');
const QUEUE_STATE_FILE = path.join(__dirname, 'queue-state.json');

// Persistent state helpers 
function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Failed to load ${path.basename(filePath)}:`, err.message);
  }
  return fallback;
}

const cooldowns = new Map();

const blacklist = new Set(loadJSON(BLACKLIST_FILE, []));
function saveBlacklist() {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify([...blacklist], null, 2));
}

let queueEnabled = loadJSON(QUEUE_STATE_FILE, { enabled: true }).enabled ?? true;
function saveQueueState() {
  fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify({ enabled: queueEnabled }));
}

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: process.env.TWITCH_OAUTH
  },
  channels: [process.env.TWITCH_BROADCASTER_USERNAME]
});

client.connect();

client.on('message', async (channel, tags, message, self) => {
  if (self) return;

  const username = tags.username.toLowerCase();
  const isMod = tags.mod || username === BROADCASTER;

  if (!message.startsWith('!')) return;

  const args = message.slice(1).split(' ').filter(Boolean);
  const command = args.shift().toLowerCase();

  if (command === 'queue' || command === 'q') {
    if (!queueEnabled) {
      client.say(channel, `@${username} the queue is currently closed HAH`);
      return;
    }
    if (blacklist.has(username)) {
      client.say(channel, `@${username} you're not allowed to queue songs. wuh`);
      return;
    }
    const lastUsed = cooldowns.get(username);
    if (lastUsed) {
      const remaining = COOLDOWN_MS - (Date.now() - lastUsed);
      if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1000);
        client.say(channel, `@${username} wait ${seconds}s before queuing again Clocking`);
        return;
      }
    }

    if (!args[0]?.trim()) {
      client.say(channel, `@${username} please provide a Spotify track link! posivibes`);
      return;
    }

    const spotifyArg = args.find(a => a.includes('spotify.com/track/')) ?? args[0];
    const result = await addToQueue(spotifyArg);
    setTimeout(() => {
      if (result === 'ok') {
        cooldowns.set(username, Date.now());
        client.say(channel, `@${username} song added to queue!! DinoDance`);
      } else if (result === 'noinput') {
        client.say(channel, `@${username} usage: !q <spotify track url> ~ e.g. !q https://open.spotify.com/track/... Enough`);
      } else if (result === 'invalid') {
        client.say(channel, `@${username} that doesn't look right ~ must be a Spotify track link, e.g. https://open.spotify.com/track/... Enough`);
      } else if (result === 'toolong') {
        client.say(channel, `@${username} song is too long, max is 6 minutes. umm`);
      } else if (result === 'failed') {
        client.say(channel, `@${username} couldn't add to queue ~ is Spotify playing? umm`);
      }
    }, 1000);
    return;
  }

  // ── !deny / !allow
  if (command === 'deny' && isMod) {
    const target = args[0]?.toLowerCase();
    if (!target) {
      client.say(channel, 'usage: !deny <username>');
      return;
    }
    blacklist.add(target);
    saveBlacklist();
    client.say(channel, `@${target} has been banned from queuing songs D: wuh`);
    return;
  }

  if (command === 'allow' && isMod) {
    const target = args[0]?.toLowerCase();
    if (!target) {
      client.say(channel, 'usage: !allow <username>');
      return;
    }
    blacklist.delete(target);
    saveBlacklist();
    client.say(channel, `@${target} can queue songs again smileCat`);
    return;
  }

  // ── !qon / !qoff ─
  if (command === 'qon' && isMod) {
    if (queueEnabled) {
      client.say(channel, 'Queue is already open');
      return;
    }
    queueEnabled = true;
    saveQueueState();
    client.say(channel, 'Song queue is now open! DinoDance');
    return;
  }

  if (command === 'qoff' && isMod) {
    if (!queueEnabled) {
      client.say(channel, 'Queue is already closed');
      return;
    }
    queueEnabled = false;
    saveQueueState();
    client.say(channel, 'Song queue is now closed! wuh');
    return;
  }
});
