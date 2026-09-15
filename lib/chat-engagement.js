import fs from "fs/promises";
import path from "path";
import { isStreamLive } from "./stream-status.js";

const DATA_DIR = path.resolve("data");
const STORE_FILE = path.join(DATA_DIR, "chat-engagement.json");
const STORE_KEY = "kick:chat-engagement";
const MAX_CREDIT_MS = 5 * 60 * 1000;
const XP_PER_MINUTE = 1;
const XP_PER_LEVEL = 1000;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function emptyStore() {
  return { users: {} };
}

function normalizeUser(raw, kickUserId) {
  return {
    kickUserId: String(kickUserId || raw?.kickUserId || ""),
    username: String(raw?.username || "viewer").trim() || "viewer",
    watchMinutes: Math.max(0, Math.floor(Number(raw?.watchMinutes) || 0)),
    xp: Math.max(0, Math.floor(Number(raw?.xp) || 0)),
    lastChatAt: Number(raw?.lastChatAt) || 0,
    lastCreditAt: Number(raw?.lastCreditAt) || 0,
  };
}

function normalizeStore(raw) {
  const users = {};
  const source =
    raw?.users && typeof raw.users === "object" ? raw.users : raw || {};
  for (const [id, entry] of Object.entries(source)) {
    if (!id || id === "users") continue;
    users[String(id)] = normalizeUser(entry, id);
  }
  return { users };
}

async function redisGet(key) {
  const config = getRedisConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const raw = data.result;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  const config = getRedisConfig();
  if (!config) return false;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readStore() {
  const fromRedis = await redisGet(STORE_KEY);
  if (fromRedis) return normalizeStore(fromRedis);
  if (process.env.VERCEL === "1") return emptyStore();
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

async function writeStore(store) {
  const next = normalizeStore(store);
  const wrote = await redisSet(STORE_KEY, next);
  if (!wrote && process.env.VERCEL !== "1") {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(next, null, 2));
  }
  return next;
}

export function levelFromXp(xp) {
  const value = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.floor(value / XP_PER_LEVEL) + 1;
}

export function nextLevelXp(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return lvl * XP_PER_LEVEL;
}

export async function getEngagement(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return normalizeUser(null, "");
  const store = await readStore();
  return normalizeUser(store.users[userId], userId);
}

export async function findEngagementByUsername(username) {
  const needle = String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  const store = await readStore();
  for (const entry of Object.values(store.users)) {
    if (String(entry.username || "").toLowerCase() === needle) {
      return normalizeUser(entry, entry.kickUserId);
    }
  }
  return null;
}

/**
 * Credits watch minutes + XP for a chatter while the stream is live.
 * Caps credit between messages at 5 minutes.
 */
export async function creditChatEngagement({ kickUserId, username }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;

  const live = await isStreamLive();
  if (!live) return null;

  const store = await readStore();
  const now = Date.now();
  const existing = normalizeUser(store.users[userId], userId);
  const displayName =
    String(username || existing.username || "viewer").trim() || "viewer";

  let creditedMinutes = 0;
  if (existing.lastCreditAt > 0) {
    const elapsed = Math.min(MAX_CREDIT_MS, Math.max(0, now - existing.lastCreditAt));
    creditedMinutes = Math.floor(elapsed / 60_000);
  }

  const next = {
    ...existing,
    username: displayName,
    watchMinutes: existing.watchMinutes + creditedMinutes,
    xp: existing.xp + creditedMinutes * XP_PER_MINUTE,
    lastChatAt: now,
    lastCreditAt: now,
  };

  store.users[userId] = next;
  await writeStore(store);
  return next;
}

export function summarizeEngagement(entry) {
  const user = normalizeUser(entry, entry?.kickUserId);
  const level = levelFromXp(user.xp);
  const nextXp = nextLevelXp(level);
  return {
    ...user,
    level,
    nextLevelXp: nextXp,
    xpIntoLevel: user.xp % XP_PER_LEVEL,
    hasProgress: user.xp > 0 || user.watchMinutes > 0,
  };
}
