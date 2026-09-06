const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const healthPath = path.join(__dirname, '..', 'services', 'setupHealth.js');
const statePath = path.join(__dirname, '..', 'core', 'state.js');
const storePath = path.join(__dirname, '..', 'twitch-token-store.js');
const authPath = path.join(__dirname, '..', 'services', 'twitchAuth.js');

const CURRENT_CLIENT = 'current-client-id';
const REQUIRED = 'chat:read chat:edit channel:read:redemptions channel:manage:redemptions user:read:chat'.split(' ');

function sandbox({ token, settings } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-health-'));
  const tokenFile = path.join(dir, 'twitch-token.json');

  if (token) fs.writeFileSync(tokenFile, JSON.stringify(token));
  if (settings) fs.writeFileSync(path.join(dir, 'queue-settings.json'), JSON.stringify(settings));

  process.env.QUEUEIFY_DATA_DIR = dir;
  process.env.TWITCH_TOKEN_FILE = tokenFile;
  process.env.TWITCH_CLIENT_ID = CURRENT_CLIENT;

  for (const p of [healthPath, statePath, storePath, authPath]) delete require.cache[require.resolve(p)];

  return { dir, tokenFile, health: require(healthPath), state: require(statePath) };
}

function cleanup(originalFetch) {
  global.fetch = originalFetch;
  delete process.env.QUEUEIFY_DATA_DIR;
  delete process.env.TWITCH_TOKEN_FILE;
  delete process.env.TWITCH_CLIENT_ID;
  for (const p of [healthPath, statePath, storePath, authPath]) delete require.cache[require.resolve(p)];
}

function validateResponse(body, status = 200) {
  return { ok: status === 200, status, json: async () => body };
}

test('clears a token minted by a different Twitch application', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'old-app-token', refresh_token: 'r', client_id: 'some-old-app' }
  });
  const originalFetch = global.fetch;

  global.fetch = async () => validateResponse({ client_id: 'some-old-app', login: 'streamer', scopes: REQUIRED });

  try {
    const issues = await health.repairSetupState();
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, 'twitch_client_changed');
    assert.strictEqual(fs.existsSync(tokenFile), false, 'unusable token should be removed');
  } finally {
    cleanup(originalFetch);
  }
});

// An access token Twitch rejects has almost always just aged out - they only
// live a few hours - so these cover the difference between "renew it" and
// "the login really is gone".
test('renews an aged-out access token instead of wiping the setup', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'stale', refresh_token: 'r', client_id: CURRENT_CLIENT }
  });
  const originalFetch = global.fetch;
  let renewed = false;

  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/oauth2/token')) {
      renewed = true;
      return { ok: true, status: 200, json: async () => ({ access_token: 'fresh', expires_in: 14400 }) };
    }

    return options.headers.Authorization === 'OAuth fresh'
      ? validateResponse({ client_id: CURRENT_CLIENT, login: 'streamer', scopes: REQUIRED })
      : validateResponse({}, 401);
  };

  try {
    assert.deepStrictEqual(await health.repairSetupState(), [], 'a renewable login is not an issue');
    assert.strictEqual(renewed, true, 'should have tried to renew before giving up');

    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    assert.strictEqual(saved.access_token, 'fresh');
    assert.strictEqual(saved.refresh_token, 'r', 'refresh token must survive');
  } finally {
    cleanup(originalFetch);
  }
});

test('clears the token once Twitch refuses to renew it', async () => {
  const { health, tokenFile } = sandbox({ token: { access_token: 'dead', refresh_token: 'r' } });
  const originalFetch = global.fetch;

  global.fetch = async url => String(url).includes('/oauth2/token')
    ? { ok: false, status: 400, json: async () => ({ message: 'Invalid refresh token' }) }
    : validateResponse({}, 401);

  try {
    const issues = await health.repairSetupState();
    assert.strictEqual(issues[0].code, 'twitch_token_invalid');
    assert.strictEqual(fs.existsSync(tokenFile), false);
  } finally {
    cleanup(originalFetch);
  }
});

test('a network failure during renewal must not wipe a working setup', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'stale', refresh_token: 'r', client_id: CURRENT_CLIENT }
  });
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (String(url).includes('/oauth2/token')) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    return validateResponse({}, 401);
  };

  try {
    assert.deepStrictEqual(await health.repairSetupState(), [], 'unreachable Twitch means unknown, not broken');
    assert.strictEqual(fs.existsSync(tokenFile), true, 'refresh token must survive a blip');
  } finally {
    cleanup(originalFetch);
  }
});

