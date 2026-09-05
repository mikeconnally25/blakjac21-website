import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const ENTRIES_FILE = path.join(DATA_DIR, "giveaway-entries.json");
const ENTRIES_KEY = "giveaways:entries";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function toPublicEntry(entry) {
  return {
    id: entry.id,
    username: entry.username,
    enteredAt: entry.enteredAt,
  };
}

function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => new Date(a.enteredAt) - new Date(b.enteredAt)
  );
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${ENTRIES_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { entries: [] };
  }

  try {
    const parsed = JSON.parse(data.result);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${ENTRIES_KEY}/${payload}`, {
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
    await fs.access(ENTRIES_FILE);
  } catch {
    await fs.writeFile(ENTRIES_FILE, JSON.stringify({ entries: [] }, null, 2));
  }

  const raw = await fs.readFile(ENTRIES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

async function writeFileStore(store) {
  await fs.writeFile(ENTRIES_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { entries: [] };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save giveaway entries to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Giveaway entries need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(store);
}

export async function listGiveawayEntries() {
  const store = await readStore();
  return sortEntries(store.entries).map(toPublicEntry);
}

export async function listGiveawayUserProfiles() {
  const store = await readStore();
  const profiles = new Map();

  for (const entry of store.entries) {
    const kickUserId = String(entry.kickUserId || "").trim();
    if (!kickUserId) continue;

    const seenAt = entry.enteredAt || new Date().toISOString();
    const existing = profiles.get(kickUserId);

    if (!existing) {
      profiles.set(kickUserId, {
        kickUserId,
        username: entry.username,
        profilePicture: null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
      continue;
    }

    if (new Date(seenAt) > new Date(existing.lastSeenAt)) {
      existing.lastSeenAt = seenAt;
      existing.username = entry.username || existing.username;
    }

    if (new Date(seenAt) < new Date(existing.firstSeenAt)) {
      existing.firstSeenAt = seenAt;
    }
  }

  return [...profiles.values()];
}

export async function countGiveawayEntries() {
  const store = await readStore();
  return store.entries.length;
}

export async function addGiveawayEntry({ kickUserId, username }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    throw new Error("Kick user id is required.");
  }

  const store = await readStore();
  const existing = store.entries.find((entry) => entry.kickUserId === userId);

  if (existing) {
    return {
      alreadyEntered: true,
      entry: toPublicEntry(existing),
    };
  }

  const entry = {
    id: crypto.randomUUID(),
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    enteredAt: new Date().toISOString(),
  };

  store.entries.push(entry);
  await writeStore(store);

  return {
    alreadyEntered: false,
    entry: toPublicEntry(entry),
  };
}

export async function clearGiveawayEntries() {
  await writeStore({ entries: [] });
  return { cleared: true };
}

export async function pickRandomGiveawayEntry() {
  const store = await readStore();
  const entries = sortEntries(store.entries);
  if (!entries.length) {
    throw new Error("No eligible entrants to reveal.");
  }

  return entries[crypto.randomInt(0, entries.length)];
}
