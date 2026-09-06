const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Nothing is listening here, so the file-writing fallback is what runs.
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';

const envFilePath = path.join(__dirname, '..', 'setup', 'envFile.js');

function freshEnvFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-env-'));
  const envFile = path.join(tempDir, '.env');
  process.env.QUEUEIFY_ENV_FILE = envFile;
  delete require.cache[require.resolve(envFilePath)];
  return { module: require(envFilePath), envFile };
}

function cleanupEnvFile() {
  delete process.env.QUEUEIFY_ENV_FILE;
  delete require.cache[require.resolve(envFilePath)];
}

test('updateEnv preserves comments, blank lines and key order', () => {
  const { module: envModule, envFile } = freshEnvFile();

  fs.writeFileSync(envFile, [
    '# Twitch settings',
    'TWITCH_BROADCASTER_USERNAME=old_name',
    '',
    'SPOTIFY_REWARD_NAME=Spotify Queue # this can be anything',
    'OBS_SCENE=Gaming'
  ].join('\n'));

  try {
    envModule.updateEnv({ TWITCH_BROADCASTER_USERNAME: 'new_name' });
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');

    assert.strictEqual(lines[0], '# Twitch settings');
    assert.strictEqual(lines[1], 'TWITCH_BROADCASTER_USERNAME=new_name');
    assert.strictEqual(lines[2], '');
    assert.strictEqual(lines[3], 'SPOTIFY_REWARD_NAME=Spotify Queue # this can be anything');
    assert.strictEqual(lines[4], 'OBS_SCENE=Gaming');
  } finally {
    cleanupEnvFile();
  }
});

test('updateEnv keeps trailing comments on rewritten values', () => {
  const { module: envModule, envFile } = freshEnvFile();
  fs.writeFileSync(envFile, 'SPOTIFY_REWARD_NAME=Spotify Queue # this can be anything\n');

  try {
    envModule.updateEnv({ SPOTIFY_REWARD_NAME: 'Song Request' });
    assert.strictEqual(
      fs.readFileSync(envFile, 'utf8').trim(),
      'SPOTIFY_REWARD_NAME=Song Request # this can be anything'
    );
  } finally {
    cleanupEnvFile();
  }
});

test('updateEnv appends keys that are not already present', () => {
  const { module: envModule, envFile } = freshEnvFile();
  fs.writeFileSync(envFile, 'TWITCH_BROADCASTER_USERNAME=me\n');

  try {
    envModule.updateEnv({ SPOTIFY_CLIENT_ID: 'abc123' });
    const contents = fs.readFileSync(envFile, 'utf8');
    assert.ok(contents.includes('TWITCH_BROADCASTER_USERNAME=me'));
    assert.ok(contents.includes('SPOTIFY_CLIENT_ID=abc123'));
  } finally {
    cleanupEnvFile();
  }
});

test('readEnv parses values without leaking trailing comments', () => {
  const { module: envModule, envFile } = freshEnvFile();
  fs.writeFileSync(envFile, 'SPOTIFY_REWARD_NAME=Spotify Queue # comment here\nOBS_SCENE=Gaming\n');

  try {
    const values = envModule.readEnv();
    assert.strictEqual(values.SPOTIFY_REWARD_NAME, 'Spotify Queue');
    assert.strictEqual(values.OBS_SCENE, 'Gaming');
  } finally {
    cleanupEnvFile();
  }
});

test('readEnv returns an empty object when there is no .env yet', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-env-'));
  process.env.QUEUEIFY_ENV_FILE = path.join(tempDir, '.env');
  delete require.cache[require.resolve(envFilePath)];

  try {
    assert.deepStrictEqual(require(envFilePath).readEnv(), {});
  } finally {
    cleanupEnvFile();
  }
});

test('setup server rejects env keys that are not on the allowlist', async () => {
  const { createApp } = require('../setup/server');
  const app = createApp();

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ PATH: '/tmp/evil', TWITCH_ACCESS_TOKEN: 'nope' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /No supported settings/);
  } finally {
    await new Promise(done => server.close(done));
  }
});

test('setup server reports status for every step', async () => {
  const { createApp } = require('../setup/server');
  const app = createApp();

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.strictEqual(res.status, 200);

    const status = await res.json();
    for (const key of ['twitch', 'spotify', 'reward', 'obs']) {
      assert.ok(key in status, `status should include ${key}`);
    }
    assert.strictEqual(typeof status.twitch.connected, 'boolean');
    assert.strictEqual(typeof status.spotify.connected, 'boolean');
  } finally {
    await new Promise(done => server.close(done));
  }
});

