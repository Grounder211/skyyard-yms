import crypto from "crypto";

// RFC 6238 TOTP (the algorithm Google Authenticator / Authy / 1Password all
// use) implemented with just Node's built-in crypto — no otplib/speakeasy
// dependency needed. Base32 is RFC 4648 (no padding, uppercase).

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter % 2 ** 32, 4);

  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateToken(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP_SECONDS));
}

// Accepts the current 30s window plus one step on either side (±30s) to
// tolerate normal clock drift between the server and the user's phone.
export function verifyToken(secret: string, token: string, windowSteps = 1): boolean {
  return verifyTokenWithCounter(secret, token, windowSteps).valid;
}

// Same matching as verifyToken, but also returns which counter matched so
// a caller can persist it and reject that counter (or anything at or
// before it) on a later request — otherwise a code observed once stays
// valid for every login attempt within its ~90s acceptance window, not
// just the one legitimate use, which is what RFC 6238 §5.2 requires
// callers to prevent.
export function verifyTokenWithCounter(secret: string, token: string, windowSteps = 1): { valid: boolean; counter: number | null } {
  if (!/^\d{6}$/.test(token)) return { valid: false, counter: null };
  const nowCounter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let errorWindow = -windowSteps; errorWindow <= windowSteps; errorWindow++) {
    const counter = nowCounter + errorWindow;
    if (hotp(secret, counter) === token) return { valid: true, counter };
  }
  return { valid: false, counter: null };
}

export function otpauthUrl(secret: string, accountEmail: string, issuer = "SkyYard"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
