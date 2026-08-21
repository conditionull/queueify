require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { Vibrant } = require("node-vibrant/node");
const { loadToken, saveToken } = require('./spotify-token-store');
const { getCanvas } = require("./canvas");

const MAX_CACHE_SIZE = 100;
const paletteCache = new Map();
const fallbackCache = new Map();

const currentTrackCache = {
  expiresAt: 0,
  value: null,
  pending: null
};

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

function trimCache(cache, maxSize) {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
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
    trimCache(fallbackCache, MAX_CACHE_SIZE);
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
    trimCache(paletteCache, MAX_CACHE_SIZE);

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

const MAX_FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 200;
const MAX_RATE_LIMIT_RETRIES = 3;

class SpotifyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
  }
}

async function getApiError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `Spotify API request failed with status ${response.status}`;
  } catch {
    return `Spotify API request failed with status ${response.status}`;
  }
}

function getRetryDelay(response, attempt) {
  const retryAfter = Number(response.headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return retryAfter * 1000;
  }

  return FETCH_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

async function fetchWithRateLimitRetry(url, options, attempt = 1) {
  const response = await fetch(url, options);

  if (response.status === 429 && attempt <= MAX_RATE_LIMIT_RETRIES) {
    const delay = getRetryDelay(response, attempt);
    console.warn(`Spotify rate limit reached, retrying in ${delay}ms (${attempt}/${MAX_RATE_LIMIT_RETRIES})...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRateLimitRetry(url, options, attempt + 1);
  }

  return response;
}

function shouldRetryFetchError(err) {
  if (!err) return false;
  const code = err.code || err?.cause?.code;
  return typeof code === 'string' && code.startsWith('UND_ERR');
}

async function fetchWithToken(url, options = {}, retry = true, attempt = 1) {
  let token = await getValidToken();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 && retry) {
      token = await refreshAccessToken();
      return fetchWithToken(url, options, false, attempt);
    }

    if (response.status === 429 && attempt <= MAX_RATE_LIMIT_RETRIES) {
      const delay = getRetryDelay(response, attempt);
      console.warn(`Spotify rate limit reached, retrying in ${delay}ms (${attempt}/${MAX_RATE_LIMIT_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithToken(url, options, retry, attempt + 1);
    }

    if (!response.ok) {
      throw new SpotifyApiError(response.status, await getApiError(response));
    }

    return response;
  } catch (err) {
    if (attempt <= MAX_FETCH_RETRIES && shouldRetryFetchError(err)) {
      console.warn(`Spotify fetch error, retrying (${attempt}/${MAX_FETCH_RETRIES})...`, err.code || err.message);
      await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
      return fetchWithToken(url, options, retry, attempt + 1);
    }

    throw err;
  }
}

async function refreshAccessToken() {
  const currentTokenData = loadToken();

  if (!currentTokenData.refresh_token) {
    throw new Error('Missing Spotify refresh token. Run `node auth.js` first.');
  }

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  }

  const response = await fetchWithRateLimitRetry('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentTokenData.refresh_token
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 400 && data.error === 'invalid_grant') {
      throw new Error('Spotify refresh token expired or was revoked. Run `node auth.js` to authorize again.');
    }

    throw new Error(data.error_description || data.error || `Spotify token refresh failed with status ${response.status}`);
  }

  if (!data.access_token || !data.expires_in) {
    throw new Error(`Spotify token refresh response was incomplete: ${JSON.stringify(data)}`);
  }

  const updatedTokenData = {
    ...currentTokenData,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {})
  };

  saveToken(updatedTokenData);
  console.log('Spotify token refreshed.');
  return updatedTokenData.access_token;
}

async function getValidToken() {
  const currentTokenData = loadToken();

  if (currentTokenData.access_token && Date.now() < currentTokenData.expires_at - 60000) {
    return currentTokenData.access_token;
  }

  return await refreshAccessToken();
}

async function addToQueue(url, maxSongLengthSeconds, allowExplicit = true, trackData = null) {
  return addTrackToQueue(url, maxSongLengthSeconds, allowExplicit, trackData);
}

async function getTrack(url) {
  try {
    if (!url) return 'noinput';

    const trackId = getTrackId(url);
    if (!trackId) return 'invalid';

    const trackRes = await fetchWithToken(`https://api.spotify.com/v1/tracks/${trackId}`);

    if (!trackRes.ok) return null;

    return await trackRes.json();
  } catch (err) {
    console.error('Spotify track lookup failed:', err.message, err.status ? `(HTTP ${err.status})` : '');
    return null;
  }
}

async function addTrackToQueue(url, maxSongLengthSeconds, allowExplicit = true, trackData = null) {
  try {
    if (!url) return 'noinput';

    const trackId = getTrackId(url);
    if (!trackId) return 'invalid';

    const uri = `spotify:track:${trackId}`;
    trackData ??= await getTrack(url);
    if (!trackData) return 'failed';

    if (trackData.explicit && !allowExplicit) return 'explicit';
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
    console.error('Spotify queue failed:', err.message, err.status ? `(HTTP ${err.status})` : '');
    return { status: 'failed', message: err.message };
  }
}

async function getCurrentTrack() {
  const now = Date.now();
  if (currentTrackCache.expiresAt > now && currentTrackCache.value) {
    return currentTrackCache.value;
  }

  if (currentTrackCache.pending) {
    return currentTrackCache.pending;
  }

  currentTrackCache.pending = (async () => {
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
        throw new SpotifyApiError(response.status, await getApiError(response));
      }

      const data = await response.json();

      if (!data.item || data.currently_playing_type !== "track") {
        return {
          isPlaying: false
        };
      }

      const track = formatTrack(data.item);
      const media = await getMedia(track);

      const result = {
        ...track,
        media,
        progressMs: data.progress_ms,
        durationMs: data.item.duration_ms,
        isPlaying: data.is_playing,
        fetchedAt: Date.now(),
        palette: await getPalette(track.id, track.cover)
      };

      currentTrackCache.value = result;
      currentTrackCache.expiresAt = Date.now() + 2000;
      return result;
    } catch (err) {
      console.error("Spotify active lookup failed:", err.message, err.status ? `(HTTP ${err.status})` : '');
      return false;
    } finally {
      currentTrackCache.pending = null;
    }
  })();

  return currentTrackCache.pending;
}

async function getUserQueue() {
  try {
    const response = await fetchWithToken('https://api.spotify.com/v1/me/player/queue');

    if (!response.ok) {
      throw new SpotifyApiError(response.status, await getApiError(response));
    }

    const data = await response.json();
    return {
      currentlyPlaying: data.currently_playing?.type === 'track' ? formatTrack(data.currently_playing) : null,
      queue: (data.queue || [])
        .filter(item => item.type === 'track')
        .map(formatTrack)
    };
  } catch (err) {
    console.error('Spotify queue lookup failed:', err.message, err.status ? `(HTTP ${err.status})` : '');
    return false;
  }
}

module.exports = { addToQueue, getCurrentTrack, getUserQueue, getTrackId, getTrack };
