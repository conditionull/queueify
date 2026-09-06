const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const createRewardPath = path.join(__dirname, '..', 'services', 'createReward.js');
const statePath = path.join(__dirname, '..', 'core', 'state.js');
const tokenStorePath = path.join(__dirname, '..', 'twitch-token-store.js');
const twitchAuthPath = path.join(__dirname, '..', 'services', 'twitchAuth.js');

const RELOAD = [createRewardPath, statePath, tokenStorePath, twitchAuthPath];

/**
 * Point core/state.js at a throwaway directory: ensureSpotifyReward() calls
 * saveSettings(), which would otherwise rewrite the real queue-settings.json.
 *
 * The same goes for the token: fetchTwitch() needs one, and reading the
 * developer's own twitch-token.json would make these tests pass or fail
 * depending on whether that machine happens to be logged in.
 */
function loadFresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-reward-'));
  process.env.QUEUEIFY_DATA_DIR = dir;

  process.env.TWITCH_TOKEN_FILE = path.join(dir, 'twitch-token.json');
  fs.writeFileSync(process.env.TWITCH_TOKEN_FILE, JSON.stringify({
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    // Far enough out that nothing tries to refresh mid-test.
    expires_at: Date.now() + 3600_000
  }));

  for (const modulePath of RELOAD) delete require.cache[require.resolve(modulePath)];
  return require(createRewardPath);
}

function cleanup(originalFetch) {
  global.fetch = originalFetch;
  delete process.env.QUEUEIFY_DATA_DIR;
  delete process.env.TWITCH_TOKEN_FILE;
  for (const modulePath of RELOAD) delete require.cache[require.resolve(modulePath)];
}

function mockTwitch({ allRewards = [], manageableRewards = [], onCreate } = {}) {
  return async (url, options = {}) => {
    if (url.includes('/users?login=')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'broadcaster-1' }] }) };
    }

    if (url.includes('/channel_points/custom_rewards') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      onCreate?.(body);
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'new-reward', title: body.title }] }) };
    }

    if (url.includes('/channel_points/custom_rewards')) {
      const data = url.includes('only_manageable_rewards=true') ? manageableRewards : allRewards;
      return { ok: true, status: 200, json: async () => ({ data }) };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('refuses to adopt a reward created by another application', async () => {
  const reward = loadFresh();
  const originalFetch = global.fetch;
  process.env.TWITCH_BROADCASTER_USERNAME = 'streamer';
  let createCalled = false;

  global.fetch = mockTwitch({
    // The reward exists on the channel, but is not ours to manage.
    allRewards: [{ id: 'someone-elses', title: 'Spotify Queue' }],
    manageableRewards: [],
    onCreate: () => { createCalled = true; }
  });

  try {
    await assert.rejects(
      () => reward.ensureSpotifyReward(),
      err => /different application/.test(err.message)
    );
    assert.strictEqual(createCalled, false, 'must not create a duplicate reward');
  } finally {
    cleanup(originalFetch);
  }
});

test('creates the reward with a default name when none is configured', async () => {
  const reward = loadFresh();
  const originalFetch = global.fetch;
  process.env.TWITCH_BROADCASTER_USERNAME = 'streamer';
  delete process.env.SPOTIFY_REWARD_NAME;
  let createdWith = null;

  global.fetch = mockTwitch({
    allRewards: [],
    manageableRewards: [],
    onCreate: body => { createdWith = body; }
  });

  try {
    const result = await reward.ensureSpotifyReward();
    assert.strictEqual(createdWith.title, 'Spotify Queue');
    assert.strictEqual(result.created, true);
  } finally {
    cleanup(originalFetch);
  }
});

test('reuses a reward we own even after it has been renamed', async () => {
  const reward = loadFresh();
  const state = require(statePath);
  const originalFetch = global.fetch;

  process.env.TWITCH_BROADCASTER_USERNAME = 'streamer';
  state.spotifyRewardId = 'ours-123';
  let createCalled = false;

  global.fetch = mockTwitch({
    allRewards: [{ id: 'ours-123', title: 'Song Request (renamed)' }],
    manageableRewards: [{ id: 'ours-123', title: 'Song Request (renamed)' }],
    onCreate: () => { createCalled = true; }
  });

  try {
    const result = await reward.ensureSpotifyReward();
    assert.strictEqual(result.id, 'ours-123');
    assert.strictEqual(result.created, false);
    assert.strictEqual(createCalled, false, 'a rename must not trigger a second reward');
  } finally {
    cleanup(originalFetch);
  }
});

test('relinks an unlinked reward instead of creating a second one', async () => {
  const reward = loadFresh();
  const state = require(statePath);
  const originalFetch = global.fetch;

  process.env.TWITCH_BROADCASTER_USERNAME = 'streamer';

  // What an accidental unlink leaves behind: no live link, only the memory of
  // one - and the reward has since been renamed, so a name lookup cannot help.
  state.spotifyRewardId = 'ours-123';
  assert.strictEqual(state.forgetSpotifyReward(), true);
  assert.strictEqual(state.spotifyRewardId, null);
  assert.strictEqual(state.previousSpotifyRewardId, 'ours-123');

  let createCalled = false;
  global.fetch = mockTwitch({
    allRewards: [{ id: 'ours-123', title: 'Renamed By Hand' }],
    manageableRewards: [{ id: 'ours-123', title: 'Renamed By Hand' }],
    onCreate: () => { createCalled = true; }
  });

  try {
    const result = await reward.ensureSpotifyReward();

    assert.strictEqual(result.id, 'ours-123');
    assert.strictEqual(result.created, false);
    assert.strictEqual(createCalled, false, 'an unlink must not cause a duplicate reward');
    assert.strictEqual(state.spotifyRewardId, 'ours-123', 'the link should be restored');
    assert.strictEqual(state.previousSpotifyRewardId, null, 'the recovery pointer is spent');
  } finally {
    cleanup(originalFetch);
  }
});

test('forgetSpotifyReward is a no-op when nothing is linked', () => {
  loadFresh();
  const state = require(statePath);

  try {
    state.spotifyRewardId = null;
    state.previousSpotifyRewardId = null;

    assert.strictEqual(state.forgetSpotifyReward(), false);
    assert.strictEqual(state.previousSpotifyRewardId, null, 'must not overwrite a real id with null');
  } finally {
    cleanup(global.fetch);
  }
});
