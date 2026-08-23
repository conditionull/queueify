const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const test = require('node:test');

const tokenStorePath = path.join(__dirname, '..', 'spotify-token-store.js');
const spotifyPath = path.join(__dirname, '..', 'spotify.js');

function loadFreshTokenStore(tokenFilePath) {
  process.env.SPOTIFY_TOKEN_FILE = tokenFilePath;
  delete require.cache[require.resolve(tokenStorePath)];
  return require(tokenStorePath);
}

test('loadToken reads the latest token file contents', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-token-'));
  const tokenFile = path.join(tempDir, 'spotify-token.json');
  const tokenStore = loadFreshTokenStore(tokenFile);

  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'first', refresh_token: 'r1', expires_at: 1 }));

  const first = tokenStore.loadToken();
  assert.strictEqual(first.access_token, 'first');

  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'second', refresh_token: 'r2', expires_at: 2 }));

  const second = tokenStore.loadToken();
  assert.strictEqual(second.access_token, 'second');
});

test('addToQueue refreshes an expired token before making Spotify API calls', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-token-'));
  const tokenFile = path.join(tempDir, 'spotify-token.json');

  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'expired-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() - 60_000
  }));

  process.env.SPOTIFY_TOKEN_FILE = tokenFile;
  process.env.SPOTIFY_CLIENT_ID = 'client-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'client-secret';

  delete require.cache[require.resolve(tokenStorePath)];
  delete require.cache[require.resolve(spotifyPath)];

  const spotify = require(spotifyPath);
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({ url, headers: options.headers || {} });

    if (url === 'https://accounts.spotify.com/api/token') {
      return {
        ok: true,
        json: async () => ({ access_token: 'fresh-token', expires_in: 3600 })
      };
    }

    if (url.includes('/v1/tracks/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '1234567890123456789012',
          name: 'Test Song',
          artists: [{ name: 'Test Artist' }],
          duration_ms: 1000,
          album: { images: [{ url: 'https://example.com/cover.jpg' }] }
        })
      };
    }

    if (url.includes('/v1/me/player/queue')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await spotify.addToQueue('https://open.spotify.com/track/1234567890123456789012', 10);
    assert.strictEqual(result.status, 'ok');

    const tokenRequest = requests.find((req) => req.url === 'https://accounts.spotify.com/api/token');
    assert.ok(tokenRequest);

    const trackRequest = requests.find((req) => req.url.includes('/v1/tracks/'));
    assert.ok(trackRequest);
    assert.strictEqual(trackRequest.headers.Authorization, 'Bearer fresh-token');

    const queueRequest = requests.find((req) => req.url.includes('/v1/me/player/queue'));
    assert.ok(queueRequest);
    assert.strictEqual(queueRequest.headers.Authorization, 'Bearer fresh-token');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SPOTIFY_TOKEN_FILE;
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  }
});

test('skipToNext sends an authenticated playback skip request', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-token-'));
  const tokenFile = path.join(tempDir, 'spotify-token.json');

  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'valid-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 3_600_000
  }));

  process.env.SPOTIFY_TOKEN_FILE = tokenFile;
  delete require.cache[require.resolve(tokenStorePath)];
  delete require.cache[require.resolve(spotifyPath)];

  const spotify = require(spotifyPath);
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, status: 204 };
  };

  try {
    assert.strictEqual(await spotify.skipToNext(), true);
    assert.deepStrictEqual(requests, [{
      url: 'https://api.spotify.com/v1/me/player/next',
      options: {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' }
      }
    }]);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SPOTIFY_TOKEN_FILE;
  }
});

test('skipToNext returns false when Spotify rejects the playback command', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-token-'));
  const tokenFile = path.join(tempDir, 'spotify-token.json');

  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'valid-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 3_600_000
  }));

  process.env.SPOTIFY_TOKEN_FILE = tokenFile;
  delete require.cache[require.resolve(tokenStorePath)];
  delete require.cache[require.resolve(spotifyPath)];

  const spotify = require(spotifyPath);
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { message: 'No active device found' } })
  });

  try {
    assert.strictEqual(await spotify.skipToNext(), false);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SPOTIFY_TOKEN_FILE;
  }
});

