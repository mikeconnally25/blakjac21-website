import crypto from "crypto";

const SYNC_KEY_PREFIX = "bh:stake-sync:";
const SYNC_COMPLETE_PREFIX = "bh:stake-sync-done:";
const SYNC_TTL_MS = 30 * 60 * 1000;

const memoryTokens = new Map();
const memoryCompletions = new Map();

function getSigningSecret() {
  return process.env.SESSION_SECRET || process.env.KICK_CLIENT_SECRET || "";
}

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

function signTokenParts(nonce, expiresAt) {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const payload = `${nonce}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

function parseSignedToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [nonce, expiresAtValue, signature] = parts;
  const expiresAt = Number(expiresAtValue);
  if (!nonce || !expiresAt) {
    return null;
  }

  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const payload = `${nonce}.${expiresAtValue}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const actual = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    actual.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actual, expectedBuffer)
  ) {
    return null;
  }

  if (expiresAt <= Date.now()) {
    return null;
  }

  return {
    token,
    nonce,
    createdAt: expiresAt - SYNC_TTL_MS,
    expiresAt,
    complete: false,
    count: 0,
    error: "",
  };
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
    nonce: record.nonce || "",
    createdAt,
    expiresAt,
    complete: Boolean(record.complete),
    count: Number(record.count) || 0,
    error: record.error || "",
  };
}

function completionKey(tokenRecord) {
  return tokenRecord.nonce || tokenRecord.token;
}

async function readRedisValue(key) {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.url}/get/${key}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.result || null;
}

async function writeRedisValue(key, value, ttlSeconds) {
  const config = getRedisConfig();
  if (!config) {
    return false;
  }

  const response = await fetch(`${config.url}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value,
      ex: ttlSeconds,
    }),
  });

  return response.ok;
}

async function readStoredToken(token) {
  const config = getRedisConfig();
  if (config) {
    const raw = await readRedisValue(`${SYNC_KEY_PREFIX}${token}`);
    if (!raw) {
      return null;
    }

    try {
      return normalizeRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  return normalizeRecord(memoryTokens.get(token));
}

async function readCompletion(tokenRecord) {
  const key = completionKey(tokenRecord);
  const config = getRedisConfig();

  if (config) {
    const raw = await readRedisValue(`${SYNC_COMPLETE_PREFIX}${key}`);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return memoryCompletions.get(key) || null;
}

async function readToken(token) {
  const stored = await readStoredToken(token);
  if (stored) {
    return stored;
  }

  const signed = parseSignedToken(token);
  if (!signed) {
    return null;
  }

  const completion = await readCompletion(signed);
  if (completion?.complete) {
    return {
      ...signed,
      complete: true,
      count: Number(completion.count) || 0,
      withThumbnails: Number(completion.withThumbnails) || 0,
      error: completion.error || "",
    };
  }

  return signed;
}

async function writeToken(record) {
  const config = getRedisConfig();
  const payload = JSON.stringify(record);

  if (config) {
    const ttlSeconds = Math.max(
      60,
      Math.ceil((record.expiresAt - Date.now()) / 1000)
    );

    await writeRedisValue(`${SYNC_KEY_PREFIX}${record.token}`, payload, ttlSeconds);
  } else {
    memoryTokens.set(record.token, record);
  }

  return record;
}

async function writeCompletion(tokenRecord, completion) {
  const key = completionKey(tokenRecord);
  const payload = JSON.stringify(completion);
  const config = getRedisConfig();

  if (config) {
    const ttlSeconds = Math.max(
      60,
      Math.ceil((tokenRecord.expiresAt - Date.now()) / 1000)
    );
    await writeRedisValue(`${SYNC_COMPLETE_PREFIX}${key}`, payload, ttlSeconds);
    return;
  }

  memoryCompletions.set(key, completion);
}

export async function createStakeSyncToken() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const createdAt = Date.now();
  const expiresAt = createdAt + SYNC_TTL_MS;
  const signedToken = signTokenParts(nonce, expiresAt);
  const token = signedToken || createTokenValue();
  const record = {
    token,
    nonce,
    createdAt,
    expiresAt,
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
    withThumbnails: Number(record.withThumbnails) || 0,
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

export async function completeStakeSyncToken(
  token,
  { count, withThumbnails = 0, error = "" } = {}
) {
  const record = await readToken(token);
  if (!record) {
    return null;
  }

  const completion = {
    complete: true,
    count: Number(count) || 0,
    withThumbnails: Number(withThumbnails) || 0,
    error: String(error || ""),
  };

  const next = {
    ...record,
    ...completion,
  };

  await writeToken(next);
  await writeCompletion(record, completion);
  return next;
}
