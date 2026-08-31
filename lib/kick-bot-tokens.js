import fs from "fs/promises";
import path from "path";
import { refreshAccessToken } from "./kick-auth.js";

const DATA_DIR = path.resolve("data");
const TOKENS_FILE = path.join(DATA_DIR, "kick-bot-tokens.json");
const TOKENS_KEY = "bh:kick-bot-tokens";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeTokens(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const refreshToken = String(raw.refreshToken || "").trim();
  const accessToken = String(raw.accessToken || "").trim();
  const expiresAt = Number(raw.expiresAt || 0);
  const username = String(raw.username || "").trim();

  if (!refreshToken && !accessToken) {
    return null;
  }

  return {
    refreshToken,
    accessToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    username,
    updatedAt: raw.updatedAt || null,
  };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${TOKENS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return null;
  }

  try {
    return normalizeTokens(JSON.parse(data.result));
  } catch {
    return null;
  }
}

async function writeRedisStore(tokens) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(tokens));
  const response = await fetch(`${config.url}/set/${TOKENS_KEY}/${payload}`, {
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
    await fs.access(TOKENS_FILE);
  } catch {
    return null;
  }

  const raw = await fs.readFile(TOKENS_FILE, "utf8");
  return normalizeTokens(JSON.parse(raw));
}

async function writeFileStore(tokens) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return null;
  }

  return readFileStore();
}

async function writeStore(tokens) {
  const redisOk = await writeRedisStore(tokens);
  if (redisOk) {
    return true;
  }

  if (process.env.VERCEL === "1") {
    return false;
  }

  await writeFileStore(tokens);
  return true;
}

export async function saveKickBotTokens({ refreshToken, accessToken, expiresIn, username }) {
  const tokens = {
    refreshToken: String(refreshToken || "").trim(),
    accessToken: String(accessToken || "").trim(),
    expiresAt: Date.now() + Math.max(60, Number(expiresIn || 3600) - 60) * 1000,
    username: String(username || "").trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!tokens.refreshToken) {
    throw new Error("Kick did not return a refresh token.");
  }

  const saved = await writeStore(tokens);
  if (!saved) {
    throw new Error("Could not save Kick bot tokens. Check Redis configuration.");
  }

  return tokens;
}

export async function getKickBotTokenStatus() {
  if (process.env.KICK_BOT_ACCESS_TOKEN) {
    return {
      connected: true,
      source: "env",
      username: null,
    };
  }

  if (process.env.KICK_BOT_REFRESH_TOKEN) {
    return {
      connected: true,
      source: "env-refresh",
      username: null,
    };
  }

  const stored = await readStore();
  if (!stored?.refreshToken) {
    return {
      connected: false,
      source: "none",
      username: null,
    };
  }

  return {
    connected: true,
    source: "stored",
    username: stored.username || null,
    updatedAt: stored.updatedAt || null,
  };
}

export async function getKickBotAccessToken() {
  if (process.env.KICK_BOT_ACCESS_TOKEN) {
    return process.env.KICK_BOT_ACCESS_TOKEN;
  }

  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  const envRefreshToken = process.env.KICK_BOT_REFRESH_TOKEN;

  let stored = await readStore();
  const refreshToken = envRefreshToken || stored?.refreshToken;

  if (!refreshToken) {
    return null;
  }

  if (
    stored?.accessToken &&
    stored.refreshToken === refreshToken &&
    Date.now() < stored.expiresAt
  ) {
    return stored.accessToken;
  }

  if (!clientId || !clientSecret) {
    throw new Error("Kick client credentials are not configured.");
  }

  const data = await refreshAccessToken({
    refreshToken,
    clientId,
    clientSecret,
  });

  const tokens = {
    refreshToken: data.refresh_token || refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
    username: stored?.username || "",
    updatedAt: new Date().toISOString(),
  };

  if (!envRefreshToken) {
    await writeStore(tokens);
  }

  return tokens.accessToken;
}
