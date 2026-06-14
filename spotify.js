require('dotenv').config();

let tokenData = {
  access_token:  process.env.SPOTIFY_ACCESS_TOKEN,
  refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
  expires_at:    Date.now() + 3600 * 1000
};

const MAX_DURATION_MS = 6 * 60 * 1000;
const SPOTIFY_PATTERN = /https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22}(?:\?si=[a-f0-9]+)?/;

async function refreshAccessToken() {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokenData.refresh_token
    })
  });

  const data = await response.json();
  tokenData.access_token = data.access_token;
  tokenData.expires_at = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) tokenData.refresh_token = data.refresh_token;
  console.log('Spotify token refreshed.');
  return tokenData.access_token;
}

async function getValidToken() {
  if (tokenData.access_token && Date.now() < tokenData.expires_at - 60000) {
    return tokenData.access_token;
  }
  return await refreshAccessToken();
}

async function addToQueue(url) {
  if (!url) return 'noinput';

  const match = url.match(SPOTIFY_PATTERN);
  if (!match) return 'invalid';

  const token = await getValidToken();
  const trackId = match[0].split('/track/')[1].split('?')[0];
  const uri = `spotify:track:${trackId}`;

  const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const trackData = await trackRes.json();
  if (trackData.duration_ms > MAX_DURATION_MS) return 'toolong';

  const queueRes = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!queueRes.ok) return 'failed';

  return 'ok';
}

module.exports = { addToQueue };
