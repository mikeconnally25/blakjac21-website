import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fetchAffiliateRoster } from "./leaderboard-handlers.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "weekly-raffle-state.json");
const STATE_KEY = "weekly-raffle:state";
export const TICKETS_PER_DOLLARS = 50;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeWinner(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stakeUsername = String(raw.stakeUsername || "").trim();
  if (!stakeUsername) return null;

  return {
    id: String(raw.id || crypto.randomUUID()),
    stakeUsername,
    kickUsername: String(raw.kickUsername || "").trim() || null,
    kickUserId: String(raw.kickUserId || "").trim() || null,
    tickets: Math.max(0, Math.floor(Number(raw.tickets) || 0)),
    wagered: Math.max(0, Number(raw.wagered) || 0),
    revealedAt: raw.revealedAt || new Date().toISOString(),
  };
}

function defaultState() {
  return {
    winner: null,
    history: [],
  };
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;

  const history = Array.isArray(raw.history)
    ? raw.history.map(normalizeWinner).filter(Boolean).slice(0, 20)
    : [];

  return {
    winner: normalizeWinner(raw.winner),
    history,
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

  const data = await response.json();
  if (data.result === null || data.result === undefined) return null;

  try {
    const raw = data.result;
    if (typeof raw !== "string") return raw;
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

async function readFileState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

async function writeFileState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

let memoryState = null;
let memoryStateAt = 0;
const MEMORY_TTL_MS = 2000;

export function wageredToTickets(wagered) {
  const amount = Number(wagered) || 0;
  if (!Number.isFinite(amount) || amount < TICKETS_PER_DOLLARS) return 0;
  return Math.floor(amount / TICKETS_PER_DOLLARS);
}

export async function getWeeklyRaffleState() {
  if (memoryState && Date.now() - memoryStateAt < MEMORY_TTL_MS) {
    return memoryState;
  }

  const fromRedis = await redisGet(STATE_KEY);
  if (fromRedis) {
    memoryState = normalizeState(fromRedis);
    memoryStateAt = Date.now();
    return memoryState;
  }

  if (process.env.VERCEL === "1") {
    memoryState = defaultState();
    memoryStateAt = Date.now();
    return memoryState;
  }

  memoryState = await readFileState();
  memoryStateAt = Date.now();
  return memoryState;
}

async function writeWeeklyRaffleState(next) {
  const state = normalizeState(next);
  const wrote = await redisSet(STATE_KEY, state);
  if (!wrote && process.env.VERCEL === "1") {
    throw new Error("Redis is required to save raffle state on Vercel.");
  }
  if (!wrote) {
    await writeFileState(state);
  }
  memoryState = state;
  memoryStateAt = Date.now();
  return state;
}

async function buildKickLinksByStake() {
  const { getKickLinksByStakeUsername } = await import("./users.js");
  return getKickLinksByStakeUsername();
}

export async function buildWeeklyRaffleEntries() {
  const roster = await fetchAffiliateRoster();
  const byStake = await buildKickLinksByStake();

  const entries = (roster.entries || [])
    .map((entry) => {
      const stakeUsername = String(entry.username || "").trim();
      if (!stakeUsername) return null;
      const wagered = Math.max(0, Number(entry.wagered) || 0);
      const tickets = wageredToTickets(wagered);
      const linked = byStake.get(stakeUsername.toLowerCase()) || null;

      return {
        id: `sheet:${stakeUsername.toLowerCase()}`,
        stakeUsername,
        kickUsername: linked?.kickUsername || null,
        kickUserId: linked?.kickUserId || null,
        wagered,
        wageredLabel: entry.wageredLabel || String(wagered),
        tickets,
        rank: entry.rank || null,
        eligible: Boolean(linked?.kickUserId && tickets > 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.tickets - a.tickets || b.wagered - a.wagered);

  const totalTickets = entries.reduce((sum, entry) => sum + entry.tickets, 0);
  const eligibleTickets = entries
    .filter((entry) => entry.eligible)
    .reduce((sum, entry) => sum + entry.tickets, 0);

  return {
    entries,
    totalTickets,
    eligibleTickets,
    eligibleCount: entries.filter((entry) => entry.eligible).length,
    periodStart: roster.periodStart,
    periodEnd: roster.periodEnd,
    updatedAt: roster.updatedAt,
    ticketsPerDollars: TICKETS_PER_DOLLARS,
  };
}

export function pickWeightedRaffleEntry(entries) {
  const eligible = (entries || []).filter(
    (entry) => entry.eligible && entry.tickets > 0 && entry.kickUserId
  );

  if (!eligible.length) {
    throw new Error(
      "No eligible raffle entrants. Winners need linked Stake accounts and at least $50 wagered on code BLAKJAC21."
    );
  }

  const total = eligible.reduce((sum, entry) => sum + entry.tickets, 0);
  let cursor = crypto.randomInt(0, total);

  for (const entry of eligible) {
    cursor -= entry.tickets;
    if (cursor < 0) {
      return entry;
    }
  }

  return eligible[eligible.length - 1];
}

export async function revealWeeklyRaffleWinner() {
  const board = await buildWeeklyRaffleEntries();
  const picked = pickWeightedRaffleEntry(board.entries);
  const winner = normalizeWinner({
    id: crypto.randomUUID(),
    stakeUsername: picked.stakeUsername,
    kickUsername: picked.kickUsername,
    kickUserId: picked.kickUserId,
    tickets: picked.tickets,
    wagered: picked.wagered,
    revealedAt: new Date().toISOString(),
  });

  const state = await getWeeklyRaffleState();
  const history = [winner, ...(state.history || [])]
    .filter(Boolean)
    .slice(0, 20);

  return writeWeeklyRaffleState({
    winner,
    history,
  });
}

export async function clearWeeklyRaffleWinner() {
  const state = await getWeeklyRaffleState();
  return writeWeeklyRaffleState({
    winner: null,
    history: state.history || [],
  });
}
