import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const ENTRIES_FILE = path.join(DATA_DIR, "slot-tournament-entries.json");
const ENTRIES_KEY = "slot-tournaments:entries";

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

function toAdminEntry(entry) {
  return {
    id: entry.id,
    kickUserId: entry.kickUserId,
    username: entry.username,
    enteredAt: entry.enteredAt,
  };
}

function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => new Date(a.enteredAt) - new Date(b.enteredAt)
  );
}

async function redisCommand(config, command) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Redis command failed.");
  }
  return data.result;
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const result = await redisCommand(config, ["GET", ENTRIES_KEY]);
    if (result === null || result === undefined) {
      return { entries: [] };
    }
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    };
  } catch {
    return null;
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  try {
    const result = await redisCommand(config, [
      "SET",
      ENTRIES_KEY,
      JSON.stringify(store),
    ]);
    return result === "OK";
  } catch {
    return false;
  }
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
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ENTRIES_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) return redisStore;
  if (process.env.VERCEL === "1") return { entries: [] };
  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save tournament entries to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Tournament entries need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(store);
}

export async function listSlotTournamentEntries({ includePrivate = false } = {}) {
  const store = await readStore();
  const sorted = sortEntries(store.entries);
  return sorted.map(includePrivate ? toAdminEntry : toPublicEntry);
}

export async function countSlotTournamentEntries() {
  const store = await readStore();
  return store.entries.length;
}

export async function addSlotTournamentEntry({ kickUserId, username }) {
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

export async function clearSlotTournamentEntries() {
  await writeStore({ entries: [] });
  return { cleared: true };
}

export async function findSlotTournamentEntryById(id) {
  const entryId = String(id || "").trim();
  if (!entryId) return null;
  const store = await readStore();
  return store.entries.find((entry) => entry.id === entryId) || null;
}
