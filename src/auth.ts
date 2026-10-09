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
