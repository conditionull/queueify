const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const storePath = path.join(__dirname, '..', 'twitch-token-store.js');
const devicePath = path.join(__dirname, '..', 'services', 'twitchDeviceAuth.js');

function loadFreshDeviceAuth() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-device-'));
  const tokenFile = path.join(tempDir, 'twitch-token.json');
  process.env.TWITCH_TOKEN_FILE = tokenFile;
  process.env.TWITCH_CLIENT_ID = 'public-client-id';
  delete require.cache[require.resolve(storePath)];
  delete require.cache[require.resolve(devicePath)];
  return { auth: require(devicePath), tokenFile };
}

function cleanup(originalFetch) {
  global.fetch = originalFetch;
  delete process.env.TWITCH_TOKEN_FILE;
  delete process.env.TWITCH_CLIENT_ID;
  delete require.cache[require.resolve(storePath)];
  delete require.cache[require.resolve(devicePath)];
}

const DEVICE_RESPONSE = {
  device_code: 'device-code-123',
  user_code: 'ABCD1234',
  verification_uri: 'https://www.twitch.tv/activate',
  verification_uri_complete: 'https://www.twitch.tv/activate?public=true&device-code=ABCD1234',
  interval: 1,
  expires_in: 1800
};

const TOKEN_RESPONSE = {
  access_token: 'device-access-token',
  refresh_token: 'device-refresh-token',
  expires_in: 3600,
  scope: ['chat:read', 'chat:edit', 'channel:read:redemptions', 'channel:manage:redemptions', 'user:read:chat'],
  token_type: 'bearer'
};

// Keep the suite fast: the flow always sleeps one interval before polling.
function fastPrompt(prompt) {
  return { ...prompt, intervalMs: 1 };
}

test('requestDeviceCode returns the user code and prefers the pre-filled verification URL', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({ url, body: options.body });
    return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
  };

  try {
    const prompt = await auth.requestDeviceCode();
    assert.strictEqual(prompt.userCode, 'ABCD1234');
    assert.strictEqual(prompt.verificationUri, DEVICE_RESPONSE.verification_uri_complete);
    assert.strictEqual(prompt.deviceCode, 'device-code-123');
    assert.strictEqual(requests[0].url, 'https://id.twitch.tv/oauth2/device');
    assert.strictEqual(requests[0].body.get('client_id'), 'public-client-id');
    assert.ok(requests[0].body.get('scopes').includes('channel:read:redemptions'));
    // No client secret is ever sent - this is a public client flow.
    assert.strictEqual(requests[0].body.get('client_secret'), null);
  } finally {
    cleanup(originalFetch);
  }
});

test('polls through authorization_pending and saves tokens once approved', async () => {
  const { auth, tokenFile } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;
  let polls = 0;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    polls += 1;
    if (polls < 3) {
      return { ok: false, status: 400, json: async () => ({ message: 'authorization_pending' }) };
    }
    return { ok: true, status: 200, json: async () => TOKEN_RESPONSE };
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    let pendingTicks = 0;
    const result = await auth.pollForDeviceToken(prompt, { onPending: () => { pendingTicks += 1; } });

    assert.strictEqual(result.accessToken, 'device-access-token');
    assert.strictEqual(result.refreshToken, 'device-refresh-token');
    assert.deepStrictEqual(result.missingScopes, []);
    assert.strictEqual(pendingTicks, 2);

    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    assert.strictEqual(saved.access_token, 'device-access-token');
    assert.strictEqual(saved.refresh_token, 'device-refresh-token');
    assert.ok(saved.expires_at > Date.now(), 'expires_at should be in the future');
  } finally {
    cleanup(originalFetch);
  }
});

test('backs off when Twitch says slow_down', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;
  const pollTimes = [];

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    pollTimes.push(Date.now());
    if (pollTimes.length === 1) {
      return { ok: false, status: 400, json: async () => ({ message: 'slow_down' }) };
    }
    return { ok: true, status: 200, json: async () => TOKEN_RESPONSE };
  };

  try {
    const prompt = { ...(await auth.requestDeviceCode()), intervalMs: 1 };
    // Real step is 5s; inject a small one so the suite stays fast while still
    // proving the interval actually grows after a slow_down.
    await auth.pollForDeviceToken(prompt, { slowDownStepMs: 300 });
    const gap = pollTimes[1] - pollTimes[0];
    assert.ok(gap >= 250, `expected the second poll to back off, waited ${gap}ms`);
  } finally {
    cleanup(originalFetch);
  }
});

