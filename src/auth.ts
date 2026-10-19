const encoder = new TextEncoder();

/**
 * Constant-time check of the X-Telegram-Bot-Api-Secret-Token header.
 *
 * Both values are hashed first so the comparison always runs over equal-length
 * buffers, which `timingSafeEqual` requires and which hides the secret's length.
 * An unset or empty expected secret never matches.
 */
export async function isValidSecret(received: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || received === null) {
    return false;
  }
  const [receivedHash, expectedHash] = await Promise.all([sha256(received), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(receivedHash, expectedHash);
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

/** How long a Mini App launch stays valid. Limits replays of a leaked initData string. */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface MiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/**
 * Checks the initData Telegram hands a Mini App and returns the viewer, or null.
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret = HMAC_SHA256(key: "WebAppData", data: botToken)
 *   hash   = hex(HMAC_SHA256(key: secret, data: every other field as key=value, sorted, \n-joined))
 *
 * Only Telegram (and we) know the bot token, so a valid hash proves Telegram vouched
 * for this user. Too old an auth_date, or an unset bot token, never matches.
 */
export async function verifyInitData(
  initData: string,
  botToken: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MiniAppUser | null> {
  const params = new URLSearchParams(initData);
  const receivedHash = parseHex(params.get("hash") ?? "");
  if (!botToken || !receivedHash) {
    return null;
  }
  params.delete("hash");
  const dataCheckString = [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const expectedHash = await hmacSha256(secret, dataCheckString);
  if (receivedHash.byteLength !== expectedHash.byteLength || !crypto.subtle.timingSafeEqual(receivedHash, expectedHash)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    return null;
  }
  try {
    const user = JSON.parse(params.get("user") ?? "") as MiniAppUser;
    return Number.isInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

async function hmacSha256(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

function parseHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) {
    return null;
  }
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
}
