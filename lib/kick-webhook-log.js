const LOG_KEY = "bh:kick-webhook-log";
const MAX_ENTRIES = 20;

const memoryLog = [];

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

async function readRedisLog() {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.url}/get/${LOG_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (!data.result) {
    return [];
  }

  try {
    const parsed = JSON.parse(data.result);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRedisLog(entries) {
  const config = getRedisConfig();
  if (!config) {
    return false;
  }

  const payload = encodeURIComponent(JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  const response = await fetch(`${config.url}/set/${LOG_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const data = await response.json();
  return data.result === "OK";
}

export async function appendKickWebhookLog(entry) {
  const record = {
    at: new Date().toISOString(),
    ...entry,
  };

  const existing = (await readRedisLog()) || memoryLog.slice();
  existing.unshift(record);
  const next = existing.slice(0, MAX_ENTRIES);

  memoryLog.length = 0;
  memoryLog.push(...next);

  await writeRedisLog(next);
  return record;
}

export async function listKickWebhookLogs() {
  const redisLog = await readRedisLog();
  if (redisLog) {
    return redisLog;
  }

  return memoryLog.slice();
}
