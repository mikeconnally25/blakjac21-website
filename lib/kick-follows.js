import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STORE_FILE = path.join(DATA_DIR, "kick-follows.json");
const STORE_KEY = "kick:follows";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function emptyStore() {
  return { follows: {} };
}

function normalizeFollow(raw, kickUserId) {
  return {
    kickUserId: String(kickUserId || raw?.kickUserId || ""),
    username: String(raw?.username || "viewer").trim() || "viewer",
    followedAt: Number(raw?.followedAt) > 0 ? Number(raw.followedAt) : null,
  };
}

function normalizeStore(raw) {
  const follows = {};
  const source =
    raw?.follows && typeof raw.follows === "object" ? raw.follows : raw || {};
  for (const [id, entry] of Object.entries(source)) {
    if (!id || id === "follows") continue;
    const follow = normalizeFollow(entry, id);
    if (follow.followedAt) {
      follows[String(id)] = follow;
    }
  }
  return { follows };
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

export async function recordChannelFollow({ kickUserId, username, followedAt }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;

  const store = await readStore();
  const existing = store.follows[userId];
  const at =
    Number(followedAt) > 0
      ? Number(followedAt)
      : existing?.followedAt || Date.now();

  const next = {
    kickUserId: userId,
    username: String(username || existing?.username || "viewer").trim() || "viewer",
    followedAt: existing?.followedAt || at,
  };

  store.follows[userId] = next;
  await writeStore(store);
  return next;
}

export async function getFollow(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;
  const store = await readStore();
  return store.follows[userId] || null;
}

export async function findFollowByUsername(username) {
  const needle = String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  const store = await readStore();
  for (const entry of Object.values(store.follows)) {
    if (String(entry.username || "").toLowerCase() === needle) {
      return entry;
    }
  }
  return null;
}
