require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { Vibrant } = require("node-vibrant/node");
const { loadToken, saveToken } = require('./spotify-token-store');
const { getCanvas } = require("./canvas");

console.log("Canvas function:", getCanvas);

let tokenData = loadToken();

const paletteCache = new Map();
const fallbackCache = new Map();

const SPOTIFY_PATTERN = /https:\/\/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/[a-zA-Z0-9]{22}(?:\?si=[a-zA-Z0-9]+)?/;

function formatTrack(track) {
  return {
    id: track.id || `local-${track.name}-${track.duration_ms}`,
    name: track.name,
    artists: track.artists?.map(artist => artist.name).join(', ') || 'Local Track',
    durationMs: track.duration_ms,

    cover: track.album?.images?.[0]?.url || null,
    isLocal: !track.id
  };
}

const FALLBACK_VIDEO_DIR = path.join(__dirname, "assets", "fallback_videos");

const FALLBACK_VIDEOS = fs.existsSync(FALLBACK_VIDEO_DIR)
  ? fs.readdirSync(FALLBACK_VIDEO_DIR)
    .filter(file => file.endsWith(".mp4"))
    .map(file => `/assets/fallback_videos/${file}`)
  : [];

function getRandomFallbackVideo() {
  if (!FALLBACK_VIDEOS.length) {
    return null;
  }

  return FALLBACK_VIDEOS[
    Math.floor(Math.random() * FALLBACK_VIDEOS.length)
  ];
}

async function getMedia(track) {
  const canvas = await getCanvas(track.id);

  if (canvas?.includes("canvaz.scdn.co") && canvas.endsWith(".mp4")) {
    return {
      type: "video",
      url: canvas
    };
  }

  if (track.cover) {
    return {
      type: "image",
      url: track.cover
    };
  }

  const fallbackKey = `${track.name}-${track.artists}-${track.durationMs}`;

  if (!fallbackCache.has(fallbackKey)) {
    fallbackCache.set(
      fallbackKey,
      getRandomFallbackVideo()
    );
  }

  return {
    type: "video",
    url: fallbackCache.get(fallbackKey)
  };
}

async function getPalette(trackId, imageUrl) {
  if (!imageUrl) return null;

  if (paletteCache.has(trackId)) {
    return paletteCache.get(trackId);
  }

  try {

    const palette = await Vibrant
      .from(imageUrl)
      .getPalette();

    const colors = {
      vibrant: palette.Vibrant?.hex,
      darkVibrant: palette.DarkVibrant?.hex,
      lightVibrant: palette.LightVibrant?.hex,

      muted: palette.Muted?.hex,
      darkMuted: palette.DarkMuted?.hex,
      lightMuted: palette.LightMuted?.hex
    };

    paletteCache.set(trackId, colors);

    return colors;

  } catch (err) {
    console.error("Palette extraction failed:", err);
    return null;
  }
}

function getTrackId(url) {
  const match = url?.match(SPOTIFY_PATTERN);
  if (!match) return null;
  return match[0].split('/track/')[1].split('?')[0];
}

async function fetchWithToken(url, options = {}, retry = true) {
  let token = await getValidToken();
  let response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401 && retry) {
    token = await refreshAccessToken();
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  }

  return response;
}

async function refreshAccessToken() {
  if (!tokenData.refresh_token) {
    throw new Error('Missing Spotify refresh token. Run `node auth.js` first.');
  }

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${JSON.stringify(data)}`);
  }

  if (!data.access_token || !data.expires_in) {
    throw new Error(`Spotify token refresh response was incomplete: ${JSON.stringify(data)}`);
  }

  tokenData.access_token = data.access_token;
  tokenData.expires_at = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) tokenData.refresh_token = data.refresh_token;
  saveToken(tokenData);
  console.log('Spotify token refreshed.');
  return tokenData.access_token;
}

async function getValidToken() {
  if (tokenData.access_token && Date.now() < tokenData.expires_at - 60000) {
    return tokenData.access_token;
  }
  return await refreshAccessToken();
}

async function addToQueue(url, maxSongLengthSeconds) {
  try {
    if (!url) return 'noinput';

    const trackId = getTrackId(url);
    if (!trackId) return 'invalid';

    const uri = `spotify:track:${trackId}`;

    const trackRes = await fetchWithToken(`https://api.spotify.com/v1/tracks/${trackId}`);

    if (!trackRes.ok) return 'failed';

    const trackData = await trackRes.json();
    if (trackData.duration_ms > maxSongLengthSeconds * 1000) return 'toolong';

    const queueRes = await fetchWithToken(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
      method: 'POST'
    });

    if (!queueRes.ok) return 'failed';

    return {
      status: 'ok',
      track: formatTrack(trackData)
    };
  } catch (err) {
    console.error('Spotify queue failed:', err.message);
    return 'failed';
  }
}

async function getCurrentTrack() {
  try {
    const response = await fetchWithToken(
      "https://api.spotify.com/v1/me/player"
    );

    if (response.status === 204) {
      return {
        isPlaying: false
      };
    }

    if (!response.ok) {
      throw new Error(
        `Spotify playback lookup failed with ${response.status}`
      );
    }

    const data = await response.json();

    if (!data.item || data.currently_playing_type !== "track") {
      return {
        isPlaying: false
      };
    }

    const track = formatTrack(data.item);
    const media = await getMedia(track);

    return {
      ...track,
      media,
      progressMs: data.progress_ms,
      durationMs: data.item.duration_ms,
      isPlaying: data.is_playing,
      fetchedAt: Date.now(),
      palette: await getPalette(track.id, track.cover)
    };

  } catch (err) {
    console.error("Spotify active lookup failed:");
    console.error(err);
    return false;
  }
}

async function getUserQueue() {
  try {
    const response = await fetchWithToken('https://api.spotify.com/v1/me/player/queue');

    if (!response.ok) throw new Error(`Spotify queue lookup failed with ${response.status}`);

    const data = await response.json();
    return {
      currentlyPlaying: data.currently_playing?.type === 'track' ? formatTrack(data.currently_playing) : null,
      queue: (data.queue || [])
        .filter(item => item.type === 'track')
        .map(formatTrack)
    };
  } catch (err) {
    console.error('Spotify queue lookup failed:', err.message);
    return false;
  }
}

module.exports = { addToQueue, getCurrentTrack, getUserQueue, getTrackId };
