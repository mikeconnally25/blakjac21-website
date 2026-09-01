import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const REQUESTS_FILE = path.join(DATA_DIR, "slot-requests.json");
const REQUESTS_KEY = "bh:slot-requests";

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

export async function getSlotRequestForUser(kickUserId) {
  const store = await readStore();
  const request = store.requests.find(
    (entry) => entry.kickUserId === String(kickUserId)
  );

  return request ? toPublicRequest(request) : null;
}

export async function saveSlotRequest({
  kickUserId,
  username,
  slotName,
  slotSlug,
  groupSlug,
  groupLabel,
  bet,
}) {
  const request = {
    id: crypto.randomUUID(),
    kickUserId: String(kickUserId),
    username,
    slotName,
    slotSlug,
    groupSlug,
    groupLabel,
    bet: bet === null || bet === undefined ? null : Number(bet),
    requestedAt: new Date().toISOString(),
  };

  const store = await readStore();
  const userId = String(kickUserId);
  const existingIndex = store.requests.findIndex(
    (entry) => entry.kickUserId === userId
  );

  if (existingIndex >= 0) {
    store.requests[existingIndex] = {
      ...store.requests[existingIndex],
      ...request,
      id: store.requests[existingIndex].id,
    };
  } else {
    store.requests.push(request);
  }

  await writeStore(store);

  const saved =
    existingIndex >= 0
      ? store.requests[existingIndex]
      : store.requests[store.requests.length - 1];

  return toPublicRequest(saved);
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
