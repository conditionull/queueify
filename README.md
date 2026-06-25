## queueify

Twitch bot that handles Spotify song queuing for your stream with a handful of useful features <br />Disclaimer:  clanker helped me, yippie!


> [!NOTE]
Adding songs to playback queue requires Spotify Premium

> **Comprehensive list of all commands at the bottom!!**

### Features
- Lists the current queue with `!q`
- Tracks who queued each song and shows whether the current song was queued by a chatter or not with `!active`
- Prevents duplicate spam with per-user cooldowns and repeat-song blocking (a user can't queue the same song for [x] amount of time)
- Configurable max song duration limit `!duration <seconds>`
- Supports mod controls for opening/closing the queue, cooldowns, song duration, and blacklist management `view commands at bottom`
- Persists queue state, deny list, cooldown settings, repeat delay, and pending attribution in JSON files
* Automatically manages Spotify authentication tokens (access + refresh)


<br />

### Requirements

- Node.js


## Setup

### 1. Clone and install dependencies

```sh
git clone https://github.com/conditionull/queueify.git
cd queueify
npm install
```
<br />

### 2. Environment variables

Copy the example file to `.env` and fill in your credentials:

```sh
cp .env.example .env
```

Your `.env` should contain:

```sh
TWITCH_BOT_USERNAME=
TWITCH_BROADCASTER_USERNAME=
TWITCH_OAUTH=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/callback
```

**Twitch token**: get one from [twitchtokengenerator.com](https://twitchtokengenerator.com/) using custom scopes. The `TWITCH_OAUTH` value should be what you copied from the ACCESS TOKEN field on the website.<br />Required scopes: `chat:read` `chat:edit`

**Spotify**: create an app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to get your Client ID and Client Secret. The bot handles token refreshing automatically. Set the redirect-uri to `http://127.0.0.1:8000/callback` or the exact value you put for `SPOTIFY_REDIRECT_URI` in the .env file. `localhost` is no longer supported by Spotify's API.

<br />

### 3. Get Spotify tokens
 
Run `auth.js` once to create `spotify-token.json`:

```sh
node auth.js
```
Open the link it prints in your terminal, log in with Spotify, and it'll save your access token, refresh token, and expiry to `spotify-token.json`.

<br />

### 4. Start the bot!

```sh
npm start
```

<br />

## Chat commands

| Command | Who | Description |
|---|---|---|
| `!q <spotify_url>` | Everyone | Queue a Spotify track (defaults: `360sec` max song length, and `60sec` queue cooldown) |
| `!q` | Everyone | Show up to 10 actively queued songs |
| `!active` | Everyone | Show whether the current Spotify song was queued by chat |
| `!qon` | Mods | Open the queue |
| `!qoff` | Mods | Close the queue |
| `!delay` | Mods | Show the current queue cooldown |
| `!delay <seconds>` | Mods | Change the queue cooldown |
| `!repeatdelay` | Mods | Show the same-user same-song block window |
| `!duration` | Everyone | View the max duration for a queuable song |
| `!duration <seconds>` | Mods | Change the max duration a song can be when queued |
| `!repeatdelay <seconds>` | Mods | Change the same-user same-song block window |
| `!deny <username>` | Mods | Block a user from queuing |
| `!allow <username>` | Mods | Unblock a user |

You can customize command aliases by editing the `aliases` array in each command file under the `commands/` directory, for example:

```js
aliases: ['q', 'sr', 'add'],
```

`queue-settings.json` will generate once you set a value for the following commands: `delay`, `duration`, or `repeatdelay`. Otherwise, the default values will be used.

Queue open/closed state persists across restarts in `queue-state.json`. The queue deny list persists in `queue-blacklist.json`. Queue delay, maxSongLength, and repeat delay persist in `queue-settings.json`. Active chat attribution persists in `queue-pending.json`, which is reconciled against Spotify's real queue when `!queue` or `!active` runs.
