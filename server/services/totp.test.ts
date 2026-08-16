import { describe, it, expect } from "vitest";
import { generateToken, verifyToken, verifyTokenWithCounter, generateSecret } from "./totp.js";
import crypto from "crypto";

// RFC 4226 Appendix D official HOTP test vectors — this is the algorithm
// TOTP builds on. Secret is the ASCII string "12345678901234567890",
// base32-encoded before passing to our functions (they expect base32,
// matching what an authenticator app scans from an otpauth:// URI).
function base32Encode(buf: Buffer): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const rem = bits.length % 5;
  if (rem > 0) out += ALPHABET[parseInt(bits.slice(bits.length - rem).padEnd(5, "0"), 2)];
  return out;
}

describe("totp", () => {
  const rfc4226Secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const rfc4226Expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

  it("matches every RFC 4226 Appendix D test vector", () => {
    // generateToken is time-based (uses Date.now()), so to test against the
    // counter-based RFC vectors we compute the timestamp that maps to each
    // counter value at the library's fixed 30s step.
    for (let counter = 0; counter < rfc4226Expected.length; counter++) {
      const at = counter * 30 * 1000;
      expect(generateToken(rfc4226Secret, at)).toBe(rfc4226Expected[counter]);
    }
  });

  it("verifyToken accepts a token generated for the current time", () => {
    const secret = generateSecret();
    const token = generateToken(secret);
    expect(verifyToken(secret, token)).toBe(true);
  });

  it("verifyToken rejects a wrong 6-digit code", () => {
    const secret = generateSecret();
    const real = generateToken(secret);
    const wrong = real === "000000" ? "111111" : "000000";
    expect(verifyToken(secret, wrong)).toBe(false);
  });

  it("verifyToken rejects malformed input (not 6 digits)", () => {
    const secret = generateSecret();
    expect(verifyToken(secret, "12345")).toBe(false);
    expect(verifyToken(secret, "1234567")).toBe(false);
    expect(verifyToken(secret, "abcdef")).toBe(false);
    expect(verifyToken(secret, "")).toBe(false);
  });

  it("generateSecret produces a valid-length base32 string each time", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b); // must be random, not a fixed value
    expect(a).toMatch(/^[A-Z2-7]+$/);
  });

  it("verifyTokenWithCounter returns the matched counter on success", () => {
    const secret = generateSecret();
    const token = generateToken(secret);
    const nowCounter = Math.floor(Date.now() / 1000 / 30);
    const result = verifyTokenWithCounter(secret, token);
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(nowCounter);
  });

  it("verifyTokenWithCounter returns counter null on failure", () => {
    const secret = generateSecret();
    const real = generateToken(secret);
    const wrong = real === "000000" ? "111111" : "000000";
    const result = verifyTokenWithCounter(secret, wrong);
    expect(result.valid).toBe(false);
    expect(result.counter).toBeNull();
  });

  it("verifyTokenWithCounter identifies which step in the window matched", () => {
    const secret = generateSecret();
    const nowCounter = Math.floor(Date.now() / 1000 / 30);
    const previousStepToken = generateToken(secret, (nowCounter - 1) * 30 * 1000);
    const result = verifyTokenWithCounter(secret, previousStepToken);
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(nowCounter - 1);
  });
});
