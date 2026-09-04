import fs from "fs/promises";
import path from "path";
import { listGuessUserProfiles } from "./guesses.js";
import { listGiveawayUserProfiles } from "./giveaway-entries.js";
import { listSlotRequestUserProfiles } from "./slot-requests.js";
import { isStakeUsernameOnAffiliateCode } from "./leaderboard-handlers.js";
import { isActiveKickSubscriber } from "./kick-subscribers.js";
import { isIgnoredLoginIp, normalizeIp } from "./client-ip.js";

const DATA_DIR = path.resolve("data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USERS_KEY = "bj:users";
const MAX_LOGIN_HISTORY = 25;

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
    loginHistory: normalizeLoginHistory(existing?.loginHistory),
    isNew: !existing,
  };
}

function normalizeLoginHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ip: normalizeIp(entry.ip),
      at: entry.at || new Date().toISOString(),
      userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 240) : null,
      city: entry.city ? String(entry.city).slice(0, 80) : null,
      region: entry.region ? String(entry.region).slice(0, 80) : null,
      country: entry.country ? String(entry.country).slice(0, 80) : null,
    }))
    .filter((entry) => entry.ip)
    .slice(-MAX_LOGIN_HISTORY);
}

function appendLoginHistory(existingHistory, loginMeta = null) {
  const history = normalizeLoginHistory(existingHistory);
  const ip = normalizeIp(loginMeta?.ip);
  if (!ip || isIgnoredLoginIp(ip)) {
    return history;
  }

  const at = loginMeta?.at || new Date().toISOString();
  const userAgent = loginMeta?.userAgent
    ? String(loginMeta.userAgent).slice(0, 240)
    : null;
  const city = loginMeta?.city ? String(loginMeta.city).slice(0, 80) : null;
  const region = loginMeta?.region ? String(loginMeta.region).slice(0, 80) : null;
  const country = loginMeta?.country
    ? String(loginMeta.country).slice(0, 80)
    : null;
  const last = history[history.length - 1];

  if (
    last &&
    last.ip === ip &&
    Date.now() - Date.parse(last.at) < 60 * 60 * 1000
  ) {
    history[history.length - 1] = {
      ip,
      at,
      userAgent: userAgent || last.userAgent || null,
      city: city || last.city || null,
      region: region || last.region || null,
      country: country || last.country || null,
    };
    return history;
  }

  history.push({ ip, at, userAgent, city, region, country });
  return history.slice(-MAX_LOGIN_HISTORY);
}

function toStoredUser(user) {
  const loginHistory = normalizeLoginHistory(user.loginHistory);
  return {
    kickUserId: user.kickUserId,
    username: user.username,
    profilePicture: user.profilePicture,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    stakeUsername: user.stakeUsername ?? null,
    stakeLinkedAt: user.stakeLinkedAt ?? null,
    stakeCodeVerified: Boolean(user.stakeCodeVerified),
    stakeCodeVerifiedAt: user.stakeCodeVerifiedAt ?? null,
    loginHistory,
  };
}

export async function getLiveStakeCodeVerification(stakeUsername) {
  if (!stakeUsername) {
    return { stakeCodeVerified: false, stakeCodeVerifiedAt: null };
  }

  const verified = await isStakeUsernameOnAffiliateCode(stakeUsername);
  return {
    stakeCodeVerified: verified,
    stakeCodeVerifiedAt: verified ? new Date().toISOString() : null,
  };
}

export async function withKickSubscriberStatus(user) {
  const kickSubActive = await isActiveKickSubscriber(user?.kickUserId);
  return {
    ...user,
    kickSubActive,
  };
}

export async function withLiveUserBadges(user) {
  const withStake = await withLiveStakeCodeVerification(user);
  return withKickSubscriberStatus(withStake);
}

export async function withLiveStakeCodeVerification(user) {
  if (!user?.stakeUsername) {
    return {
      ...user,
      stakeCodeVerified: false,
      stakeCodeVerifiedAt: null,
    };
  }

  const verification = await getLiveStakeCodeVerification(user.stakeUsername);
  return {
    ...user,
    ...verification,
  };
}

