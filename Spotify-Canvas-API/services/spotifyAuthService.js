import axios from "axios";
import * as OTPAuth from "otpauth";
import { getLiveValue } from "../../config/liveEnv.js";

// Read at call time, not at import: the cookie is often pasted into the setup
// page after the bot is already running, and a boot-time snapshot would keep
// serving the old (or missing) value until a restart.
function spotifyCookie() {
  return getLiveValue('SP_DC');
}
const SECRETS_URL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json";

// Global variables to store the current TOTP configuration
let currentTotp = null;
let currentTotpVersion = null;
let lastFetchTime = 0;
const FETCH_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

// Initialize TOTP secrets on startup
initializeTOTPSecrets();

// Set up periodic updates
setInterval(updateTOTPSecrets, FETCH_INTERVAL);

async function initializeTOTPSecrets() {
  try {
    await updateTOTPSecrets();
  } catch (error) {
    console.error('Failed to initialize TOTP secrets:', error);
    // Fallback to the original hardcoded secret
    useFallbackSecret();
  }
}

async function updateTOTPSecrets() {
  try {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_INTERVAL) {
      return; // Don't fetch too frequently
    }

    // console.log('Fetching updated TOTP secrets...');
    const secrets = await fetchSecretsFromGitHub();
    const newestVersion = findNewestVersion(secrets);
    
    if (newestVersion && newestVersion !== currentTotpVersion) {
      const secretData = secrets[newestVersion];
      const totpSecret = createTotpSecret(secretData);
      
      currentTotp = new OTPAuth.TOTP({
        period: 30,
        digits: 6,
        algorithm: "SHA1",
        secret: totpSecret
      });
      
      currentTotpVersion = newestVersion;
      lastFetchTime = now;
      console.log(`TOTP secrets updated to version ${newestVersion}`);
    } else {
      console.log(`No new TOTP secrets found, using version ${newestVersion}`);
    }
  } catch (error) {
    console.error('Failed to update TOTP secrets:', error);
    // Keep using current TOTP if available, otherwise use fallback
    if (!currentTotp) {
      useFallbackSecret();
    }
  }
}

async function fetchSecretsFromGitHub() {
  try {
    const response = await axios.get(SECRETS_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Failed to fetch secrets from GitHub:', error.message);
    throw error;
  }
}

function findNewestVersion(secrets) {
  const versions = Object.keys(secrets).map(Number);
  return Math.max(...versions).toString();
}

function createTotpSecret(data) {
  const mappedData = data.map((value, index) => value ^ ((index % 33) + 9));
  const hexData = Buffer.from(mappedData.join(""), "utf8").toString("hex");
  return OTPAuth.Secret.fromHex(hexData);
}

function useFallbackSecret() {
  // Fallback to the original hardcoded secret
  // This secret will most likely fail because Spotify is rotating the secrets every couple of days
  // This is really just kept in here for reference
  const fallbackData = [99, 111, 47, 88, 49, 56, 118, 65, 52, 67, 50, 104, 117, 101, 55, 94, 95, 75, 94, 49, 69, 36, 85, 64, 74, 60];
  const totpSecret = createTotpSecret(fallbackData);
  
  currentTotp = new OTPAuth.TOTP({
    period: 30,
    digits: 6,
    algorithm: "SHA1",
    secret: totpSecret
  });
  
  currentTotpVersion = "19"; // Fallback version
  console.log('Using fallback TOTP secret');
}

async function requestToken(reason, productType) {
  // Ensure we have a TOTP instance
  if (!currentTotp) {
    await initializeTOTPSecrets();
  }

  const payload = await generateAuthPayload(reason, productType);

  const url = new URL("https://open.spotify.com/api/token");
  Object.entries(payload).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await axios.get(url.toString(), {
    headers: {
      'User-Agent': userAgent(),
      'Origin': 'https://open.spotify.com/',
      'Referer': 'https://open.spotify.com/',
      'Cookie': `sp_dc=${spotifyCookie()}`,
    },
  });

  return response.data || {};
}

export async function getToken(reason = "init", productType = "mobile-web-player") {
  const data = await requestToken(reason, productType);
  return data.accessToken;
}

/**
 * Checks the sp_dc cookie without touching the widget, so setup can tell the
 * user it works before they go looking for missing Canvas videos.
 *
 * Spotify answers an unusable cookie with an anonymous token rather than an
 * error, which is why the flag - not the status code - is what decides here.
 */
export async function verifyCookie() {
  if (!spotifyCookie()) return { ok: false, reason: 'missing' };

  try {
    const data = await requestToken("init", "mobile-web-player");

    if (!data.accessToken) return { ok: false, reason: 'no_token' };
    if (data.isAnonymous) return { ok: false, reason: 'anonymous' };

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: err.message };
  }
}

async function generateAuthPayload(reason, productType) {
  const localTime = Date.now();
  const serverTime = await getServerTime();

  return {
    reason,
    productType,
    totp: generateTOTP(localTime),
    totpVer: currentTotpVersion || "19",
    totpServer: generateTOTP(Math.floor(serverTime / 30))
  };
}

async function getServerTime() {
  try {
    const { data } = await axios.get("https://open.spotify.com/api/server-time", {
      headers: {
        'User-Agent': userAgent(),
        'Origin': 'https://open.spotify.com/',
        'Referer': 'https://open.spotify.com/',
        'Cookie': `sp_dc=${spotifyCookie()}`,
      },
    });

    const time = Number(data.serverTime);
    if (isNaN(time)) throw new Error("Invalid server time");
    return time * 1000;
  } catch {
    return Date.now();
  }
}

function generateTOTP(timestamp) {
  if (!currentTotp) {
    throw new Error("TOTP not initialized");
  }
  return currentTotp.generate({ timestamp });
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
}