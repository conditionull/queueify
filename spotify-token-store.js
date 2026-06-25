const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, 'spotify-token.json');

function normalizeToken(raw) {
  if (!raw) return {};

  return {
    access_token: raw.access_token || raw.accessToken,
    refresh_token: raw.refresh_token || raw.refreshToken,
    expires_at: raw.expires_at || raw.expiresAt || 0
  };
}

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return normalizeToken(JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
    }
  } catch (err) {
    console.error('Failed to load spotify-token.json:', err.message);
  }

  return normalizeToken({
    access_token: process.env.SPOTIFY_ACCESS_TOKEN,
    refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
    expires_at: 0
  });
}

function saveToken(token) {
  const normalized = normalizeToken(token);
  const tmpFile = `${TOKEN_FILE}.tmp`;

  fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmpFile, TOKEN_FILE);
}

module.exports = {
  loadToken,
  saveToken,
  TOKEN_FILE
};
