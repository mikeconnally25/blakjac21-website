import { botReply } from "./bot-replies.js";
import { sendKickChatMessage } from "./kick-chat.js";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "chat-promos-state.json");
const STATE_KEY = "kick:chat-promos:state";

export const CHAT_PROMOS = [
  {
    id: "chat",
    replyKey: "chatPromo",
    intervalMs: 10 * 60 * 1000,
  },
];

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
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
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
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

/** SET key NX EX — returns true only if this caller won the lock. */
async function redisSetNxEx(key, value, expireSeconds) {
  const config = getRedisConfig();
  if (!config) return false;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      "SET",
      key,
      String(value),
      "NX",
      "EX",
      Math.max(1, Math.floor(expireSeconds)),
    ]),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

function promoClaimKey(promoId) {
  return `${STATE_KEY}:claim:${promoId}`;
}

function normalizeState(raw) {
  const lastSentAt = {};
  if (raw && typeof raw === "object") {
    for (const promo of CHAT_PROMOS) {
      const value = Number(raw.lastSentAt?.[promo.id] ?? raw[promo.id]);
      if (Number.isFinite(value) && value > 0) {
        lastSentAt[promo.id] = value;
      }
    }
  }
  return { lastSentAt };
}

async function readState() {
  const fromRedis = await redisGet(STATE_KEY);
  if (fromRedis) {
    return normalizeState(fromRedis);
  }

  if (process.env.VERCEL === "1") {
    return normalizeState(null);
  }

  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState(null);
  }
}

async function writeState(state) {
  const next = normalizeState(state);
  const wrote = await redisSet(STATE_KEY, next);
  if (wrote) return next;

  if (process.env.VERCEL === "1") {
    return next;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

async function sendOnePromo(promo, state, { force = false, now = Date.now() } = {}) {
  const lastSentAt = Number(state.lastSentAt?.[promo.id]) || 0;
  if (!force && lastSentAt && now - lastSentAt < promo.intervalMs) {
    return {
      id: promo.id,
      sent: false,
      reason: "too-soon",
      nextInMs: promo.intervalMs - (now - lastSentAt),
    };
  }

  const message = String(await botReply(promo.replyKey)).trim();
  if (!message) {
    return { id: promo.id, sent: false, reason: "empty-message" };
  }

  // Claim the slot before sending so concurrent cron/webhook calls cannot double-post.
  if (!force) {
    const expireSeconds = Math.ceil(promo.intervalMs / 1000);
    if (getRedisConfig()) {
      const claimed = await redisSetNxEx(promoClaimKey(promo.id), now, expireSeconds);
      if (!claimed) {
        return {
          id: promo.id,
          sent: false,
          reason: "too-soon",
          nextInMs: promo.intervalMs,
        };
      }
    } else if (lastSentAt && now - lastSentAt < promo.intervalMs) {
      return {
        id: promo.id,
        sent: false,
        reason: "too-soon",
        nextInMs: promo.intervalMs - (now - lastSentAt),
      };
    }
  }

  // Persist cooldown immediately so even a slow Kick send cannot be overlapped.
  state.lastSentAt[promo.id] = now;
  await writeState(state);

  try {
    await sendKickChatMessage(message);
  } catch (error) {
    // Keep lastSentAt so a failed send does not spam retries every minute.
    throw error;
  }

  return {
    id: promo.id,
    sent: true,
    message,
    sentAt: now,
  };
}

/**
 * Sends any scheduled Kick chat promos that are due.
 * @param {{ force?: boolean, onlyId?: string }} [options]
 */
export async function maybeSendDueChatPromos({ force = false, onlyId = null } = {}) {
  const state = await readState();
  const now = Date.now();
  const results = [];

  for (const promo of CHAT_PROMOS) {
    if (onlyId && promo.id !== onlyId) continue;
    try {
      // sendOnePromo writes state when it claims/sends.
      results.push(await sendOnePromo(promo, state, { force, now }));
    } catch (error) {
      console.error(`Chat promo ${promo.id} failed:`, error.message);
      results.push({
        id: promo.id,
        sent: false,
        reason: "error",
        error: error.message || "send failed",
      });
    }
  }

  return {
    sent: results.filter((result) => result.sent).length,
    results,
  };
}

/** @deprecated use maybeSendDueChatPromos */
export async function maybeSendStakePromo(options = {}) {
  return maybeSendDueChatPromos({ ...options, onlyId: "chat" });
}

export function startLocalChatPromoScheduler() {
  if (process.env.VERCEL === "1") {
    return () => {};
  }

  const tick = () => {
    maybeSendDueChatPromos().catch((error) => {
      console.error("Chat promo scheduler failed:", error.message);
    });
  };

  // Check often; each promo enforces its own interval.
  const timer = setInterval(tick, 60 * 1000);
  // First run after one minute so the server can finish booting.
  const startup = setTimeout(tick, 60 * 1000);

  return () => {
    clearInterval(timer);
    clearTimeout(startup);
  };
}
