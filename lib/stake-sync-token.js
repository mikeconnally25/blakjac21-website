import crypto from "crypto";

const SYNC_KEY_PREFIX = "bh:stake-sync:";
const SYNC_TTL_MS = 15 * 60 * 1000;

const memoryTokens = new Map();

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function createTokenValue() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeRecord(record) {
  if (!record?.token) {
    return null;
  }

  const createdAt = Number(record.createdAt) || Date.now();
  const expiresAt = Number(record.expiresAt) || createdAt + SYNC_TTL_MS;

  if (expiresAt <= Date.now()) {
    return null;
  }

  return {
    token: record.token,
    createdAt,
    expiresAt,
    complete: Boolean(record.complete),
    count: Number(record.count) || 0,
    error: record.error || "",
  };
}

async function readToken(token) {
  const config = getRedisConfig();
  if (config) {
    const response = await fetch(`${config.url}/get/${SYNC_KEY_PREFIX}${token}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.result) {
      return null;
    }

    try {
      return normalizeRecord(JSON.parse(data.result));
    } catch {
      return null;
    }
  }

  return normalizeRecord(memoryTokens.get(token));
}

async function writeToken(record) {
  const config = getRedisConfig();
  const payload = JSON.stringify(record);

  if (config) {
    const ttlSeconds = Math.max(
      60,
      Math.ceil((record.expiresAt - Date.now()) / 1000)
    );

    await fetch(`${config.url}/set/${SYNC_KEY_PREFIX}${record.token}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: payload,
        ex: ttlSeconds,
      }),
    });
  } else {
    memoryTokens.set(record.token, record);
  }

  return record;
}

export async function createStakeSyncToken() {
  const token = createTokenValue();
  const createdAt = Date.now();
  const record = {
    token,
    createdAt,
    expiresAt: createdAt + SYNC_TTL_MS,
    complete: false,
    count: 0,
    error: "",
  };

  await writeToken(record);
  return record;
}

export async function getStakeSyncStatus(token) {
  const record = await readToken(token);
  if (!record) {
    return { valid: false, complete: false, count: 0 };
  }

  return {
    valid: true,
    complete: record.complete,
    count: record.count,
    error: record.error || "",
    expiresAt: record.expiresAt,
  };
}

export async function consumeStakeSyncToken(token) {
  const record = await readToken(token);
  if (!record) {
    throw new Error("Sync token is invalid or expired. Start sync again from bonus-hunt.");
  }

  if (record.complete) {
    throw new Error("This sync token was already used. Start sync again from bonus-hunt.");
  }

  return record;
}

export async function completeStakeSyncToken(token, { count, error = "" } = {}) {
  const record = await readToken(token);
  if (!record) {
    return null;
  }

  const next = {
    ...record,
    complete: true,
    count: Number(count) || 0,
    error: String(error || ""),
  };

  await writeToken(next);
  return next;
}
