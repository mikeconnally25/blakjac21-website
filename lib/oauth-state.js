import { cleanEnv } from "./config.js";

const OAUTH_KEY_PREFIX = "bj:oauth:state:";
const OAUTH_TTL_SEC = 60 * 30;

function getRedisConfig() {
  const url =
    cleanEnv(process.env.UPSTASH_REDIS_REST_URL) ||
    cleanEnv(process.env.KV_REST_API_URL);
  const token =
    cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN) ||
    cleanEnv(process.env.KV_REST_API_TOKEN);
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function oauthKey(state) {
  return `${OAUTH_KEY_PREFIX}${String(state || "").trim()}`;
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
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.result;
}

/**
 * Persist OAuth PKCE state server-side so login survives www↔apex
 * redirects and browsers that drop the short-lived kick_oauth cookie.
 */
export async function saveOAuthStateRecord(state, data) {
  const id = String(state || "").trim();
  if (!id) return false;

  const config = getRedisConfig();
  if (!config) return false;

  const payload = {
    state: id,
    codeVerifier: String(data?.codeVerifier || ""),
    returnTo: data?.returnTo || "/",
    kind: data?.kind || "user",
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await redisCommand(config, [
      "SET",
      oauthKey(id),
      JSON.stringify(payload),
      "EX",
      OAUTH_TTL_SEC,
    ]);
    return result === "OK";
  } catch {
    return false;
  }
}

export async function loadOAuthStateRecord(state) {
  const id = String(state || "").trim();
  if (!id) return null;

  const config = getRedisConfig();
  if (!config) return null;

  try {
    const raw = await redisCommand(config, ["GET", oauthKey(id)]);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed?.codeVerifier || !parsed?.state) return null;
    return {
      state: String(parsed.state),
      codeVerifier: String(parsed.codeVerifier),
      returnTo: parsed.returnTo || "/",
      kind: parsed.kind || "user",
    };
  } catch {
    return null;
  }
}

export async function clearOAuthStateRecord(state) {
  const id = String(state || "").trim();
  if (!id) return;
  const config = getRedisConfig();
  if (!config) return;
  try {
    await redisCommand(config, ["DEL", oauthKey(id)]);
  } catch {
    /* ignore */
  }
}
