import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const PREDICTIONS_FILE = path.join(DATA_DIR, "slot-tournament-predictions.json");
const PREDICTIONS_KEY = "slot-tournaments:predictions";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function defaultStore() {
  return {
    open: false,
    updatedAt: null,
    predictions: [],
  };
}

function normalizePicks(rawPicks) {
  const picks = {};
  if (!rawPicks || typeof rawPicks !== "object" || Array.isArray(rawPicks)) {
    return picks;
  }

  for (const [matchId, winnerEntryId] of Object.entries(rawPicks)) {
    const key = String(matchId || "").trim();
    const winner = String(winnerEntryId || "").trim();
    if (!key || !winner) continue;
    picks[key] = winner;
  }

  return picks;
}

function normalizePrediction(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const kickUserId = String(raw.kickUserId || "").trim();
  if (!kickUserId) {
    return null;
  }

  return {
    kickUserId,
    username: String(raw.username || "viewer").trim() || "viewer",
    picks: normalizePicks(raw.picks),
    updatedAt: raw.updatedAt || null,
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultStore();
  }

  return {
    open: Boolean(raw.open),
    updatedAt: raw.updatedAt || null,
    predictions: (Array.isArray(raw.predictions) ? raw.predictions : [])
      .map(normalizePrediction)
      .filter(Boolean)
      .slice(0, 5000),
  };
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
    const result = await redisCommand(config, ["GET", PREDICTIONS_KEY]);
    if (result === null || result === undefined) {
      return defaultStore();
    }
    return normalizeStore(
      typeof result === "string" ? JSON.parse(result) : result
    );
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
      PREDICTIONS_KEY,
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
    await fs.access(PREDICTIONS_FILE);
  } catch {
    await fs.writeFile(
      PREDICTIONS_FILE,
      JSON.stringify(defaultStore(), null, 2)
    );
  }
  const raw = await fs.readFile(PREDICTIONS_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PREDICTIONS_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) return redisStore;
  if (process.env.VERCEL === "1") return defaultStore();
  return readFileStore();
}

async function writeStore(store) {
  const normalized = normalizeStore({
    ...store,
    updatedAt: new Date().toISOString(),
  });

  if (getRedisConfig()) {
    const saved = await writeRedisStore(normalized);
    if (!saved) {
      throw new Error("Could not save tournament predictions to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Tournament predictions need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(normalized);
  return normalized;
}

export async function getSlotTournamentPredictionsState() {
  return readStore();
}

export async function setSlotTournamentPredictionsOpen(open) {
  const current = await readStore();
  return writeStore({
    ...current,
    open: Boolean(open),
  });
}

export async function clearSlotTournamentPredictions() {
  const current = await readStore();
  return writeStore({
    ...current,
    open: false,
    predictions: [],
  });
}

export async function findSlotTournamentPrediction(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;
  const store = await readStore();
  return (
    store.predictions.find((entry) => entry.kickUserId === userId) || null
  );
}

export async function saveSlotTournamentPrediction({
  kickUserId,
  username,
  picks,
} = {}) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    throw new Error("Kick user id is required.");
  }

  const store = await readStore();
  if (!store.open) {
    throw new Error("Predictions are closed.");
  }

  const prediction = {
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    picks: normalizePicks(picks),
    updatedAt: new Date().toISOString(),
  };

  const index = store.predictions.findIndex(
    (entry) => entry.kickUserId === userId
  );
  if (index >= 0) {
    store.predictions[index] = prediction;
  } else {
    store.predictions.push(prediction);
  }

  const saved = await writeStore(store);
  return (
    saved.predictions.find((entry) => entry.kickUserId === userId) || prediction
  );
}

export function toPublicPrediction(prediction) {
  if (!prediction) return null;
  return {
    username: prediction.username,
    picks: prediction.picks || {},
    updatedAt: prediction.updatedAt || null,
  };
}