test('reports the real reason when an aged-out token is from another app', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'stale', refresh_token: 'r', client_id: 'some-old-app' }
  });
  const originalFetch = global.fetch;
  let renewed = false;

  global.fetch = async url => {
    if (String(url).includes('/oauth2/token')) renewed = true;
    return validateResponse({}, 401);
  };

  try {
    const issues = await health.repairSetupState();
    assert.strictEqual(issues[0].code, 'twitch_client_changed');
    assert.strictEqual(renewed, false, "another app's token cannot be renewed with our client id");
    assert.strictEqual(fs.existsSync(tokenFile), false);
  } finally {
    cleanup(originalFetch);
  }
});

test('clears a token that is missing required scopes', async () => {
  const { health, tokenFile } = sandbox({ token: { access_token: 'partial', refresh_token: 'r' } });
  const originalFetch = global.fetch;

  global.fetch = async () => validateResponse({
    client_id: CURRENT_CLIENT,
    login: 'streamer',
    scopes: ['chat:read', 'chat:edit']
  });

  try {
    const issues = await health.repairSetupState();
    assert.strictEqual(issues[0].code, 'twitch_scopes_missing');
    assert.match(issues[0].message, /channel:read:redemptions/);
    assert.strictEqual(fs.existsSync(tokenFile), false);
  } finally {
    cleanup(originalFetch);
  }
});

test('a network failure must not wipe a working setup', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'fine', refresh_token: 'r', client_id: CURRENT_CLIENT }
  });
  const originalFetch = global.fetch;

  global.fetch = async () => { throw new Error('offline'); };

  try {
    const issues = await health.repairSetupState();
    assert.deepStrictEqual(issues, [], 'unreachable Twitch means unknown, not broken');
    assert.strictEqual(fs.existsSync(tokenFile), true, 'token must survive a blip');
  } finally {
    cleanup(originalFetch);
  }
});

test('backfills the client id on tokens saved before it was recorded', async () => {
  const { health, tokenFile } = sandbox({
    token: { access_token: 'legacy', refresh_token: 'r' } // no client_id
  });
  const originalFetch = global.fetch;

  global.fetch = async () => validateResponse({ client_id: CURRENT_CLIENT, login: 'streamer', scopes: REQUIRED });

  try {
    const issues = await health.repairSetupState();
    assert.deepStrictEqual(issues, []);
    assert.strictEqual(JSON.parse(fs.readFileSync(tokenFile, 'utf8')).client_id, CURRENT_CLIENT);
  } finally {
    cleanup(originalFetch);
  }
});

test('unlinks a reward this app cannot manage', async () => {
  const { health, state } = sandbox({
    token: { access_token: 'fine', refresh_token: 'r', client_id: CURRENT_CLIENT, expires_at: Date.now() + 3_600_000 },
    settings: { spotifyRewardId: 'someone-elses-reward' }
  });
  const originalFetch = global.fetch;
  state.broadcasterId = 'broadcaster-1';

  global.fetch = async url => {
    if (String(url).includes('/oauth2/validate')) {
      return validateResponse({ client_id: CURRENT_CLIENT, login: 'streamer', scopes: REQUIRED });
    }
    // We own nothing on this channel.
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  try {
    const issues = await health.repairSetupState();
    assert.strictEqual(issues[0].code, 'reward_unmanageable');
    assert.strictEqual(state.spotifyRewardId, null, 'reward link should be dropped');
  } finally {
    cleanup(originalFetch);
  }
});

test('keeps a reward this app does manage', async () => {
  const { health, state } = sandbox({
    token: { access_token: 'fine', refresh_token: 'r', client_id: CURRENT_CLIENT, expires_at: Date.now() + 3_600_000 },
    settings: { spotifyRewardId: 'ours' }
  });
  const originalFetch = global.fetch;
  state.broadcasterId = 'broadcaster-1';

  global.fetch = async url => {
    if (String(url).includes('/oauth2/validate')) {
      return validateResponse({ client_id: CURRENT_CLIENT, login: 'streamer', scopes: REQUIRED });
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'ours', title: 'Spotify Queue' }] }) };
  };

  try {
    assert.deepStrictEqual(await health.repairSetupState(), []);
    assert.strictEqual(state.spotifyRewardId, 'ours');
  } finally {
    cleanup(originalFetch);
  }
});
