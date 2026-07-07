import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import { createProviderConnection, getProviderConnectionById, getProviderConnections } from "../../../models/index.js";

const CHECKPOINT_DIR = path.join(DATA_DIR, "autoclaw-token-checkpoints");
const SECRET_FILE = path.join(DATA_DIR, "autoclaw-token-checkpoint-secret");
const TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function loadSecret() {
  try {
    const raw = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (raw) return Buffer.from(raw, "hex");
  } catch {}
  const secret = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

function checkpointPath(id) {
  ensureDir();
  return path.join(CHECKPOINT_DIR, `${id}.json`);
}

function encryptPayload(payload) {
  const key = loadSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptEnvelope(envelope) {
  const key = loadSecret();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function buildAutoclawCheckpointId({ jobId, email, line }) {
  return crypto.createHash("sha256").update(`${jobId || "manual"}:${email || "unknown"}:${line || "0"}`).digest("hex").slice(0, 24);
}

export function writeAutoclawTokenCheckpoint({ jobId, line, email, tokens }) {
  if (!tokens?.accessToken || !tokens?.refreshToken) return null;
  const id = buildAutoclawCheckpointId({ jobId, email, line });
  const payload = {
    jobId: jobId || null,
    line: line || null,
    email: email || null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    deviceId: tokens.deviceId || "",
    userId: tokens.userId || "",
    userName: tokens.userName || "",
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(checkpointPath(id), JSON.stringify(encryptPayload(payload), null, 2), { mode: 0o600 });
  return id;
}

export function readAutoclawTokenCheckpoint(filePath) {
  return decryptEnvelope(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function listCheckpointFiles() {
  try {
    ensureDir();
    return fs.readdirSync(CHECKPOINT_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(CHECKPOINT_DIR, name));
  } catch {
    return [];
  }
}

export function pruneExpiredAutoclawTokenCheckpoints(now = Date.now()) {
  for (const file of listCheckpointFiles()) {
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs > TTL_MS) fs.rmSync(file, { force: true });
    } catch {}
  }
}

async function findExistingAutoclawConnection(checkpoint) {
  const existing = await getProviderConnections({ provider: "autoclaw" });
  return existing.find((connection) => {
    if (connection.accessToken === checkpoint.accessToken) return true;
    if (checkpoint.userId && connection.email === String(checkpoint.userId)) return true;
    const deviceId = connection.providerSpecificData?.deviceId;
    if (checkpoint.deviceId && deviceId === checkpoint.deviceId) return true;
    return false;
  }) || null;
}

export async function recoverAutoclawTokenCheckpoints() {
  pruneExpiredAutoclawTokenCheckpoints();
  const recovered = [];
  for (const file of listCheckpointFiles()) {
    let checkpoint;
    try {
      checkpoint = readAutoclawTokenCheckpoint(file);
    } catch {
      continue;
    }
    if (!checkpoint?.accessToken || !checkpoint?.refreshToken) continue;

    const existing = await findExistingAutoclawConnection(checkpoint);
    if (existing) {
      recovered.push({ file, connectionId: existing.id, existed: true });
      fs.rmSync(file, { force: true });
      continue;
    }

    const connection = await createProviderConnection({
      provider: "autoclaw",
      authType: "access_token",
      name: checkpoint.userName || String(checkpoint.userId || checkpoint.email || "autoclaw-recovered"),
      email: String(checkpoint.userId || checkpoint.email || "unknown"),
      accessToken: checkpoint.accessToken,
      refreshToken: checkpoint.refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      testStatus: "active",
      lastRefreshAt: new Date().toISOString(),
      providerSpecificData: {
        deviceId: checkpoint.deviceId || "",
        userName: checkpoint.userName || "",
        refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        importedAt: checkpoint.createdAt || new Date().toISOString(),
        recoveredFromCheckpointAt: new Date().toISOString(),
        recoveredJobId: checkpoint.jobId || null,
      },
    });
    const saved = await getProviderConnectionById(connection.id);
    if (!saved) {
      recovered.push({ file, connectionId: connection.id, existed: false, verified: false });
      continue;
    }
    recovered.push({ file, connectionId: connection.id, existed: false, verified: true });
    fs.rmSync(file, { force: true });
  }
  return recovered;
}

export const __test__ = {
  encryptPayload,
  decryptEnvelope,
};
