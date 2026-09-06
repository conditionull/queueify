const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const storePath = path.join(__dirname, '..', 'twitch-token-store.js');
const authPath = path.join(__dirname, '..', 'services', 'twitchAuth.js');

function loadFreshAuth(tokenFile) {
  process.env.TWITCH_TOKEN_FILE = tokenFile;
  process.env.TWITCH_CLIENT_ID = 'client-id';
  delete require.cache[require.resolve(storePath)];
  delete require.cache[require.resolve(authPath)];
  return require(authPath);
}

function cleanup() {
  delete process.env.TWITCH_TOKEN_FILE;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_ACCESS_TOKEN;
  delete process.env.TWITCH_REFRESH_TOKEN;
  delete process.env.TWITCH_CLIENT_SECRET;
  delete require.cache[require.resolve(storePath)];
  delete require.cache[require.resolve(authPath)];
}

test('refreshes after a Twitch 401 and persists rotated credentials', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'expired-token',
    refresh_token: 'refresh-token'
  }));
  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === 'https://id.twitch.tv/oauth2/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh-token', refresh_token: 'rotated-token', expires_in: 3600 })
      };
    }
    if (requests.filter(request => request.url === url).length === 1) {
      return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  try {
    const response = await auth.fetchTwitch('https://api.twitch.tv/helix/users');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer expired-token');
    assert.strictEqual(requests[1].options.body.get('refresh_token'), 'refresh-token');
    assert.strictEqual(requests[1].options.body.get('client_id'), 'client-id');
    // Public clients (device code flow) refresh with no secret at all.
    assert.strictEqual(requests[1].options.body.get('client_secret'), null);
    assert.strictEqual(requests[2].options.headers.Authorization, 'Bearer fresh-token');
    const savedToken = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    assert.strictEqual(savedToken.access_token, 'fresh-token');
    assert.strictEqual(savedToken.refresh_token, 'rotated-token');
    assert.strictEqual(typeof savedToken.expires_at, 'number');
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('shares one refresh request for concurrent 401 responses', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'expired-token', refresh_token: 'refresh-token' }));
  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  let refreshCount = 0;
  const originalRequests = new Map();

  global.fetch = async (url, options = {}) => {
    if (url === 'https://id.twitch.tv/oauth2/token') {
      refreshCount += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-token', expires_in: 3600 }) };
    }
    const count = (originalRequests.get(url) || 0) + 1;
    originalRequests.set(url, count);
    if (count === 1) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    await Promise.all([
      auth.fetchTwitch('https://api.twitch.tv/helix/users'),
      auth.fetchTwitch('https://api.twitch.tv/helix/users')
    ]);
    assert.strictEqual(refreshCount, 1);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('proactively refreshes an expiring stored token for TMI authentication', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'expiring-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 30_000
  }));
  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    assert.strictEqual(url, 'https://id.twitch.tv/oauth2/token');
    return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-token', expires_in: 3600 }) };
  };

  try {
    assert.strictEqual(await auth.getAccessToken(), 'fresh-token');
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('does not retry a Twitch request more than once after repeated 401 responses', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'old-token', refresh_token: 'refresh-token' }));
  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  let apiCalls = 0;
  let refreshCalls = 0;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/token') {
      refreshCalls += 1;
      return { ok: true, status: 200, json: async () => ({ access_token: 'new-token', refresh_token: 'refresh-token', expires_in: 3600 }) };
    }
    apiCalls += 1;
    return { ok: false, status: 401, json: async () => ({}) };
  };

  try {
    const response = await auth.fetchTwitch('https://api.twitch.tv/helix/users');
    assert.strictEqual(response.status, 401);
    assert.strictEqual(apiCalls, 2);
    assert.strictEqual(refreshCalls, 1);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('retries a transient connect timeout and then succeeds', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'good-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 3_600_000
  }));

  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  let attempts = 0;

  global.fetch = async () => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error('fetch failed'), {
        cause: { code: 'UND_ERR_CONNECT_TIMEOUT' }
      });
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  try {
    const response = await auth.fetchTwitch('https://api.twitch.tv/helix/users');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(attempts, 3, 'should retry twice before succeeding');
  } finally {
    console.warn = originalWarn;
    global.fetch = originalFetch;
    cleanup();
  }
});

test('gives up after repeated transient failures instead of hanging', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'good-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 3_600_000
  }));

  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  let attempts = 0;

  global.fetch = async () => {
    attempts += 1;
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
  };

  try {
    await assert.rejects(() => auth.fetchTwitch('https://api.twitch.tv/helix/users'));
    assert.strictEqual(attempts, 3, 'initial attempt plus two retries');
  } finally {
    console.warn = originalWarn;
    global.fetch = originalFetch;
    cleanup();
  }
});

test('does not retry a real HTTP error response', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-twitch-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'good-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 3_600_000
  }));

  const auth = loadFreshAuth(tokenFile);
  const originalFetch = global.fetch;
  let attempts = 0;

  global.fetch = async () => {
    attempts += 1;
    return { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) };
  };

  try {
    const response = await auth.fetchTwitch('https://api.twitch.tv/helix/users');
    assert.strictEqual(response.status, 403);
    assert.strictEqual(attempts, 1, 'a 403 is a real answer, not a blip - do not retry it');
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});