test('surfaces a denied authorization', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    return { ok: false, status: 400, json: async () => ({ message: 'access_denied' }) };
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    await assert.rejects(
      () => auth.pollForDeviceToken(prompt),
      err => err.code === 'denied'
    );
  } finally {
    cleanup(originalFetch);
  }
});

test('surfaces an expired device code', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    return { ok: false, status: 400, json: async () => ({ message: 'expired_token' }) };
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    await assert.rejects(
      () => auth.pollForDeviceToken(prompt),
      err => err.code === 'expired'
    );
  } finally {
    cleanup(originalFetch);
  }
});

test('stops polling once the prompt deadline passes', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    return { ok: false, status: 400, json: async () => ({ message: 'authorization_pending' }) };
  };

  try {
    const prompt = { ...(await auth.requestDeviceCode()), intervalMs: 1, expiresAt: Date.now() + 5 };
    await assert.rejects(
      () => auth.pollForDeviceToken(prompt),
      err => err.code === 'expired'
    );
  } finally {
    cleanup(originalFetch);
  }
});

test('rides out transient network failures instead of aborting the flow', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;
  let polls = 0;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    polls += 1;
    if (polls <= 2) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return { ok: true, status: 200, json: async () => TOKEN_RESPONSE };
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    const result = await auth.pollForDeviceToken(prompt);
    assert.strictEqual(result.accessToken, 'device-access-token');
    assert.strictEqual(polls, 3);
  } finally {
    cleanup(originalFetch);
  }
});

test('gives up after repeated network failures', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    await assert.rejects(
      () => auth.pollForDeviceToken(prompt),
      err => err.code === 'network'
    );
  } finally {
    cleanup(originalFetch);
  }
});

test('can be cancelled mid-flight', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;
  const controller = new AbortController();

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    return { ok: false, status: 400, json: async () => ({ message: 'authorization_pending' }) };
  };

  try {
    const prompt = { ...(await auth.requestDeviceCode()), intervalMs: 50 };
    const pending = auth.pollForDeviceToken(prompt, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(() => pending, err => err.code === 'cancelled');
  } finally {
    cleanup(originalFetch);
  }
});

test('reports scopes the user did not actually grant', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...TOKEN_RESPONSE, scope: ['chat:read', 'chat:edit'] })
    };
  };

  try {
    const prompt = fastPrompt(await auth.requestDeviceCode());
    const result = await auth.pollForDeviceToken(prompt);
    assert.deepStrictEqual(result.missingScopes, [
      'channel:read:redemptions',
      'channel:manage:redemptions',
      'user:read:chat'
    ]);
  } finally {
    cleanup(originalFetch);
  }
});

test('fails clearly when the app is not registered as a public client', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}) // no device_code / user_code
  });

  try {
    await assert.rejects(
      () => auth.requestDeviceCode(),
      err => err.code === 'request_failed' && /Public/.test(err.message)
    );
  } finally {
    cleanup(originalFetch);
  }
});

test('reports which account approved the prompt', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    if (url === 'https://api.twitch.tv/helix/users') {
      assert.strictEqual(options.headers.Authorization, 'Bearer device-access-token');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1234', login: 'sadrobotsdontcry', display_name: 'sadrobotsdontcry' }] })
      };
    }
    return { ok: true, status: 200, json: async () => TOKEN_RESPONSE };
  };

  try {
    let seenPrompt = null;
    const result = await auth.authorizeDevice({
      onPrompt: prompt => {
        seenPrompt = prompt;
        prompt.intervalMs = 1;
      }
    });

    assert.ok(seenPrompt, 'onPrompt should receive the prompt so the UI can show the code');
    assert.strictEqual(result.identity.login, 'sadrobotsdontcry');
    assert.strictEqual(result.identity.id, '1234');
  } finally {
    cleanup(originalFetch);
  }
});

test('identity lookup failure does not fail the authorization', async () => {
  const { auth } = loadFreshDeviceAuth();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      return { ok: true, status: 200, json: async () => DEVICE_RESPONSE };
    }
    if (url === 'https://api.twitch.tv/helix/users') {
      throw new Error('helix unreachable');
    }
    return { ok: true, status: 200, json: async () => TOKEN_RESPONSE };
  };

  try {
    const result = await auth.authorizeDevice({ onPrompt: prompt => { prompt.intervalMs = 1; } });
    assert.strictEqual(result.identity, null);
    assert.strictEqual(result.accessToken, 'device-access-token');
  } finally {
    cleanup(originalFetch);
  }
});
