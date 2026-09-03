import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const CHAT_FILE = path.join(DATA_DIR, "site-chat.json");
const CHAT_KEY = "bj:site-chat";
const MAX_MESSAGES = 80;

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
      username: String(message.username || "User"),
      profilePicture: message.profilePicture || null,
      isAdmin: Boolean(message.isAdmin),
      text: String(message.text || ""),
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => message.id && message.text);
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
    return { messages: [] };
  }

  try {
    const parsed = JSON.parse(data.result);
    return { messages: normalizeMessages(parsed.messages) };
  } catch {
    return { messages: [] };
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
    await fs.writeFile(CHAT_FILE, JSON.stringify({ messages: [] }, null, 2));
  }

  const raw = await fs.readFile(CHAT_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { messages: normalizeMessages(parsed.messages) };
}

async function writeFileStore(store) {
  await fs.writeFile(CHAT_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { messages: [] };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save chat to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Chat needs shared storage. Add Upstash Redis in Vercel.");
  }

  await writeFileStore(store);
}

export async function listChatMessages() {
  const store = await readStore();
  return store.messages;
}

export async function addChatMessage({
  kickUserId,
  username,
  profilePicture,
  isAdmin,
  text,
}) {
  const message = {
    id: crypto.randomUUID(),
    kickUserId: String(kickUserId),
    username: String(username || "User").slice(0, 40),
    profilePicture: profilePicture || null,
    isAdmin: Boolean(isAdmin),
    text: String(text).trim().slice(0, 280),
    createdAt: new Date().toISOString(),
  };

  const store = await readStore();
  store.messages.push(message);
  if (store.messages.length > MAX_MESSAGES) {
    store.messages = store.messages.slice(-MAX_MESSAGES);
  }

  await writeStore(store);
  return message;
}

export async function removeChatMessage(id) {
  const messageId = String(id || "").trim();
  if (!messageId) {
    return false;
  }

  const store = await readStore();
  const next = store.messages.filter((message) => message.id !== messageId);
  if (next.length === store.messages.length) {
    return false;
  }

  store.messages = next;
  await writeStore(store);
  return true;
}

export async function getLastMessageAtForUser(kickUserId) {
  const userId = String(kickUserId || "");
  if (!userId) {
    return null;
  }

  const store = await readStore();
  for (let index = store.messages.length - 1; index >= 0; index -= 1) {
    if (store.messages[index].kickUserId === userId) {
      return store.messages[index].createdAt;
    }
  }

  return null;
}
