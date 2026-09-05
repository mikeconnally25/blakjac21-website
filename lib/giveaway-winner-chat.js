import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const CHAT_FILE = path.join(DATA_DIR, "giveaway-winner-chat.json");
const CHAT_KEY = "giveaways:winner-chat";
const MAX_MESSAGES = 40;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      id: String(message.id || ""),
      kickUserId: String(message.kickUserId || ""),
      username: String(message.username || "viewer"),
      text: String(message.text || "").trim(),
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => message.id && message.text)
    .slice(-MAX_MESSAGES);
}

function defaultStore() {
  return { messages: [] };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultStore();
  }
  return { messages: normalizeMessages(raw.messages) };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${CHAT_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return defaultStore();
  }

  try {
    return normalizeStore(JSON.parse(data.result));
  } catch {
    return defaultStore();
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${CHAT_KEY}/${payload}`, {
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
    await fs.access(CHAT_FILE);
  } catch {
    await fs.writeFile(CHAT_FILE, JSON.stringify(defaultStore(), null, 2));
  }

  const raw = await fs.readFile(CHAT_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CHAT_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return defaultStore();
  }

  return readFileStore();
}

async function writeStore(store) {
  const normalized = normalizeStore(store);

  if (getRedisConfig()) {
    const saved = await writeRedisStore(normalized);
    if (!saved) {
      throw new Error("Could not save winner chat messages to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Winner chat needs shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(normalized);
  return normalized;
}

export async function listWinnerChatMessages() {
  const store = await readStore();
  return store.messages;
}

export async function clearWinnerChatMessages() {
  await writeStore(defaultStore());
  return [];
}

export async function appendWinnerChatMessage({
  kickUserId,
  username,
  text,
}) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    return null;
  }

  const store = await readStore();
  const message = {
    id: crypto.randomUUID(),
    kickUserId: String(kickUserId || ""),
    username: String(username || "viewer").trim() || "viewer",
    text: cleaned.slice(0, 500),
    createdAt: new Date().toISOString(),
  };

  store.messages = [...store.messages, message].slice(-MAX_MESSAGES);
  await writeStore(store);
  return message;
}

export function messageMatchesWinner(winner, { kickUserId, username } = {}) {
  if (!winner) return false;

  const winnerKickId = String(winner.kickUserId || "").trim();
  const senderKickId = String(kickUserId || "").trim();
  if (winnerKickId && senderKickId) {
    return winnerKickId === senderKickId;
  }

  const winnerName = String(winner.username || "").trim().toLowerCase();
  const senderName = String(username || "").trim().toLowerCase();
  return Boolean(winnerName && senderName && winnerName === senderName);
}
