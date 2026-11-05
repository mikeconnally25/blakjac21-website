import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { clearWinnerChatMessages } from "./giveaway-winner-chat.js";
import { pickRandomGiveawayEntry } from "./giveaway-entries.js";

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

function normalizeWinner(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const id = String(raw.id || "").trim();
  const username = String(raw.username || "").trim();
  if (!id || !username) {
    return null;
  }

  return {
    id,
    username,
    kickUserId: String(raw.kickUserId || "").trim() || null,
    revealedAt: raw.revealedAt || new Date().toISOString(),
  };
}

function normalizeBlockedKickUserIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of raw) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function defaultState() {
  return {
    open: false,
    keyword: "",
    affiliatesOnly: false,
    subscribersOnly: false,
    winner: null,
    blockedKickUserIds: [],
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultState();
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
    affiliatesOnly: Boolean(raw.affiliatesOnly),
    subscribersOnly: Boolean(raw.subscribersOnly),
    winner: normalizeWinner(raw.winner),
    blockedKickUserIds: normalizeBlockedKickUserIds(raw.blockedKickUserIds),
  };
}

function withCurrentFlags(current, overrides = {}) {
  return {
    open: Boolean(current.open),
    keyword: current.keyword || "",
    affiliatesOnly: Boolean(current.affiliatesOnly),
    subscribersOnly: Boolean(current.subscribersOnly),
    winner: current.winner,
    blockedKickUserIds: normalizeBlockedKickUserIds(current.blockedKickUserIds),
    ...overrides,
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
    return defaultState();
  }

  try {
    return normalizeState(JSON.parse(data.result));
  } catch {
    return defaultState();
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
    await fs.writeFile(STATE_FILE, JSON.stringify(defaultState(), null, 2));
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
    return defaultState();
  }

  return readFileState();
}

async function writeState(state) {
  const normalized = normalizeState(state);

  if (getRedisConfig()) {
    const saved = await writeRedisState(normalized);
    if (!saved) {
      throw new Error("Could not save giveaway state to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Giveaways need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileState(normalized);
}

export async function getGiveawayState() {
  return readState();
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

  const state = withCurrentFlags(current, {
    open: nextOpen,
    // Starting a new giveaway clears the winner and re-entry blocks.
    winner: nextOpen ? null : current.winner,
    blockedKickUserIds: nextOpen ? [] : current.blockedKickUserIds,
  });
  await writeState(state);
  return state;
}

export async function setGiveawayAffiliatesOnly(affiliatesOnly) {
  const current = await readState();
  const state = withCurrentFlags(current, {
    affiliatesOnly: Boolean(affiliatesOnly),
  });
  await writeState(state);
  return state;
}

export async function setGiveawaySubscribersOnly(subscribersOnly) {
  const current = await readState();
  const state = withCurrentFlags(current, {
    subscribersOnly: Boolean(subscribersOnly),
  });
  await writeState(state);
  return state;
}

export async function setGiveawayKeyword(keyword) {
  const current = await readState();
  const normalized = normalizeGiveawayKeyword(keyword);

  if (current.open && !normalized) {
    throw new Error("Cannot clear the keyword while the giveaway is open.");
  }

  const keywordChanged =
    String(current.keyword || "").toLowerCase() !==
    String(normalized || "").toLowerCase();

  const state = withCurrentFlags(current, {
    keyword: normalized,
    // New keyword starts a fresh cycle — previous winners can enter again.
    blockedKickUserIds: keywordChanged ? [] : current.blockedKickUserIds,
    winner: keywordChanged ? null : current.winner,
  });
  await writeState(state);
  return state;
}

export async function isGiveawayEntrantBlocked(kickUserId) {
  const id = String(kickUserId || "").trim();
  if (!id) return false;
  const state = await readState();
  return (state.blockedKickUserIds || []).includes(id);
}

export async function clearGiveawayWinnerBlocks() {
  const current = await readState();
  const state = withCurrentFlags(current, {
    blockedKickUserIds: [],
  });
  await writeState(state);
  return state;
}

export async function clearGiveawayWinner() {
  const current = await readState();
  const state = withCurrentFlags(current, {
    winner: null,
  });
  await writeState(state);
  await clearWinnerChatMessages();
  return state;
}

export async function setGiveawayWinner(entry) {
  if (!entry?.id || !entry?.username) {
    throw new Error("Winner entry is required.");
  }

  const current = await readState();
  const kickUserId = String(entry.kickUserId || "").trim() || null;
  const blocked = normalizeBlockedKickUserIds([
    ...(current.blockedKickUserIds || []),
    kickUserId,
  ]);

  const state = withCurrentFlags(current, {
    winner: {
      id: String(entry.id),
      username: String(entry.username),
      kickUserId,
      revealedAt: new Date().toISOString(),
    },
    blockedKickUserIds: blocked,
  });
  await writeState(state);
  await clearWinnerChatMessages();
  return state;
}

export async function revealGiveawayWinner() {
  const { removeGiveawayEntryByKickUserId } = await import(
    "./giveaway-entries.js"
  );
  const entry = await pickRandomGiveawayEntry();
  const state = await setGiveawayWinner(entry);
  const kickUserId = String(entry.kickUserId || "").trim();
  if (kickUserId) {
    await removeGiveawayEntryByKickUserId(kickUserId);
  }
  return state;
}
