import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { awardPoints } from "./points.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "house-loss-raffle.json");
const STATE_KEY = "bj:house-loss-raffle";
export const WEEK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const WINNER_COUNT = 5;

/** Losses from these Kick usernames never feed the pool. */
const POOL_EXCLUDED_USERNAMES = new Set(["captainbonk"]);

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function normalizeWinner(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kickUserId = String(raw.kickUserId || "").trim();
  if (!kickUserId) return null;
  return {
    id: String(raw.id || crypto.randomUUID()),
    kickUserId,
    kickUsername: String(raw.kickUsername || "").trim() || null,
    stakeUsername: String(raw.stakeUsername || "").trim() || null,
    amount: Math.max(0, Math.floor(Number(raw.amount) || 0)),
    revealedAt: raw.revealedAt || new Date().toISOString(),
  };
}

function normalizeWeek(raw) {
  if (!raw || typeof raw !== "object") {
    return { startedAt: null, endsAt: null };
  }
  const startMs = Date.parse(raw.startedAt || "");
  const endMs = Date.parse(raw.endsAt || "");
  return {
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endsAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
  };
}

function normalizeWinners(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeWinner).filter(Boolean).slice(0, WINNER_COUNT);
}

function defaultState() {
  return {
    pool: 0,
    week: normalizeWeek(null),
    lastWinners: [],
    drawing: false,
  };
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  // Prefer lastWinners; fall back to legacy single lastWinner.
  let lastWinners = normalizeWinners(raw.lastWinners);
  if (!lastWinners.length) {
    const legacy = normalizeWinner(raw.lastWinner);
    if (legacy) lastWinners = [legacy];
  }
  return {
    pool: Math.max(0, Math.floor(Number(raw.pool) || 0)),
    week: normalizeWeek(raw.week),
    lastWinners,
    drawing: Boolean(raw.drawing),
  };
}

/** Split pool across n winners; remainder UncCoins go to the first slots. */
export function splitPoolAmongWinners(pool, count) {
  const total = Math.max(0, Math.floor(Number(pool) || 0));
  const slots = Math.max(1, Math.floor(Number(count) || 1));
  if (total < 1) return Array.from({ length: slots }, () => 0);
  const base = Math.floor(total / slots);
  const remainder = total % slots;
  return Array.from({ length: slots }, (_, index) =>
    base + (index < remainder ? 1 : 0)
  );
}

function pickUniqueWinners(eligible, count) {
  const pool = [...eligible];
  const picks = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const index = crypto.randomInt(0, pool.length);
    picks.push(pool.splice(index, 1)[0]);
  }
  return picks;
}

export function getWeekStatus(week, now = Date.now()) {
  const startMs = Date.parse(week?.startedAt || "");
  const endMs = Date.parse(week?.endsAt || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return {
      started: false,
      active: false,
      ended: false,
      startedAt: null,
      endsAt: null,
      remainingMs: 0,
    };
  }
  const ended = now >= endMs;
  const active = now >= startMs && now < endMs;
  return {
    started: true,
    active,
    ended,
    startedAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    remainingMs: active ? Math.max(0, endMs - now) : 0,
  };
}

