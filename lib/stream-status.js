import fs from "fs/promises";
import path from "path";
import { getKickChannelSlug } from "./kick-chat.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "stream-status.json");
const STATE_KEY = "kick:stream-status";
const CACHE_TTL_MS = 30_000;

let memoryState = null;
let memoryFetchedAt = 0;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function normalizeState(raw) {
  return {
    isLive: Boolean(raw?.isLive),
    startedAt: Number(raw?.startedAt) > 0 ? Number(raw.startedAt) : null,
    title: String(raw?.title || "").trim() || null,
    updatedAt: Number(raw?.updatedAt) || Date.now(),
  };
}

async function redisGet(key) {
  const config = getRedisConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const raw = data.result;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  const config = getRedisConfig();
  if (!config) return false;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readPersistedState() {
  const fromRedis = await redisGet(STATE_KEY);
  if (fromRedis) return normalizeState(fromRedis);
  if (process.env.VERCEL === "1") return null;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writePersistedState(state) {
  const next = normalizeState(state);
  memoryState = next;
  memoryFetchedAt = Date.now();
  await redisSet(STATE_KEY, next);
  if (process.env.VERCEL !== "1") {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2)).catch(() => {});
  }
  return next;
}

function parseStartMs(livestream) {
  if (!livestream || typeof livestream !== "object") return null;
  const candidates = [
    livestream.created_at,
    livestream.start_time,
    livestream.started_at,
    livestream.createdAt,
  ];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e12 ? value : value * 1000;
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function fetchChannelLivestream() {
  const slug = getKickChannelSlug();
  const url = new URL(`https://kick.com/api/v2/channels/${slug}`);
  url.searchParams.set("_ts", String(Date.now()));
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "BLAKJAC21-bot/1.0",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Kick channel fetch failed (${response.status}).`);
  }
  return response.json();
}

/**
 * Updates cached stream status from a livestream.status.updated webhook payload.
 */
export async function applyLivestreamStatusEvent(rawEvent) {
  const event =
    rawEvent?.data && typeof rawEvent.data === "object" ? rawEvent.data : rawEvent;
  if (!event || typeof event !== "object") {
    return getStreamStatus({ refresh: false });
  }

  const isLive = Boolean(
    event.is_live ??
      event.livestream?.id ??
      (String(event.status || "").toLowerCase() === "live")
  );
  const livestream = event.livestream || event;
  const startedAt = isLive ? parseStartMs(livestream) || Date.now() : null;
  const title =
    livestream?.session_title ||
    livestream?.title ||
    event?.title ||
    null;

  return writePersistedState({
    isLive,
    startedAt: isLive ? startedAt : null,
    title,
    updatedAt: Date.now(),
  });
}

/**
 * Returns whether the channel is live and when the stream started.
 * @param {{ refresh?: boolean }} [options]
 */
export async function getStreamStatus({ refresh = false } = {}) {
  if (
    !refresh &&
    memoryState &&
    Date.now() - memoryFetchedAt < CACHE_TTL_MS
  ) {
    return memoryState;
  }

  try {
    const channel = await fetchChannelLivestream();
    const livestream = channel?.livestream;
    const isLive = Boolean(livestream);
    const next = normalizeState({
      isLive,
      startedAt: isLive ? parseStartMs(livestream) || Date.now() : null,
      title: livestream?.session_title || null,
      updatedAt: Date.now(),
    });
    await writePersistedState(next);
    return next;
  } catch (error) {
    console.error("Stream status fetch failed:", error.message);
    const persisted = memoryState || (await readPersistedState());
    if (persisted) {
      memoryState = persisted;
      memoryFetchedAt = Date.now();
      return persisted;
    }
    return normalizeState({ isLive: false, startedAt: null, updatedAt: Date.now() });
  }
}

export async function isStreamLive() {
  const status = await getStreamStatus();
  return Boolean(status.isLive);
}