async function withServer(run) {
  // Never the real widget/config.json: these tests must not read - or write -
  // the settings of an install someone is actually using.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-status-'));
  process.env.QUEUEIFY_WIDGET_CONFIG_FILE = path.join(sandbox, 'widget-config.json');
  fs.writeFileSync(process.env.QUEUEIFY_WIDGET_CONFIG_FILE, '{}');

  for (const modulePath of [
    path.join(__dirname, '..', 'services', 'widgetLayout.js'),
    path.join(__dirname, '..', 'setup', 'server.js')
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }

  const { createApp } = require('../setup/server');
  const app = createApp();
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(done => server.close(done));
    delete process.env.QUEUEIFY_WIDGET_CONFIG_FILE;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test('status reports widget details and an overall complete flag', async () => {
  await withServer(async base => {
    const status = await (await fetch(`${base}/api/status`)).json();

    assert.strictEqual(typeof status.complete, 'boolean');
    assert.strictEqual(status.widget.width, 680);
    assert.strictEqual(status.widget.height, 192);
    assert.match(status.widget.url, /^http:\/\//);
    assert.ok('ip' in status.obs && 'port' in status.obs);
    // The password itself must never be sent to the browser.
    assert.strictEqual(status.obs.password, undefined);
    assert.strictEqual(typeof status.obs.hasPassword, 'boolean');
  });
});

test('obs test rejects a request with no address', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/obs/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /IP and port/);
  });
});

test('obs test turns a refused connection into readable guidance', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/obs/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Port 1 is reserved and will refuse immediately.
      body: JSON.stringify({ ip: '127.0.0.1', port: '1' })
    });

    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.doesNotMatch(data.error, /ECONNREFUSED/, 'raw socket errors should not reach the UI');
    assert.match(data.error, /WebSocket Server Settings|listening/);
  });
});

test('updateEnv refuses a value containing a line break', () => {
  const { module: envModule, envFile } = freshEnvFile();
  fs.writeFileSync(envFile, 'OBS_SCENE=Gaming\nOBS_WEBSOCKET_PASSWORD=old\n');

  try {
    assert.throws(
      () => envModule.updateEnv({ OBS_WEBSOCKET_PASSWORD: 'abc\nSPOTIFY_CLIENT_SECRET=pwned' }),
      /cannot contain a line break/
    );

    const contents = fs.readFileSync(envFile, 'utf8');
    assert.ok(!contents.includes('pwned'), 'an injected key must not reach .env');
    assert.ok(contents.includes('OBS_WEBSOCKET_PASSWORD=old'), 'the file must be left untouched');
  } finally {
    cleanupEnvFile();
  }
});

test('updateEnv validates every value before writing any of them', () => {
  const { module: envModule, envFile } = freshEnvFile();
  fs.writeFileSync(envFile, 'OBS_SCENE=Gaming\n');

  try {
    assert.throws(() => envModule.updateEnv({
      OBS_SCENE: 'Streaming',
      SP_DC: 'cookie\nwrapped'
    }));

    assert.match(fs.readFileSync(envFile, 'utf8'), /OBS_SCENE=Gaming/, 'no key should be half-written');
  } finally {
    cleanupEnvFile();
  }
});

test('setup server rejects a cross-origin request', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/migrate/twitch`, {
      method: 'POST',
      // A simple request: browsers send these cross-origin with no preflight.
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: 'x'
    });

    assert.strictEqual(res.status, 403);
  });
});

test('setup server rejects a request addressed to a rebound hostname', async () => {
  await withServer(async base => {
    // fetch() forbids setting Host, so make the request by hand. This is what
    // a DNS-rebinding attack looks like on the wire: the connection lands on
    // 127.0.0.1, but the browser addressed the attacker's hostname.
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: Number(new URL(base).port),
        path: '/api/status',
        headers: { Host: 'evil.example' }
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });

      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(status, 403);
  });
});

test('setup server still serves its own page and same-origin requests', async () => {
  await withServer(async base => {
    // A top-level navigation: correct Host, no Origin header.
    assert.strictEqual((await fetch(`${base}/api/status`)).status, 200);

    const res = await fetch(`${base}/api/env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ PATH: '/tmp/evil' })
    });

    assert.strictEqual(res.status, 400, 'should reach the handler, not the guard');
  });
});

test('setup server rejects a line break pasted into an env value', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-env-'));
  process.env.QUEUEIFY_ENV_FILE = path.join(tempDir, '.env');

  try {
    await withServer(async base => {
      const res = await fetch(`${base}/api/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ SP_DC: 'cookie\nOBS_WEBSOCKET_PASSWORD=pwned' })
      });

      assert.strictEqual(res.status, 400);
      assert.match((await res.json()).error, /line break/);
    });
  } finally {
    delete process.env.QUEUEIFY_ENV_FILE;
  }
});

test('migrate refuses to unlink anything without an explicit confirmation', async () => {
  await withServer(async base => {
    const bare = await fetch(`${base}/api/migrate/twitch`, { method: 'POST' });
    assert.strictEqual(bare.status, 400);

    const unconfirmed = await fetch(`${base}/api/migrate/twitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'yes' })
    });
    assert.strictEqual(unconfirmed.status, 400, 'only a literal true should count');
  });
});