function isPoolExcludedUsername(username) {
  return POOL_EXCLUDED_USERNAMES.has(
    String(username || "")
      .trim()
      .toLowerCase()
  );
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
const MEMORY_TTL_MS = 1500;

export async function getHouseLossRaffleState() {
  if (memoryState && Date.now() - memoryStateAt < MEMORY_TTL_MS) {
    return memoryState;
  }
  const fromRedis = await redisGet(STATE_KEY);
  if (fromRedis) {
    memoryState = normalizeState(fromRedis);
    memoryStateAt = Date.now();
    return memoryState;
  }
  const fromFile = await readFileState();
  memoryState = fromFile;
  memoryStateAt = Date.now();
  return fromFile;
}

async function writeHouseLossRaffleState(next) {
  const state = normalizeState(next);
  memoryState = state;
  memoryStateAt = Date.now();
  const saved = await redisSet(STATE_KEY, state);
  if (!saved) {
    await writeFileState(state);
  }
  return state;
}

function newWeekWindow(from = new Date()) {
  const startedAt = new Date(from);
  const endsAt = new Date(startedAt.getTime() + WEEK_DURATION_MS);
  return {
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

export async function ensureHouseLossWeek() {
  const state = await getHouseLossRaffleState();
  const week = getWeekStatus(state.week);
  if (week.started && !week.ended) {
    return state;
  }
  if (week.ended) {
    return state;
  }
  return writeHouseLossRaffleState({
    ...state,
    week: newWeekWindow(),
    drawing: false,
  });
}

export async function recordHouseGameNet({
  game,
  kickUserId,
  username,
  totalWager,
  payout,
}) {
  if (isPoolExcludedUsername(username)) {
    return getHouseLossRaffleState();
  }

  const wager = Math.max(0, Math.floor(Number(totalWager) || 0));
  const paid = Math.max(0, Math.floor(Number(payout) || 0));
  const delta = Math.max(0, wager - paid);
  if (delta < 1) {
    return getHouseLossRaffleState();
  }

  let state = await ensureHouseLossWeek();
  let week = getWeekStatus(state.week);
  if (week.ended) {
    try {
      state = await settleEndedWeek(state);
    } catch (error) {
      console.error("House loss raffle settle before contribute failed:", error.message);
      state = await writeHouseLossRaffleState({
        ...state,
        week: newWeekWindow(),
        drawing: false,
      });
    }
    week = getWeekStatus(state.week);
  } else if (!week.started) {
    state = await ensureHouseLossWeek();
  }

  return writeHouseLossRaffleState({
    ...state,
    pool: state.pool + delta,
    lastContributionAt: new Date().toISOString(),
    lastContribution: {
      game: String(game || "").trim() || null,
      kickUserId: String(kickUserId || "").trim() || null,
      username: String(username || "").trim() || null,
      amount: delta,
      at: new Date().toISOString(),
    },
  });
}

async function listEligibleAffUsers() {
  const { listUsers } = await import("./users.js");
  const users = await listUsers();
  return (users || []).filter((user) => {
    if (!user?.kickUserId) return false;
    if (user.banned) return false;
    if (user.altSoftBlocked) return false;
    if (!String(user.stakeUsername || "").trim()) return false;
    return Boolean(user.stakeCodeVerified);
  });
}

async function revealWithState(state, { allowEmptyPool = false } = {}) {
  const pool = Math.max(0, Math.floor(Number(state.pool) || 0));
  if (pool < 1 && !allowEmptyPool) {
    return writeHouseLossRaffleState({
      ...state,
      week: newWeekWindow(),
      drawing: false,
    });
  }

  if (pool < 1) {
    return writeHouseLossRaffleState({
      ...state,
      pool: 0,
      lastWinners: [],
      week: newWeekWindow(),
      drawing: false,
    });
  }

  const eligible = await listEligibleAffUsers();
  if (!eligible.length) {
    throw new Error(
      "No eligible AFF winners. Winners need a linked Stake account and the AFF badge."
    );
  }

  const picks = pickUniqueWinners(eligible, WINNER_COUNT);
  const shares = splitPoolAmongWinners(pool, picks.length);
  const revealedAt = new Date().toISOString();
  const winners = [];

  for (let i = 0; i < picks.length; i += 1) {
    const amount = shares[i] || 0;
    if (amount < 1) continue;
    const picked = picks[i];
    const winner = normalizeWinner({
      id: crypto.randomUUID(),
      kickUserId: picked.kickUserId,
      kickUsername: picked.username || null,
      stakeUsername: picked.stakeUsername || null,
      amount,
      revealedAt,
    });
    await awardPoints({
      kickUserId: winner.kickUserId,
      username: winner.kickUsername || winner.stakeUsername,
      amount,
      note: "House games loss raffle",
    });
    winners.push(winner);
  }

  if (!winners.length) {
    throw new Error("Could not award any house raffle winners.");
  }

  return writeHouseLossRaffleState({
    ...state,
    pool: 0,
    lastWinners: winners,
    week: newWeekWindow(),
    drawing: false,
  });
}

async function settleEndedWeek(state) {
  if (state.drawing) {
    return getHouseLossRaffleState();
  }
  await writeHouseLossRaffleState({ ...state, drawing: true });
  try {
    return await revealWithState(state, { allowEmptyPool: true });
  } catch (error) {
    await writeHouseLossRaffleState({ ...state, drawing: false });
    throw error;
  }
}

export async function revealHouseLossRaffleWinner({ force = false } = {}) {
  let state = await getHouseLossRaffleState();
  const week = getWeekStatus(state.week);
  if (!force && week.started && !week.ended) {
    throw new Error("This week is still running. Wait for the timer, or force the draw as admin.");
  }
  if (state.drawing) {
    throw new Error("A draw is already in progress.");
  }
  await writeHouseLossRaffleState({ ...state, drawing: true });
  try {
    state = await getHouseLossRaffleState();
    return await revealWithState(state, { allowEmptyPool: false });
  } catch (error) {
    const current = await getHouseLossRaffleState();
    await writeHouseLossRaffleState({ ...current, drawing: false });
    throw error;
  }
}

export async function resetHouseLossRaffleWeek({ clearPool = false } = {}) {
  const state = await getHouseLossRaffleState();
  return writeHouseLossRaffleState({
    ...state,
    pool: clearPool ? 0 : state.pool,
    week: newWeekWindow(),
    drawing: false,
  });
}

export async function getHouseLossRafflePublic() {
  let state = await ensureHouseLossWeek();
  let week = getWeekStatus(state.week);

  if (week.ended) {
    try {
      state = await settleEndedWeek(state);
      week = getWeekStatus(state.week);
    } catch (error) {
      console.error("House loss raffle auto-draw failed:", error.message);
      week = getWeekStatus(state.week);
    }
  }

  return {
    pool: state.pool,
    weekDurationMs: WEEK_DURATION_MS,
    winnerCount: WINNER_COUNT,
    week,
    /** Previous week's winners only (amounts already credited). */
    lastWinners: state.lastWinners || [],
    eligibleNote: `When the week ends, ${WINNER_COUNT} random Stake-linked AFF users split the pot. UncCoins are added automatically.`,
  };
}
