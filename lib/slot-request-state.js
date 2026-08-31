import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slot-request-state.json");
const STATE_KEY = "bh:slot-requests-state";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return { accepting: false };
  }

  return {
    accepting: Boolean(raw.accepting),
  };
}

async function readRedisState() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${STATE_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { accepting: false };
  }

  try {
    return normalizeState(JSON.parse(data.result));
  } catch {
    return { accepting: false };
  }
}

async function writeRedisState(state) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(state));
  const response = await fetch(`${config.url}/set/${STATE_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFileState() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify({ accepting: false }, null, 2));
  }

  const raw = await fs.readFile(STATE_FILE, "utf8");
  return normalizeState(JSON.parse(raw));
}

async function writeFileState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function readState() {
  const redisState = await readRedisState();
  if (redisState) {
    return redisState;
  }

  if (process.env.VERCEL === "1") {
    return { accepting: false };
  }

  return readFileState();
}

async function writeState(state) {
  if (getRedisConfig()) {
    const saved = await writeRedisState(state);
    if (!saved) {
      throw new Error("Could not save slot request state to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Slot request state needs shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileState(state);
}

export async function getSlotRequestState() {
  return readState();
}

export async function areSlotRequestsOpen() {
  const state = await readState();
  return Boolean(state.accepting);
}

export async function setSlotRequestsOpen(accepting) {
  const state = { accepting: Boolean(accepting) };
  await writeState(state);
  return state;
}
