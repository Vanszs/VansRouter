import crypto from "node:crypto";

/**
 * Pure JS TOTP implementation (RFC 6238 / RFC 4226).
 * No external dependencies.
 */

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";

/**
 * Generate a random TOTP secret (base32-encoded).
 * @returns {string} Base32-encoded secret (20 bytes = 32 chars)
 */
export function generateTOTPSecret() {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

/**
 * Generate a TOTP code for a given secret and time.
 * @param {string} secret - Base32-encoded secret
 * @param {number} [timeStep] - Time step counter (default: current time)
 * @returns {string} 6-digit TOTP code
 */
export function generateTOTP(secret, timeStep = null) {
  if (timeStep === null) {
    timeStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  }

  const secretBytes = base32Decode(secret);

  // Convert time step to 8-byte big-endian buffer
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  timeBuffer.writeUInt32BE(timeStep & 0xFFFFFFFF, 4);

  // HMAC-SHA1
  const hmac = crypto.createHmac(TOTP_ALGORITHM, secretBytes);
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = code % Math.pow(10, TOTP_DIGITS);
  return String(otp).padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a TOTP code with time skew tolerance (±1 period).
 * @param {string} secret - Base32-encoded secret
 * @param {string} code - 6-digit code to verify
 * @param {number} [window=1] - Number of periods to check before/after current
 * @returns {boolean}
 */
export function verifyTOTP(secret, code, window = 1) {
  if (!secret || !code || typeof code !== "string") return false;
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD);

  for (let i = -window; i <= window; i++) {
    const expected = generateTOTP(secret, currentStep + i);
    if (timingSafeEqual(code, expected)) return true;
  }
  return false;
}

/**
 * Generate otpauth:// URI for QR code generation.
 * @param {string} secret - Base32-encoded secret
 * @param {string} [label="9Router"] - Account label
 * @param {string} [issuer="9Router"] - Issuer name
 * @returns {string} otpauth URI
 */
export function generateTOTPUri(secret, label = "9Router", issuer = "9Router") {
  const encodedLabel = encodeURIComponent(label);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedIssuer}:${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// ── Base32 encoding/decoding ──

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let result = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded) {
  const cleaned = encoded.toUpperCase().replace(/[=\s]/g, "");
  const lookup = {};
  for (let i = 0; i < BASE32_CHARS.length; i++) {
    lookup[BASE32_CHARS[i]] = i;
  }

  let bits = 0;
  let value = 0;
  const result = [];

  for (const char of cleaned) {
    const v = lookup[char];
    if (v === undefined) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(result);
}

/**
 * Constant-time string comparison.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}
