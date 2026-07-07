## queueify

Twitch bot that handles Spotify song queuing for your stream with a handful of useful features <br />Disclaimer:  clanker helped me, yippie!

I tried to make this README as comprehensive as possible; Please let me know if i should add anything for clarity!


> [!NOTE]
Adding songs to playback queue requires Spotify Premium

> **Comprehensive list of all commands at the bottom!!**

### Features
- Supports Twitch Channel Point Redemptions as an alternative way to queue songs
- Lists the current queue with `!q`
- Auto-refunds channel point redemptions when:
    - user is on cooldown (queue delay)
    - same-song repeat block triggers
    - song is too long (maxSongLength)
- Uses Twitch EventSub WebSocket for real-time redemption handling
- Command to completely disable/enable the channel reward redemption (hides it from redemption list in chat `!rewardoff` and `!rewardon`)
- Tracks who queued each song and shows whether the current song was queued by a chatter or not with `!active`
- Prevents duplicate spam with per-user cooldowns and repeat-song blocking (a user can't queue the same song for [x] amount of time)
- Configurable max song duration limit `!duration <seconds>`
- Supports mod controls for opening/closing the queue, cooldowns, song duration, and blacklist management `view commands at bottom`
- Persists queue state, deny list, cooldown settings, repeat delay, and pending attribution in JSON files
* Automatically manages Spotify authentication tokens (access + refresh)


<br />

### Requirements

- [Node.js](https://nodejs.org/en/download) (download the .msi for windows)


## Setup

### 1. Clone and install dependencies (or download the zip file)

```sh
git clone https://github.com/conditionull/queueify.git
cd queueify
npm install
```
<br />

### 2. Environment variables

Copy the contents of `.env.example` file to `.env` and fill in your credentials:

```sh
cp .env.example .env
```

Your `.env` should contain:

```sh
TWITCH_BROADCASTER_USERNAME=
TWITCH_BOT_USERNAME=
TWITCH_ACCESS_TOKEN=
TWITCH_CLIENT_ID=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/callback
SPOTIFY_REWARD_NAME=Spotify Queue # this can be anything
```

### Twitch Tokens
Get them from [twitchtokengenerator.com](https://twitchtokengenerator.com/)
<br />
When visiting the site, click the robot icon `Bot Chat Token` > then toggle the following scopes: `chat:read` `chat:edit`, `channel:read:redemptions`, `channel:manage:redemptions`, `user:read:chat`
<br />Then click `"Generate  Token!"`
<br /><br />
**((** the values below are located under `"Generated Tokens"` section on the website **))**
<br />
The `TWITCH_ACCESS_TOKEN` value is what you copy from `ACCESS TOKEN` on the website.<br />Add `CLIENT ID` value to your .env file as well. 

> [!NOTE]
If you wanted to use another account to send messages instead of your own, simply do the same process but logged into the other account when visiting twitch [twitchtokengenerator.com](https://twitchtokengenerator.com/)

### Spotify Application Creation
Create an app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to get your `Client ID` **and** `Client Secret`.<br />
Set the redirect-uri to `http://127.0.0.1:8000/callback` or the exact value you put for `SPOTIFY_REDIRECT_URI` in the .env file. `localhost` is no longer supported by Spotify's API. 
<details>
  <summary>[Click to view working example]</summary>
  <img src="assets/image.png" />
</details>

<br />

### 3. Spotify tokens
 
Run `node auth.js` from the project root to generate `spotify-token.json`:

```sh
node auth.js
```
Open the link it prints in your terminal, log in with Spotify, and it'll save your access token, refresh token, and expiry to `spotify-token.json`.

<br />

### 4. Create Custom Channel Reward
If you've done everything above, simply run in project root:
```sh
node reward.js
```
You can now mess with the rewards name, color, icon, description text, etc. in your twitch dashboard. If you recreate the reward manually with the same name, functionality will break. Use the command above instead^

### 5. Start the bot

```sh
npm start
```

<br />

## Twitch Chat Commands

| Command | Who | Description |
|---|---|---|
| `!q <spotify_url>` | Everyone | Queue a Spotify track (defaults: `360sec` max song length, and `60sec` queue cooldown) |
| `!q` | Everyone | Show up to 10 queued songs |
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
| `!rewardoff` | Mods | Disable channel reward |
| `!rewardon` | Mods | Enable channel reward |
| `!chatoff` | Mods | Disable chat queueing |
| `!chaton` | Mods | Enable chat queueing |

You can customize command aliases by editing the `aliases` array in each command file under the `commands/` directory, for example:

```js
aliases: ['q', 'sr', 'add'],
```

`queue-settings.json` will generate once you set a value for the following commands: `delay`, `duration`, or `repeatdelay`. Otherwise, the default values will be used.

Queue open/closed state persists across restarts in `queue-state.json`. The queue deny list persists in `queue-blacklist.json`. Queue delay, maxSongLength, and repeat delay persist in `queue-settings.json`. Active chat attribution persists in `queue-pending.json`, which is reconciled against Spotify's real queue when `!queue` or `!active` runs.
