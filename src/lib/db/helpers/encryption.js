import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = "9router-encryption-salt-v1";
const ENCRYPTED_PREFIX = "$ENC$";

/**
 * Derive a stable machine-specific encryption key.
 * Uses machine-id file (Linux/macOS) or os.hostname + os.cpus as fallback.
 */
function getMachineIdentifier() {
  // Try environment override first
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;

  // Try machine-id on Linux
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      return fs.readFileSync(p, "utf8").trim();
    } catch {}
  }

  // macOS: IOPlatformUUID
  try {
    const uuid = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID", { encoding: "utf8" });
    const match = uuid.match(/"([A-F0-9-]+)"/);
    if (match) return match[1];
  } catch {}

  // Windows: use ComputerName + ProcessorId as stable identifier
  const fallback = `${os.hostname()}-${os.cpus()[0]?.model || "unknown"}-${os.arch()}`;
  return fallback;
}

let _derivedKey = null;

/**
 * Derive AES-256 key from machine identifier + salt using PBKDF2.
 */
function deriveKey() {
  if (_derivedKey) return _derivedKey;
  const machineId = getMachineIdentifier();
  _derivedKey = crypto.pbkdf2Sync(machineId, SALT, 100000, 32, "sha256");
  return _derivedKey;
}

/**
 * Encrypt plaintext string using AES-256-GCM.
 * Returns: $ENC$<base64(iv + authTag + ciphertext)>
 */
export function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== "string") return plaintext;
  // Already encrypted — return as-is
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTED_PREFIX + packed.toString("base64");
}

/**
 * Decrypt string encrypted by encrypt().
 * If the input is not encrypted (no $ENC$ prefix), returns as-is (backward compat).
 */
export function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== "string") return ciphertext;
  // Not encrypted — return plaintext as-is (backward compatibility)
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext;

  const key = deriveKey();
  const packed = Buffer.from(ciphertext.slice(ENCRYPTED_PREFIX.length), "base64");

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Check if a string is already encrypted.
 */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt the data JSON column of a provider connection.
 * Encrypts sensitive fields within the parsed JSON.
 */
export function encryptConnectionData(dataJson) {
  return encrypt(dataJson);
}

/**
 * Decrypt the data JSON column of a provider connection.
 */
export function decryptConnectionData(dataJson) {
  return decrypt(dataJson);
}
