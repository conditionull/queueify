const fs = require('fs');
const path = require('path');

const TOKEN_FILE = process.env.TWITCH_TOKEN_FILE || path.join(__dirname, 'twitch-token.json');

function normalizeToken(raw) {
  if (!raw) return {};

  return {
    access_token: raw.access_token || raw.accessToken || '',
    refresh_token: raw.refresh_token || raw.refreshToken || '',
    expires_at: raw.expires_at || raw.expiresAt || 0,
    // Which Twitch app minted this token. Lets startup notice when the app
    // changed (so the token is no longer usable) instead of failing later.
    client_id: raw.client_id || raw.clientId || ''
  };
}

function clearToken() {
  try {
    fs.rmSync(TOKEN_FILE, { force: true });
  } catch (err) {
    console.error('Failed to remove twitch-token.json:', err.message);
  }
}

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return normalizeToken(JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
    }
  } catch (err) {
    console.error('Failed to load twitch-token.json:', err.message);
  }

  return normalizeToken({
    access_token: process.env.TWITCH_ACCESS_TOKEN,
    refresh_token: process.env.TWITCH_REFRESH_TOKEN,
    expires_at: 0
  });
}

function saveToken(token) {
  const normalized = normalizeToken(token);
  const tmpFile = `${TOKEN_FILE}.tmp`;

  fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, TOKEN_FILE);
  fs.chmodSync(TOKEN_FILE, 0o600);
}

module.exports = {
  loadToken,
  saveToken,
  clearToken,
  TOKEN_FILE
};
