import fs from "fs/promises";
import path from "path";
import { listGuessUserProfiles } from "./guesses.js";
import { listGiveawayUserProfiles } from "./giveaway-entries.js";
import { listSlotRequestUserProfiles } from "./slot-requests.js";

const DATA_DIR = path.resolve("data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USERS_KEY = "bj:users";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function resolveKickUserId(kickProfile) {
  const id = kickProfile?.user_id ?? kickProfile?.id ?? kickProfile?.userId;
  return id ? String(id) : "";
}

function buildUser(kickProfile, existing = null) {
  const kickUserId = resolveKickUserId(kickProfile);
  const now = new Date().toISOString();

  return {
    kickUserId,
    username: kickProfile.name || kickProfile.username || `user-${kickUserId}`,
    profilePicture: kickProfile.profile_picture || null,
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
    isNew: !existing,
  };
}

function toStoredUser(user) {
  return {
    kickUserId: user.kickUserId,
    username: user.username,
    profilePicture: user.profilePicture,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function normalizeStore(parsed) {
  return {
    users:
      parsed?.users && typeof parsed.users === "object" ? parsed.users : {},
  };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${USERS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { users: {} };
  }

  try {
    return normalizeStore(JSON.parse(data.result));
  } catch {
    return { users: {} };
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${USERS_KEY}/${payload}`, {
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
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }

  const raw = await fs.readFile(USERS_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.writeFile(USERS_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { users: {} };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save users to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Users need shared storage. Add Upstash Redis in Vercel.");
  }

  await writeFileStore(store);
}

export async function ensureUserRecord({
  kickUserId,
  username,
  profilePicture = null,
  seenAt = new Date().toISOString(),
} = {}) {
  const userId = String(kickUserId || "").trim();
  if (!userId || userId === "undefined") {
    return null;
  }

  const store = await readStore();
  const existing = store.users[userId];
  const nextUsername =
    String(username || existing?.username || `user-${userId}`).trim() ||
    `user-${userId}`;
  const user = {
    kickUserId: userId,
    username: nextUsername,
    profilePicture: profilePicture ?? existing?.profilePicture ?? null,
    createdAt: existing?.createdAt || seenAt,
    lastLoginAt:
      existing?.lastLoginAt &&
      new Date(existing.lastLoginAt) > new Date(seenAt)
        ? existing.lastLoginAt
        : seenAt,
    isNew: !existing,
  };

  store.users[userId] = toStoredUser(user);
  await writeStore(store);
  return user;
}

function mergeActivityProfile(store, profile) {
  const userId = String(profile.kickUserId || "").trim();
  if (!userId) {
    return false;
  }

  const existing = store.users[userId];
  const seenAt = profile.lastSeenAt || new Date().toISOString();
  const firstSeenAt = profile.firstSeenAt || seenAt;
  const next = {
    kickUserId: userId,
    username:
      String(profile.username || existing?.username || `user-${userId}`).trim() ||
      `user-${userId}`,
    profilePicture:
      profile.profilePicture ?? existing?.profilePicture ?? null,
    createdAt: existing?.createdAt || firstSeenAt,
    lastLoginAt:
      existing?.lastLoginAt &&
      new Date(existing.lastLoginAt) > new Date(seenAt)
        ? existing.lastLoginAt
        : seenAt,
  };

  const stored = toStoredUser(next);
  const unchanged =
    existing &&
    existing.username === stored.username &&
    existing.profilePicture === stored.profilePicture &&
    existing.createdAt === stored.createdAt &&
    existing.lastLoginAt === stored.lastLoginAt;

  if (unchanged) {
    return false;
  }

  store.users[userId] = stored;
  return true;
}

export async function syncUsersFromActivity() {
  const [guessProfiles, giveawayProfiles, slotProfiles] = await Promise.all([
    listGuessUserProfiles(),
    listGiveawayUserProfiles(),
    listSlotRequestUserProfiles(),
  ]);

  const store = await readStore();
  let changed = false;

  for (const profile of [
    ...guessProfiles,
    ...giveawayProfiles,
    ...slotProfiles,
  ]) {
    if (mergeActivityProfile(store, profile)) {
      changed = true;
    }
  }

  if (changed) {
    await writeStore(store);
  }
}

export async function upsertKickUser(kickProfile) {
  const kickUserId = resolveKickUserId(kickProfile);
  if (!kickUserId) {
    throw new Error("Kick profile is missing a user id.");
  }

  try {
    return await ensureUserRecord({
      kickUserId,
      username: kickProfile.name || kickProfile.username,
      profilePicture: kickProfile.profile_picture || null,
    });
  } catch (err) {
    console.error("Could not upsert Kick user:", err);
    return buildUser(kickProfile);
  }
}

export async function getUserByKickId(kickUserId) {
  try {
    const store = await readStore();
    return store.users[String(kickUserId)] || null;
  } catch {
    return null;
  }
}

export async function listUsers() {
  await syncUsersFromActivity();
  const store = await readStore();
  return Object.values(store.users).sort(
    (a, b) => new Date(b.lastLoginAt) - new Date(a.lastLoginAt)
  );
}