export function normalizeStakeUsername(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }

  if (!/^[A-Za-z0-9_]{3,24}$/.test(value)) {
    return null;
  }

  return value;
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

  // Prefer command API so keys/values with special chars stay reliable.
  const commandResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["GET", USERS_KEY]),
    cache: "no-store",
  });

  if (commandResponse.ok) {
    const data = await commandResponse.json().catch(() => ({}));
    if (data.result === null || data.result === undefined) {
      return { users: {} };
    }
    try {
      return normalizeStore(
        typeof data.result === "string" ? JSON.parse(data.result) : data.result
      );
    } catch {
      return { users: {} };
    }
  }

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

  const value = JSON.stringify(store);

  // Official Upstash REST form for large/awkward values: POST command as JSON.
  // Path-based /set/key/value can fail with 414 once profile URLs are included.
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", USERS_KEY, value]),
    cache: "no-store",
  });

  const detail = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = detail ? JSON.parse(detail) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    console.error(
      "Redis user save failed:",
      response.status,
      detail.slice(0, 300)
    );
    const upstashError = String(parsed?.error || "");
    if (/max requests limit exceeded/i.test(upstashError)) {
      throw new Error(
        "Upstash Redis free-tier request limit reached (500k/month). Upgrade the database or wait for the quota reset, then try again."
      );
    }
    return false;
  }

  if (parsed?.result === "OK") {
    return true;
  }

  console.error("Redis user save unexpected response:", parsed || detail);
  return false;
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
      throw new Error(
        "Could not save users to Redis. Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel."
      );
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
  loginMeta = null,
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
  const loginHistory = appendLoginHistory(existing?.loginHistory, loginMeta);
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
    stakeUsername: existing?.stakeUsername ?? null,
    stakeLinkedAt: existing?.stakeLinkedAt ?? null,
    stakeCodeVerified: existing?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: existing?.stakeCodeVerifiedAt ?? null,
    loginHistory,
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
    stakeUsername: existing?.stakeUsername ?? null,
    stakeLinkedAt: existing?.stakeLinkedAt ?? null,
    stakeCodeVerified: existing?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: existing?.stakeCodeVerifiedAt ?? null,
    loginHistory: normalizeLoginHistory(existing?.loginHistory),
  };

  const stored = toStoredUser(next);
  const unchanged =
    existing &&
    existing.username === stored.username &&
    existing.profilePicture === stored.profilePicture &&
    existing.createdAt === stored.createdAt &&
    existing.lastLoginAt === stored.lastLoginAt &&
    existing.stakeUsername === stored.stakeUsername &&
    existing.stakeLinkedAt === stored.stakeLinkedAt &&
    existing.stakeCodeVerified === stored.stakeCodeVerified &&
    existing.stakeCodeVerifiedAt === stored.stakeCodeVerifiedAt &&
    JSON.stringify(normalizeLoginHistory(existing.loginHistory)) ===
      JSON.stringify(stored.loginHistory);

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

