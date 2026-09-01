import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "giveaway-state.json");
const STATE_KEY = "giveaways:state";
const KEYWORD_MAX_LENGTH = 64;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

export function normalizeGiveawayKeyword(raw) {
  const keyword = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!keyword) {
    return "";
  }

  if (keyword.length > KEYWORD_MAX_LENGTH) {
    throw new Error(`Keyword must be ${KEYWORD_MAX_LENGTH} characters or fewer.`);
  }

  return keyword;
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return { open: false, keyword: "" };
  }

  let keyword = "";
  try {
    keyword = normalizeGiveawayKeyword(raw.keyword);
  } catch {
    keyword = "";
  }

  return {
    open: Boolean(raw.open),
    keyword,
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
    return { open: false, keyword: "" };
  }

  try {
    return normalizeState(JSON.parse(data.result));
  } catch {
    return { open: false, keyword: "" };
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
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({ open: false, keyword: "" }, null, 2)
    );
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
    return { open: false, keyword: "" };
  }

  return readFileState();
}

async function writeState(state) {
  if (getRedisConfig()) {
    const saved = await writeRedisState(state);
    if (!saved) {
      throw new Error("Could not save giveaway state to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Giveaway state needs shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileState(state);
}

export async function getGiveawayState() {
  return readState();
}

export async function areGiveawaysOpen() {
  const state = await readState();
  return Boolean(state.open);
}

export async function getGiveawayKeyword() {
  const state = await readState();
  return state.keyword || "";
}

export async function setGiveawaysOpen(open) {
  const current = await readState();
  const nextOpen = Boolean(open);

  if (nextOpen && !current.keyword) {
    throw new Error("Set a keyword before opening the giveaway.");
  }

  const state = {
    open: nextOpen,
    keyword: current.keyword || "",
  };
  await writeState(state);
  return state;
}

export async function setGiveawayKeyword(keyword) {
  const current = await readState();
  const normalized = normalizeGiveawayKeyword(keyword);

  if (current.open && !normalized) {
    throw new Error("Cannot clear the keyword while the giveaway is open.");
  }

  const state = {
    open: Boolean(current.open),
    keyword: normalized,
  };
  await writeState(state);
  return state;
}
