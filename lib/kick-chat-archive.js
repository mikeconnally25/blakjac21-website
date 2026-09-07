import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const ARCHIVE_DIR = path.join(DATA_DIR, "kick-chat-archive");
const ARCHIVE_KEY_PREFIX = "kick:chat-archive:u:";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_USER = 250;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function archiveKey(kickUserId) {
  return `${ARCHIVE_KEY_PREFIX}${String(kickUserId).trim()}`;
}

function archiveFilePath(kickUserId) {
  const safeId = String(kickUserId || "unknown").replace(/[^\w.-]/g, "_");
  return path.join(ARCHIVE_DIR, `${safeId}.json`);
}

function pruneMessages(messages, nowMs = Date.now()) {
  const cutoff = nowMs - RETENTION_MS;
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      id: String(message.id || ""),
      kickUserId: String(message.kickUserId || ""),
      username: String(message.username || "viewer"),
      text: String(message.text || "").trim(),
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => {
      if (!message.id || !message.text) return false;
      const at = Date.parse(message.createdAt);
      return Number.isFinite(at) ? at >= cutoff : true;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-MAX_PER_USER);
}

async function readRedisMessages(kickUserId) {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(
    `${config.url}/get/${encodeURIComponent(archiveKey(kickUserId))}`,
    {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return [];
  }

  try {
    const parsed =
      typeof data.result === "string" ? JSON.parse(data.result) : data.result;
    return pruneMessages(parsed?.messages || parsed);
  } catch {
    return [];
  }
}

async function writeRedisMessages(kickUserId, messages) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify({ messages }));
  const ttlSeconds = Math.ceil(RETENTION_MS / 1000);
  const response = await fetch(
    `${config.url}/set/${encodeURIComponent(archiveKey(kickUserId))}/${payload}/EX/${ttlSeconds}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    }
  );

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileMessages(kickUserId) {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const filePath = archiveFilePath(kickUserId);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return pruneMessages(parsed?.messages || parsed);
  } catch {
    return [];
  }
}

async function writeFileMessages(kickUserId, messages) {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(
    archiveFilePath(kickUserId),
    JSON.stringify({ messages }, null, 2),
    "utf8"
  );
}

async function readUserMessages(kickUserId) {
  const redisMessages = await readRedisMessages(kickUserId);
  if (redisMessages) {
    return redisMessages;
  }

  if (process.env.VERCEL === "1") {
    return [];
  }

  return readFileMessages(kickUserId);
}

async function writeUserMessages(kickUserId, messages) {
  const pruned = pruneMessages(messages);

  if (getRedisConfig()) {
    const saved = await writeRedisMessages(kickUserId, pruned);
    if (!saved) {
      throw new Error("Could not save Kick chat archive to Redis.");
    }
    return pruned;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Kick chat archive needs shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileMessages(kickUserId, pruned);
  return pruned;
}

export async function appendKickChatArchiveMessage({
  kickUserId,
  username,
  text,
  createdAt,
  id,
}) {
  const userId = String(kickUserId || "").trim();
  const cleaned = String(text || "").trim();
  if (!userId || !cleaned) {
    return null;
  }

  const message = {
    id: String(id || crypto.randomUUID()),
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    text: cleaned.slice(0, 500),
    createdAt: createdAt || new Date().toISOString(),
  };

  const existing = await readUserMessages(userId);
  if (existing.some((entry) => entry.id === message.id)) {
    return message;
  }

  const next = pruneMessages([...existing, message]);
  await writeUserMessages(userId, next);
  return message;
}

export async function listKickChatArchiveForUser(
  kickUserId,
  { username = "", days = 7 } = {}
) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    return [];
  }

  const retentionMs = Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const messages = await readUserMessages(userId);
  const filtered = messages.filter((message) => {
    const at = Date.parse(message.createdAt);
    return Number.isFinite(at) ? at >= cutoff : true;
  });

  if (!username) {
    return filtered;
  }

  const targetName = String(username).trim().toLowerCase();
  return filtered.filter(
    (message) =>
      !targetName ||
      String(message.username || "")
        .trim()
        .toLowerCase() === targetName ||
      String(message.kickUserId || "").trim() === userId
  );
}