export async function upsertKickUser(kickProfile, loginMeta = null) {
  const kickUserId = resolveKickUserId(kickProfile);
  if (!kickUserId) {
    throw new Error("Kick profile is missing a user id.");
  }

  try {
    return await ensureUserRecord({
      kickUserId,
      username: kickProfile.name || kickProfile.username,
      profilePicture: kickProfile.profile_picture || null,
      loginMeta,
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

export async function linkStakeUsername(
  kickUserId,
  rawStakeUsername,
  profile = {}
) {
  const userId = String(kickUserId || "").trim();
  const stakeUsername = normalizeStakeUsername(rawStakeUsername);

  if (!userId) {
    throw new Error("User id is required.");
  }

  if (!stakeUsername) {
    throw new Error(
      "Enter a valid Stake username (3-24 letters, numbers, or underscores)."
    );
  }

  let store = await readStore();
  let existing = store.users[userId];

  if (!existing) {
    await ensureUserRecord({
      kickUserId: userId,
      username: profile.username,
      profilePicture: profile.profilePicture ?? null,
    });
    store = await readStore();
    existing = store.users[userId];
  }

  if (!existing) {
    throw new Error(
      "Could not save your account. Sign out, sign in with Kick again, then link Stake."
    );
  }

  const takenBy = Object.values(store.users).find(
    (user) =>
      user.kickUserId !== userId &&
      String(user.stakeUsername || "").toLowerCase() ===
        stakeUsername.toLowerCase()
  );

  if (takenBy) {
    throw new Error("That Stake username is already linked to another account.");
  }

  const linkedAt = new Date().toISOString();
  let stakeCodeVerified = false;
  try {
    stakeCodeVerified = await isStakeUsernameOnAffiliateCode(stakeUsername);
  } catch (err) {
    console.error("Stake code verification failed:", err);
  }

  const updated = toStoredUser({
    ...existing,
    stakeUsername,
    stakeLinkedAt: linkedAt,
    stakeCodeVerified,
    stakeCodeVerifiedAt: stakeCodeVerified ? linkedAt : null,
    loginHistory: normalizeLoginHistory(existing.loginHistory),
  });

  store.users[userId] = updated;
  await writeStore(store);

  return updated;
}

function getUserIps(user) {
  return [
    ...new Set(
      normalizeLoginHistory(user?.loginHistory)
        .map((entry) => entry.ip)
        .filter((ip) => !isIgnoredLoginIp(ip))
    ),
  ];
}

function formatStoredLoginLocation(entry) {
  if (!entry) {
    return null;
  }

  const parts = [entry.city, entry.region, entry.country].filter(Boolean);
  if (parts.length) {
    return parts.join(", ");
  }

  return entry.ip || null;
}

function buildPossibleAlts(users) {
  const ipOwners = new Map();

  for (const user of users) {
    for (const ip of getUserIps(user)) {
      if (!ipOwners.has(ip)) {
        ipOwners.set(ip, []);
      }
      ipOwners.get(ip).push(user);
    }
  }

  const byUser = new Map();

  for (const [ip, owners] of ipOwners.entries()) {
    if (owners.length < 2) {
      continue;
    }

    for (const user of owners) {
      if (!byUser.has(user.kickUserId)) {
        byUser.set(user.kickUserId, new Map());
      }

      const matches = byUser.get(user.kickUserId);
      for (const other of owners) {
        if (other.kickUserId === user.kickUserId) {
          continue;
        }

        const existing = matches.get(other.kickUserId) || {
          kickUserId: other.kickUserId,
          username: other.username,
          profilePicture: other.profilePicture || null,
          sharedIps: [],
        };
        if (!existing.sharedIps.includes(ip)) {
          existing.sharedIps.push(ip);
        }
        matches.set(other.kickUserId, existing);
      }
    }
  }

  return byUser;
}

function buildAltClusters(users, altsByUser) {
  const clusters = [];
  const seen = new Set();

  for (const user of users) {
    const matches = altsByUser.get(user.kickUserId);
    if (!matches?.size) {
      continue;
    }

    const memberIds = [user.kickUserId, ...matches.keys()].sort();
    const key = memberIds.join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const sharedIps = [
      ...new Set([...matches.values()].flatMap((match) => match.sharedIps)),
    ].sort();

    clusters.push({
      sharedIps,
      users: memberIds.map((id) => {
        const member = users.find((entry) => entry.kickUserId === id);
        return {
          kickUserId: id,
          username: member?.username || id,
          profilePicture: member?.profilePicture || null,
          lastLoginAt: member?.lastLoginAt || null,
        };
      }),
    });
  }

  return clusters.sort((a, b) => b.users.length - a.users.length);
}

export async function listUsers() {
  await syncUsersFromActivity();
  const store = await readStore();
  const users = Object.values(store.users)
    .map((user) => ({
      ...user,
      loginHistory: normalizeLoginHistory(user.loginHistory),
    }))
    .sort((a, b) => new Date(b.lastLoginAt) - new Date(a.lastLoginAt));

  const altsByUser = buildPossibleAlts(users);
  const withBadges = await Promise.all(
    users.map(async (user) => {
      const badges = await withLiveUserBadges(user);
      const loginHistory = normalizeLoginHistory(user.loginHistory);
      const possibleAlts = [...(altsByUser.get(user.kickUserId)?.values() || [])]
        .map((match) => ({
          ...match,
          sharedIps: [...match.sharedIps].sort(),
        }))
        .sort((a, b) => b.sharedIps.length - a.sharedIps.length || a.username.localeCompare(b.username));

      return {
        ...badges,
        loginHistory,
        lastLoginIp: loginHistory[loginHistory.length - 1]?.ip || null,
        lastLoginLocation: formatStoredLoginLocation(
          loginHistory[loginHistory.length - 1]
        ),
        registrationIp: loginHistory[0]?.ip || null,
        registrationLocation: formatStoredLoginLocation(loginHistory[0]),
        registrationAt: loginHistory[0]?.at || user.createdAt || null,
        possibleAlts,
      };
    })
  );

  return {
    users: withBadges,
    altClusters: buildAltClusters(users, altsByUser),
  };
}
