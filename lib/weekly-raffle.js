import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "weekly-raffle-state.json");
const STATE_KEY = "weekly-raffle:state";
export const TICKETS_PER_DOLLARS = 50;
export const WEEK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const SPREADSHEET_ID = "1wPakSQJBBbAQNEQxPVQWdj1uRbY86bRIUCxde_114_g";
const RAFFLE_SHEET_GID = "235680015";
const RAFFLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${RAFFLE_SHEET_GID}`;
const ROSTER_CACHE_TTL_MS = 60 * 1000;

let cachedRoster = null;
let cachedRosterAt = 0;
let rosterInFlight = null;

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

function normalizeBaselines(raw) {
  const baselines = {};
  if (!raw || typeof raw !== "object") return baselines;
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key || "").trim().toLowerCase();
    if (!name) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) continue;
    baselines[name] = amount;
  }
  return baselines;
}

function normalizeFrozenEntries(raw) {
  if (!raw || typeof raw !== "object") return null;
  const frozen = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key || "").trim().toLowerCase();
    if (!name) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) continue;
    frozen[name] = amount;
  }
  return Object.keys(frozen).length ? frozen : null;
}

function normalizeWeek(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      startedAt: null,
      endsAt: null,
      baselines: {},
      frozenEntries: null,
    };
  }

  const startedAt = raw.startedAt ? String(raw.startedAt) : null;
  const endsAt = raw.endsAt ? String(raw.endsAt) : null;
  const startMs = Date.parse(startedAt || "");
  const endMs = Date.parse(endsAt || "");

  return {
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endsAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    baselines: normalizeBaselines(raw.baselines),
    frozenEntries: normalizeFrozenEntries(raw.frozenEntries),
  };
}

function defaultState() {
  return {
    winner: null,
    history: [],
    week: normalizeWeek(null),
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
    week: normalizeWeek(raw.week),
  };
}

function getWeekStatus(week, now = Date.now()) {
  const startedAt = week?.startedAt || null;
  const endsAt = week?.endsAt || null;
  const startMs = Date.parse(startedAt || "");
  const endMs = Date.parse(endsAt || "");

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

  const started = true;
  const ended = now >= endMs;
  const active = now >= startMs && now < endMs;

  return {
    started,
    active,
    ended,
    startedAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    remainingMs: active ? Math.max(0, endMs - now) : 0,
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

function parseGvizResponse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Invalid raffle sheet response.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function cellValue(cell) {
  if (!cell) return null;
  if (cell.v !== null && cell.v !== undefined) return cell.v;
  return cell.f ?? null;
}

function cellLabel(cell) {
  if (!cell) return "";
  return cell.f ?? String(cell.v ?? "");
}

function mapRaffleRow(row, index) {
  const cells = row.c || [];
  return {
    rank: Number(cellValue(cells[4])) || index + 1,
    username: String(cellValue(cells[2]) || "").trim(),
    wagered: Number(cellValue(cells[3])) || 0,
    wageredLabel: cellLabel(cells[3]),
    sheetStart: cellLabel(cells[5]) || null,
    sheetEnd: cellLabel(cells[6]) || null,
  };
}

export async function fetchWeeklyRaffleRoster() {
  const now = Date.now();
  if (cachedRoster && now - cachedRosterAt < ROSTER_CACHE_TTL_MS) {
    return cachedRoster;
  }

  if (rosterInFlight) {
    return rosterInFlight;
  }

  rosterInFlight = (async () => {
    const response = await fetch(RAFFLE_SHEET_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Could not load weekly raffle sheet.");
    }

    const text = await response.text();
    const data = parseGvizResponse(text);
    const rows = data.table?.rows || [];
    const entries = rows
      .map((row, index) => mapRaffleRow(row, index))
      .filter((entry) => entry.username);

    const first = entries[0] || null;
    const roster = {
      entries,
      periodStart: first?.sheetStart || null,
      periodEnd: first?.sheetEnd || null,
      updatedAt: new Date().toISOString(),
    };

    cachedRoster = roster;
    cachedRosterAt = Date.now();
    return roster;
  })();

  try {
    return await rosterInFlight;
  } finally {
    rosterInFlight = null;
  }
}

async function buildKickLinksByStake() {
  const { getKickLinksByStakeUsername } = await import("./users.js");
  return getKickLinksByStakeUsername();
}

function formatMoneyLabel(amount) {
  return Number(amount || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export async function buildWeeklyRaffleEntries() {
  const [roster, state] = await Promise.all([
    fetchWeeklyRaffleRoster(),
    getWeeklyRaffleState(),
  ]);
  const byStake = await buildKickLinksByStake();
  const weekStatus = getWeekStatus(state.week);
  const baselines = { ...(state.week?.baselines || {}) };
  let nextState = null;

  // New names that appear mid-week start from their first seen total,
  // so only wagering after that point counts toward tickets.
  if (weekStatus.active) {
    let baselinesChanged = false;
    for (const entry of roster.entries || []) {
      const key = String(entry.username || "").trim().toLowerCase();
      if (!key || Object.prototype.hasOwnProperty.call(baselines, key)) continue;
      baselines[key] = Math.max(0, Number(entry.wagered) || 0);
      baselinesChanged = true;
    }
    if (baselinesChanged) {
      nextState = {
        ...state,
        week: {
          ...state.week,
          baselines,
        },
      };
    }
  }

  let frozenEntries = state.week?.frozenEntries || null;
  if (weekStatus.ended && !frozenEntries) {
    frozenEntries = {};
    for (const entry of roster.entries || []) {
      const key = String(entry.username || "").trim().toLowerCase();
      if (!key) continue;
      const sheetWagered = Math.max(0, Number(entry.wagered) || 0);
      const baseline = Math.max(0, Number(baselines[key]) || 0);
      frozenEntries[key] = Math.max(0, sheetWagered - baseline);
    }
    nextState = {
      ...(nextState || state),
      week: {
        ...(nextState || state).week,
        baselines,
        frozenEntries,
      },
    };
  }

  if (nextState) {
    await writeWeeklyRaffleState(nextState);
  }

  const entries = (roster.entries || [])
    .map((entry) => {
      const stakeUsername = String(entry.username || "").trim();
      if (!stakeUsername) return null;
      const sheetWagered = Math.max(0, Number(entry.wagered) || 0);
      const key = stakeUsername.toLowerCase();
      const baseline = weekStatus.started
        ? Math.max(0, Number(baselines[key]) || 0)
        : sheetWagered;
      let trackedWagered = 0;
      if (weekStatus.ended && frozenEntries) {
        trackedWagered = Math.max(0, Number(frozenEntries[key]) || 0);
      } else if (weekStatus.started) {
        trackedWagered = Math.max(0, sheetWagered - baseline);
      }
      const tickets = weekStatus.started ? wageredToTickets(trackedWagered) : 0;
      const linked = byStake.get(key) || null;

      return {
        id: `sheet:${key}`,
        stakeUsername,
        kickUsername: linked?.kickUsername || null,
        kickUserId: linked?.kickUserId || null,
        wagered: trackedWagered,
        wageredLabel: formatMoneyLabel(trackedWagered),
        sheetWagered,
        baseline,
        tickets,
        rank: entry.rank || null,
        eligible: Boolean(
          weekStatus.started && linked?.kickUserId && tickets > 0
        ),
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
    week: weekStatus,
  };
}

export function pickWeightedRaffleEntry(entries) {
  const eligible = (entries || []).filter(
    (entry) => entry.eligible && entry.tickets > 0 && entry.kickUserId
  );

  if (!eligible.length) {
    throw new Error(
      "No eligible raffle entrants. Start the week, then winners need linked Stake accounts and at least $50 wagered during the 7-day window."
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

export async function startWeeklyRaffleWeek() {
  const roster = await fetchWeeklyRaffleRoster();
  const baselines = {};
  for (const entry of roster.entries || []) {
    const key = String(entry.username || "").trim().toLowerCase();
    if (!key) continue;
    baselines[key] = Math.max(0, Number(entry.wagered) || 0);
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + WEEK_DURATION_MS);
  const state = await getWeeklyRaffleState();

  return writeWeeklyRaffleState({
    winner: null,
    history: state.history || [],
    week: {
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      baselines,
      frozenEntries: null,
    },
  });
}

export async function resetWeeklyRaffleWeek() {
  const state = await getWeeklyRaffleState();
  return writeWeeklyRaffleState({
    winner: null,
    history: state.history || [],
    week: {
      startedAt: null,
      endsAt: null,
      baselines: {},
      frozenEntries: null,
    },
  });
}

export async function revealWeeklyRaffleWinner() {
  const board = await buildWeeklyRaffleEntries();
  if (!board.week?.started) {
    throw new Error("Start the 7-day week before drawing a winner.");
  }

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
    ...state,
    winner,
    history,
  });
}

export async function clearWeeklyRaffleWinner() {
  const state = await getWeeklyRaffleState();
  return writeWeeklyRaffleState({
    ...state,
    winner: null,
  });
}
