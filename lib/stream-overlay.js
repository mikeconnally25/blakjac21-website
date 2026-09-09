import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.resolve("data");
const CONFIG_FILE = path.join(DATA_DIR, "stream-overlay.json");
const ALERTS_FILE = path.join(DATA_DIR, "stream-overlay-alerts.json");
const CONFIG_KEY = "overlay:config";
const ALERTS_KEY = "overlay:alerts";
const MAX_CLIPS = 24;
const MAX_ALERTS = 40;
const ALERT_TTL_MS = 90_000;

const DEFAULT_CONFIG = {
  brandName: "BLAKJAC21",
  tagline: "Slots · Blackjack · Big Wins",
  socials: {
    kick: "blakjac21",
    twitter: "",
    discord: "",
    youtube: "",
  },
  startingSoon: {
    headline: "STARTING SOON",
    subheadline: "Grab a seat — stream goes live shortly",
    goLiveAt: null,
    clipDurationSec: 14,
    clips: [],
  },
  brb: {
    headline: "BE RIGHT BACK",
    subheadline: "Don't go anywhere",
  },
  ending: {
    headline: "THANKS FOR WATCHING",
    subheadline: "Follow for the next session",
  },
  intermission: {
    headline: "INTERMISSION",
    subheadline: "Back in a few",
  },
  hud: {
    showLiveBadge: false,
    showSocials: false,
    tickerText: "Use code BLAKJAC21 on Stake",
    showCorners: true,
  },
  alerts: {
    enabled: true,
    durationMs: 6500,
    subMessage: "{user} just subscribed!",
    resubMessage: "{user} resubscribed!",
    giftMessage: "{user} gifted {count} subs!",
  },
};

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function trimString(value, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizeSocials(raw) {
  return {
    kick: trimString(raw?.kick, 64) || DEFAULT_CONFIG.socials.kick,
    twitter: trimString(raw?.twitter, 64),
    discord: trimString(raw?.discord, 160),
    youtube: trimString(raw?.youtube, 64),
  };
}

export function parseClipSource(url) {
  const raw = trimString(url, 500);
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathName = parsed.pathname || "";

  if (host === "youtu.be") {
    const id = pathName.replace(/^\//, "").split("/")[0];
    if (id) {
      return { type: "youtube", url: raw, videoId: id };
    }
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) {
      return { type: "youtube", url: raw, videoId: v };
    }
    const embedMatch = pathName.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i);
    if (embedMatch?.[1]) {
      return { type: "youtube", url: raw, videoId: embedMatch[1] };
    }
  }

  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(pathName) || host.includes("cdn")) {
    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(pathName + parsed.search)) {
      return { type: "video", url: raw, videoId: null };
    }
  }

  if (host === "kick.com" || host.endsWith(".kick.com")) {
    const clipParam =
      parsed.searchParams.get("clip") ||
      parsed.searchParams.get("clipSlug") ||
      null;
    const clipPath = pathName.match(/\/clips?\/([^/?#]+)/i);
    const clipId = clipParam || clipPath?.[1] || null;
    return { type: "kick", url: raw, videoId: clipId };
  }

  if (host === "streamable.com") {
    const id = pathName.replace(/^\//, "").split("/")[0];
    if (id) {
      return { type: "streamable", url: raw, videoId: id };
    }
  }

  return { type: "link", url: raw, videoId: null };
}

function normalizeClips(raw) {
  if (!Array.isArray(raw)) return [];

  const clips = [];
  for (const entry of raw.slice(0, MAX_CLIPS)) {
    if (!entry || typeof entry !== "object") continue;
    const parsed = parseClipSource(entry.url);
    if (!parsed) continue;

    clips.push({
      id: trimString(entry.id, 64) || crypto.randomUUID(),
      url: parsed.url,
      type: parsed.type,
      videoId: parsed.videoId,
      label: trimString(entry.label, 80),
      enabled: entry.enabled !== false,
    });
  }

  return clips;
}

function normalizeSceneCopy(raw, defaults) {
  return {
    headline: trimString(raw?.headline, 80) || defaults.headline,
    subheadline: trimString(raw?.subheadline, 160) || defaults.subheadline,
  };
}

function normalizeGoLiveAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeClipDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.startingSoon.clipDurationSec;
  return Math.min(60, Math.max(5, Math.round(n)));
}

function normalizeAlertDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.alerts.durationMs;
  return Math.min(20000, Math.max(2500, Math.round(n)));
}

export function normalizeOverlayConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_CONFIG);
  }

  return {
    brandName: trimString(raw.brandName, 40) || DEFAULT_CONFIG.brandName,
    tagline: trimString(raw.tagline, 120) || DEFAULT_CONFIG.tagline,
    socials: normalizeSocials(raw.socials),
    startingSoon: {
      ...normalizeSceneCopy(raw.startingSoon, DEFAULT_CONFIG.startingSoon),
      goLiveAt: normalizeGoLiveAt(raw.startingSoon?.goLiveAt),
      clipDurationSec: normalizeClipDuration(raw.startingSoon?.clipDurationSec),
      clips: normalizeClips(raw.startingSoon?.clips),
    },
    brb: normalizeSceneCopy(raw.brb, DEFAULT_CONFIG.brb),
    ending: normalizeSceneCopy(raw.ending, DEFAULT_CONFIG.ending),
    intermission: normalizeSceneCopy(raw.intermission, DEFAULT_CONFIG.intermission),
    hud: {
      showLiveBadge: raw.hud?.showLiveBadge === true,
      showSocials: raw.hud?.showSocials === true,
      tickerText: trimString(raw.hud?.tickerText, 160) || DEFAULT_CONFIG.hud.tickerText,
      showCorners: raw.hud?.showCorners !== false,
    },
    alerts: {
      enabled: raw.alerts?.enabled !== false,
      durationMs: normalizeAlertDuration(raw.alerts?.durationMs),
      subMessage:
        trimString(raw.alerts?.subMessage, 120) || DEFAULT_CONFIG.alerts.subMessage,
      resubMessage:
        trimString(raw.alerts?.resubMessage, 120) ||
        DEFAULT_CONFIG.alerts.resubMessage,
      giftMessage:
        trimString(raw.alerts?.giftMessage, 120) || DEFAULT_CONFIG.alerts.giftMessage,
    },
  };
}

