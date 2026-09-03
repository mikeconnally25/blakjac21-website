import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const REQUESTS_FILE = path.join(DATA_DIR, "slot-requests.json");
const REQUESTS_KEY = "bh:slot-requests";
export const SLOT_REQUEST_BET_MIN = 0.01;
export const SLOT_REQUEST_BET_MAX = 1000;
export const SLOT_REQUEST_MAX_PER_USER = 3;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function toPublicRequest(request) {
  return {
    id: request.id,
    username: request.username,
    slotName: request.slotName,
    slotSlug: request.slotSlug,
    groupSlug: request.groupSlug,
    groupLabel: request.groupLabel,
    provider: request.provider || null,
    thumbnailUrl: request.thumbnailUrl || null,
    bet:
      request.bet === null || request.bet === undefined
        ? null
        : Number(request.bet),
    requestedAt: request.requestedAt,
  };
}

function sortRequests(requests) {
  return [...requests].sort(
    (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)
  );
}

export function normalizeSlotRequestBet(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const bet = Number(String(raw).replace(/^\$/, "").trim());
  if (
    !Number.isFinite(bet) ||
    bet < SLOT_REQUEST_BET_MIN ||
    bet > SLOT_REQUEST_BET_MAX
  ) {
    return null;
  }

  return Number(bet.toFixed(2));
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${REQUESTS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { requests: [] };
  }

  try {
    const parsed = JSON.parse(data.result);
    return {
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  } catch {
    return { requests: [] };
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${REQUESTS_KEY}/${payload}`, {
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
    await fs.access(REQUESTS_FILE);
  } catch {
    await fs.writeFile(REQUESTS_FILE, JSON.stringify({ requests: [] }, null, 2));
  }

  const raw = await fs.readFile(REQUESTS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { requests: Array.isArray(parsed.requests) ? parsed.requests : [] };
}

async function writeFileStore(store) {
  await fs.writeFile(REQUESTS_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { requests: [] };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save slot requests to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Slot requests need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(store);
}

export async function listSlotRequests() {
  const store = await readStore();
  return sortRequests(store.requests).map(toPublicRequest);
}

export async function listSlotRequestUserProfiles() {
  const store = await readStore();
  const profiles = new Map();

  for (const request of store.requests) {
    const kickUserId = String(request.kickUserId || "").trim();
    if (!kickUserId) continue;

    const seenAt = request.requestedAt || new Date().toISOString();
    const existing = profiles.get(kickUserId);

    if (!existing) {
      profiles.set(kickUserId, {
        kickUserId,
        username: request.username,
        profilePicture: null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
      continue;
    }

    if (new Date(seenAt) > new Date(existing.lastSeenAt)) {
      existing.lastSeenAt = seenAt;
      existing.username = request.username || existing.username;
    }

    if (new Date(seenAt) < new Date(existing.firstSeenAt)) {
      existing.firstSeenAt = seenAt;
    }
  }

  return [...profiles.values()];
}

export async function getSlotRequestsForUser(kickUserId) {
  const store = await readStore();
  const userId = String(kickUserId);
  return sortRequests(
    store.requests.filter((entry) => entry.kickUserId === userId)
  ).map(toPublicRequest);
}

export async function getSlotRequestForUser(kickUserId) {
  const requests = await getSlotRequestsForUser(kickUserId);
  return requests[0] || null;
}

export async function saveSlotRequest({
  kickUserId,
  username,
  slotName,
  slotSlug,
  groupSlug,
  groupLabel,
  provider = null,
  thumbnailUrl = null,
}) {
  const store = await readStore();
  const userId = String(kickUserId);
  const normalizedSlug = String(slotSlug || "").trim().toLowerCase();
  const userRequests = store.requests.filter((entry) => entry.kickUserId === userId);
  const sameSlotIndex = store.requests.findIndex(
    (entry) =>
      entry.kickUserId === userId &&
      String(entry.slotSlug || "").trim().toLowerCase() === normalizedSlug
  );
  const now = new Date().toISOString();
  const normalizedProvider = provider ? String(provider) : null;
  const normalizedThumbnailUrl = thumbnailUrl ? String(thumbnailUrl) : null;

  if (sameSlotIndex >= 0) {
    store.requests[sameSlotIndex] = {
      ...store.requests[sameSlotIndex],
      username,
      slotName,
      slotSlug,
      groupSlug,
      groupLabel,
      provider: normalizedProvider,
      thumbnailUrl: normalizedThumbnailUrl,
      requestedAt: now,
    };
  } else {
    const takenByOther = store.requests.find(
      (entry) =>
        entry.kickUserId !== userId &&
        String(entry.slotSlug || "").trim().toLowerCase() === normalizedSlug
    );

    if (takenByOther) {
      const claimedBy = String(takenByOther.username || "").trim() || "another viewer";
      throw new Error(`sorry ${claimedBy} has already requested that`);
    }

    if (userRequests.length >= SLOT_REQUEST_MAX_PER_USER) {
      throw new Error(
        `You can only have up to ${SLOT_REQUEST_MAX_PER_USER} slot requests at a time.`
      );
    }

    store.requests.push({
      id: crypto.randomUUID(),
      kickUserId: userId,
      username,
      slotName,
      slotSlug,
      groupSlug,
      groupLabel,
      provider: normalizedProvider,
      thumbnailUrl: normalizedThumbnailUrl,
      bet: null,
      requestedAt: now,
    });
  }

  await writeStore(store);

  const saved =
    sameSlotIndex >= 0
      ? store.requests[sameSlotIndex]
      : store.requests[store.requests.length - 1];

  return toPublicRequest(saved);
}

export async function updateSlotRequestBet(id, bet) {
  const normalizedBet = normalizeSlotRequestBet(bet);
  if (normalizedBet === null) {
    throw new Error("Enter a bet between $0.01 and $1,000.00.");
  }

  const store = await readStore();
  const index = store.requests.findIndex((entry) => entry.id === id);

  if (index < 0) {
    throw new Error("Slot request not found.");
  }

  store.requests[index] = {
    ...store.requests[index],
    bet: normalizedBet,
  };

  await writeStore(store);
  return toPublicRequest(store.requests[index]);
}

export async function removeSlotRequest(id) {
  const store = await readStore();
  const nextRequests = store.requests.filter((entry) => entry.id !== id);

  if (nextRequests.length === store.requests.length) {
    throw new Error("Slot request not found.");
  }

  store.requests = nextRequests;
  await writeStore(store);
  return { ok: true };
}

export async function clearSlotRequests() {
  await writeStore({ requests: [] });
  return { ok: true };
}
