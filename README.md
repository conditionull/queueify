# queueify

Twitch bot that handles Spotify song queuing for your stream! <br />`DISCLAIMER:` clanker helped me

---

> [!NOTE]
Adding songs to playback queue requires Spotify Premium

## What it does

- Lets viewers queue Spotify songs via chat with a cooldown and blacklisting users if they queue trolly stuff

---

## Requirements

- Node.js

---

## Setup

### 1. Clone and install dependencies

```sh
git clone git@github.com:conditionull/queueify.git
cd queueify
npm install
```

### 2. Environment variables

Create a `.env` file in the root:

```sh
TWITCH_BOT_USERNAME=
TWITCH_BROADCASTER_USERNAME=
TWITCH_OAUTH=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_ACCESS_TOKEN=
SPOTIFY_REFRESH_TOKEN=
```

**Twitch token** — get one from [twitchtokengenerator.com](https://twitchtokengenerator.com/) using a custom scope. The `TWITCH_OAUTH` value should be what you copid from the ACCESS TOKEN field on the twitch token generator website. I used chat:read and chat:edit scopes, I'm pretty sure that's all you need

**Spotify** — create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to get your client ID and secret. The bot handles token refresh automatically.
<br />Make sure to set the redirect-uri to http://127.0.0.1:8000/callback or something else. localhost is no longer supported by Spotify's API

### 3. Get Spotify tokens
 
Leave `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_REFRESH_TOKEN` blank in `.env` for now. Run `auth.js` once to get them:
 
```sh
node auth.js
```
 
It starts a local server on port 8000. Open the link it prints in your terminal, log in with Spotify, and it'll write the tokens directly into your `.env` file. Once it says "tokens updated, you can close this" you're done. Don't run it again unless your tokens stop working

### 4. Run

```sh
node index.js
```

---

## Chat commands

### Song queue

| Command | Who | Description |
|---|---|---|
| `!queue <spotify_url>` | Everyone | Queue a Spotify track (6 min max, 2 min cooldown default) |
| `!q <spotify_url>` | Everyone | Alias for `!queue` |
| `!qon` | Mods | Open the queue |
| `!qoff` | Mods | Close the queue |
| `!deny <username>` | Mods | Block a user from queuing |
| `!allow <username>` | Mods | Unblock a user |

Queue open/closed state persists across restarts in `queue-state.json`. The queue deny list persists in `queue-blacklist.json`.