async function redisGet(key) {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${key}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) return null;

  try {
    const raw = data.result;
    if (typeof raw !== "string") {
      return raw;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return JSON.parse(decodeURIComponent(raw));
    }
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = JSON.stringify(value);

  // Official Upstash REST form — path /set/key/value breaks on larger clip lists (414).
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", key, payload]),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("stream-overlay redisSet failed:", response.status, detail.slice(0, 200));
    return false;
  }

  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFileJson(filePath, value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

let memoryConfig = null;
let memoryConfigAt = 0;
let memoryAlerts = null;
let memoryAlertsAt = 0;
const MEMORY_TTL_MS = 2_000;

export async function getOverlayConfig() {
  if (memoryConfig && Date.now() - memoryConfigAt < MEMORY_TTL_MS) {
    return memoryConfig;
  }

  const fromRedis = await redisGet(CONFIG_KEY);
  if (fromRedis) {
    memoryConfig = normalizeOverlayConfig(fromRedis);
    memoryConfigAt = Date.now();
    return memoryConfig;
  }

  if (process.env.VERCEL === "1") {
    memoryConfig = normalizeOverlayConfig(DEFAULT_CONFIG);
    memoryConfigAt = Date.now();
    return memoryConfig;
  }

  const fromFile = await readFileJson(CONFIG_FILE);
  memoryConfig = normalizeOverlayConfig(fromFile || DEFAULT_CONFIG);
  memoryConfigAt = Date.now();
  return memoryConfig;
}

export async function saveOverlayConfig(raw) {
  const next = normalizeOverlayConfig(raw);
  const wroteRedis = await redisSet(CONFIG_KEY, next);
  if (!wroteRedis && process.env.VERCEL === "1") {
    throw new Error("Redis is required to save overlay config on Vercel.");
  }
  if (!wroteRedis) {
    await writeFileJson(CONFIG_FILE, next);
  }
  memoryConfig = next;
  memoryConfigAt = Date.now();
  return next;
}

function normalizeAlert(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = trimString(raw.id, 64);
  const type = trimString(raw.type, 32);
  const message = trimString(raw.message, 200);
  const createdAt = Number(raw.createdAt) || Date.now();
  if (!id || !type || !message) return null;
  return {
    id,
    type,
    message,
    username: trimString(raw.username, 64),
    count: Number.isFinite(Number(raw.count)) ? Number(raw.count) : null,
    createdAt,
    acked: Boolean(raw.acked),
  };
}

function pruneAlerts(list) {
  const cutoff = Date.now() - ALERT_TTL_MS;
  return list
    .map(normalizeAlert)
    .filter(Boolean)
    .filter((alert) => !alert.acked && alert.createdAt >= cutoff)
    .slice(-MAX_ALERTS);
}

async function readAlertsStore() {
  if (memoryAlerts && Date.now() - memoryAlertsAt < MEMORY_TTL_MS) {
    return memoryAlerts;
  }

  const fromRedis = await redisGet(ALERTS_KEY);
  if (Array.isArray(fromRedis)) {
    memoryAlerts = pruneAlerts(fromRedis);
    memoryAlertsAt = Date.now();
    return memoryAlerts;
  }

  if (process.env.VERCEL === "1") {
    memoryAlerts = [];
    memoryAlertsAt = Date.now();
    return memoryAlerts;
  }

  const fromFile = await readFileJson(ALERTS_FILE);
  memoryAlerts = pruneAlerts(Array.isArray(fromFile) ? fromFile : []);
  memoryAlertsAt = Date.now();
  return memoryAlerts;
}

async function writeAlertsStore(list) {
  const next = pruneAlerts(list);
  const wroteRedis = await redisSet(ALERTS_KEY, next);
  if (!wroteRedis && process.env.VERCEL !== "1") {
    await writeFileJson(ALERTS_FILE, next);
  }
  memoryAlerts = next;
  memoryAlertsAt = Date.now();
  return next;
}

function formatAlertMessage(template, { user, count }) {
  return String(template || "")
    .replaceAll("{user}", user || "Someone")
    .replaceAll("{count}", String(count ?? 1));
}

export async function enqueueOverlayAlert({
  type,
  username,
  count = null,
  message = null,
}) {
  const config = await getOverlayConfig();
  if (!config.alerts.enabled && type !== "test") {
    return null;
  }

  let resolvedMessage = message;
  if (!resolvedMessage) {
    if (type === "sub") {
      resolvedMessage = formatAlertMessage(config.alerts.subMessage, {
        user: username,
      });
    } else if (type === "resub") {
      resolvedMessage = formatAlertMessage(config.alerts.resubMessage, {
        user: username,
      });
    } else if (type === "gift") {
      resolvedMessage = formatAlertMessage(config.alerts.giftMessage, {
        user: username,
        count,
      });
    } else {
      resolvedMessage = `${username || "Someone"} triggered an alert`;
    }
  }

  const alert = {
    id: crypto.randomUUID(),
    type: trimString(type, 32) || "alert",
    message: trimString(resolvedMessage, 200),
    username: trimString(username, 64),
    count: count == null ? null : Number(count),
    createdAt: Date.now(),
    acked: false,
  };

  const list = await readAlertsStore();
  list.push(alert);
  await writeAlertsStore(list);
  return alert;
}

export async function listPendingOverlayAlerts() {
  return readAlertsStore();
}

export async function ackOverlayAlert(alertId) {
  const id = trimString(alertId, 64);
  if (!id) return false;

  const list = await readAlertsStore();
  let changed = false;
  const next = list.map((alert) => {
    if (alert.id !== id) return alert;
    changed = true;
    return { ...alert, acked: true };
  });

  if (!changed) return false;
  await writeAlertsStore(next);
  return true;
}

export function getDefaultOverlayConfig() {
  return structuredClone(DEFAULT_CONFIG);
}
