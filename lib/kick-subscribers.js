import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "kick-subscribers.json");
const SUBSCRIBERS_KEY = "bj:kick-subscribers";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeStore(parsed) {
  return {
    subscribers:
      parsed?.subscribers && typeof parsed.subscribers === "object"
        ? parsed.subscribers
        : {},
  };
}

function pruneExpired(store) {
  const now = Date.now();
  let changed = false;

  for (const [userId, entry] of Object.entries(store.subscribers)) {
    const expiresAt = entry?.expiresAt ? new Date(entry.expiresAt).getTime() : 0;
    if (!expiresAt || expiresAt <= now) {
      delete store.subscribers[userId];
      changed = true;
    }
  }

  return changed;
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${SUBSCRIBERS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { subscribers: {} };
  }

  try {
    return normalizeStore(JSON.parse(data.result));
  } catch {
    return { subscribers: {} };
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${SUBSCRIBERS_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(SUBSCRIBERS_FILE);
  } catch {
    await fs.writeFile(
      SUBSCRIBERS_FILE,
      JSON.stringify({ subscribers: {} }, null, 2)
    );
  }

  const raw = await fs.readFile(SUBSCRIBERS_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.writeFile(SUBSCRIBERS_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { subscribers: {} };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save Kick subscribers to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Kick subscribers need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(store);
}

function resolveKickUserId(profile) {
  const id = profile?.user_id ?? profile?.id ?? profile?.userId;
  return id ? String(id) : "";
}

export function resolveSubscriptionExpiresAt(event) {
  if (event?.expires_at) {
    return new Date(event.expires_at).toISOString();
  }

  const months = Number(event?.duration);
  const expiresAt = new Date();
  if (Number.isFinite(months) && months > 0) {
    expiresAt.setMonth(expiresAt.getMonth() + months);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  return expiresAt.toISOString();
}

export async function upsertKickSubscriber({
  kickUserId,
  username,
  expiresAt,
  source = "subscription",
}) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    return null;
  }

  const store = await readStore();
  pruneExpired(store);

  const now = new Date().toISOString();
  const existing = store.subscribers[userId];
  const nextExpiresAt = expiresAt || existing?.expiresAt || now;

  store.subscribers[userId] = {
    kickUserId: userId,
    username: String(username || existing?.username || `user-${userId}`).trim(),
    expiresAt: nextExpiresAt,
    subscribedAt: existing?.subscribedAt || now,
    updatedAt: now,
    source,
  };

  await writeStore(store);
  return store.subscribers[userId];
}

export async function upsertKickSubscribersFromGift({ giftees, expiresAt }) {
  const recipients = Array.isArray(giftees) ? giftees : [];
  const saved = [];

  for (const giftee of recipients) {
    const kickUserId = resolveKickUserId(giftee);
    if (!kickUserId || giftee?.is_anonymous) {
      continue;
    }

    const entry = await upsertKickSubscriber({
      kickUserId,
      username: giftee.username || giftee.channel_slug,
      expiresAt,
      source: "gift",
    });

    if (entry) {
      saved.push(entry);
    }
  }

  return saved;
}

export async function isActiveKickSubscriber(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    return false;
  }

  const store = await readStore();
  const changed = pruneExpired(store);
  if (changed) {
    await writeStore(store);
  }

  const entry = store.subscribers[userId];
  if (!entry?.expiresAt) {
    return false;
  }

  return new Date(entry.expiresAt).getTime() > Date.now();
}