// Rebuilds the whole chain (envFile -> liveEnv -> server) against a throwaway
// .env, so the server under test reads the file this test writes.
async function withServerOn(envFile, run) {
  const liveEnvPath = path.join(__dirname, '..', 'config', 'liveEnv.js');
  const serverPath = path.join(__dirname, '..', 'setup', 'server.js');

  process.env.QUEUEIFY_ENV_FILE = envFile;
  for (const modulePath of [envFilePath, liveEnvPath, serverPath]) {
    delete require.cache[require.resolve(modulePath)];
  }

  const { createApp } = require(serverPath);
  const server = await new Promise(resolve => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(done => server.close(done));
    delete process.env.QUEUEIFY_ENV_FILE;
    for (const modulePath of [envFilePath, liveEnvPath, serverPath]) {
      delete require.cache[require.resolve(modulePath)];
    }
  }
}

test('status follows .env as it is written, not as it was at startup', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-env-'));
  const envFile = path.join(tempDir, '.env');
  fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=\n');

  await withServerOn(envFile, async base => {
    const before = await (await fetch(`${base}/api/status`)).json();
    assert.strictEqual(before.obs.configured, false);
    assert.strictEqual(before.canvas.configured, false);

    // Stands in for the user filling .env in while everything is running.
    fs.writeFileSync(envFile, [
      'OBS_WEBSOCKET_IP=127.0.0.1',
      'OBS_WEBSOCKET_PORT=4455',
      'OBS_WEBSOCKET_PASSWORD=secret',
      'OBS_SCENE=Gaming',
      'OBS_SOURCE=Queueify',
      'SP_DC=cookie-value'
    ].join('\n'));

    const after = await (await fetch(`${base}/api/status`)).json();
    assert.strictEqual(after.obs.configured, true);
    assert.strictEqual(after.obs.scene, 'Gaming');
    assert.strictEqual(after.obs.source, 'Queueify');
    assert.strictEqual(after.obs.hasPassword, true);
    assert.strictEqual(after.canvas.configured, true);

    // Neither secret belongs in a page the browser can read.
    const raw = JSON.stringify(after);
    assert.ok(!raw.includes('secret'), 'the OBS password must not be sent to the browser');
    assert.ok(!raw.includes('cookie-value'), 'the sp_dc cookie must not be sent to the browser');
  });
});

test('a scene named in .env but missing a source is not reported as configured', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-env-'));
  const envFile = path.join(tempDir, '.env');
  fs.writeFileSync(envFile, 'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Gaming\nOBS_SOURCE=\n');

  await withServerOn(envFile, async base => {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.strictEqual(status.obs.configured, false);
    assert.strictEqual(status.obs.scene, 'Gaming');
  });
});

test('a comment left where a value should be is not read back as the value', () => {
  const { module: envModule, envFile } = freshEnvFile();

  // The shape the old README taught people to write, with the value cleared.
  fs.writeFileSync(envFile, 'OBS_SCENE=   # match it to yours\nOBS_SOURCE=Queueify # match it to yours\n');

  try {
    const values = envModule.readEnv();
    assert.strictEqual(values.OBS_SCENE, '', 'a comment is not a scene name');
    assert.strictEqual(values.OBS_SOURCE, 'Queueify');

    envModule.updateEnv({ OBS_SCENE: 'Gaming' });
    const contents = fs.readFileSync(envFile, 'utf8');

    assert.ok(contents.includes('OBS_SCENE=Gaming # match it to yours'), contents);
    assert.strictEqual(envModule.readEnv().OBS_SCENE, 'Gaming');
  } finally {
    cleanupEnvFile();
  }
});

/**
 * Channel points need an Affiliate or Partner channel. Requiring the reward
 * meant a channel without them could never finish setup, so the bot never
 * started - even though song requests from chat need nothing from Twitch
 * beyond a login.
 */
test('setup can finish without a channel point reward', () => {
  const serverPath = path.join(__dirname, '..', 'setup', 'server.js');
  delete require.cache[require.resolve(serverPath)];
  const { setupIsComplete } = require(serverPath);

  const connected = {
    twitch: { connected: true },
    spotify: { connected: true },
    reward: { created: false }
  };

  assert.strictEqual(setupIsComplete(connected), true, 'no reward is still a finished setup');
  assert.strictEqual(setupIsComplete({ ...connected, reward: { created: true } }), true);

  // The two that really are needed still gate it.
  assert.strictEqual(setupIsComplete({ ...connected, twitch: { connected: false } }), false);
  assert.strictEqual(setupIsComplete({ ...connected, spotify: { connected: false } }), false);

  delete require.cache[require.resolve(serverPath)];
});
