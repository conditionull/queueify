require('dotenv').config();
const express = require('express');
const { saveToken } = require('./spotify-token-store');

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8000/callback';
const PORT = new URL(REDIRECT_URI).port || 8000;
const SCOPES = 'user-modify-playback-state user-read-currently-playing user-read-playback-state';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  process.exit(1);
}

app.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const spotifyError = req.query.error;

  if (spotifyError) {
    res.status(400).send(`Spotify authorization failed: ${spotifyError}`);
    return;
  }

  if (!code) {
    res.status(400).send('Missing Spotify authorization code');
    return;
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Spotify token exchange failed:', data);
      res.status(response.status).send('Spotify token exchange failed. Check the terminal for details.');
      return;
    }

    if (!data.access_token || !data.refresh_token || !data.expires_in) {
      console.error('Spotify token response was missing expected fields:', data);
      res.status(500).send('Spotify token response was missing expected fields.');
      return;
    }

    saveToken({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    });

    res.send('Spotify tokens saved to spotify-token.json. You can close this tab owo');
    server.close(() => {
      console.log('Spotify auth complete.');
    });
  } catch (err) {
    console.error('Spotify auth failed:', err);
    res.status(500).send('Spotify auth failed. Check the terminal for details.');
  }
});

const server = app.listen(PORT, () => {
  console.log(`Open this in your browser: ${new URL('/login', REDIRECT_URI).toString()}`);
});
