import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slot-tournament-state.json");
const STATE_KEY = "slot-tournaments:state";
const TITLE_MAX_LENGTH = 80;
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 500;
const PHASES = new Set(["closed", "signup", "live", "results"]);

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

export function normalizeTournamentCapacity(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < CAPACITY_MIN) {
    return 0;
  }
  return Math.min(CAPACITY_MAX, value);
}

function normalizePhase(raw) {
  const phase = String(raw || "").trim().toLowerCase();
  return PHASES.has(phase) ? phase : "closed";
}

function normalizeResult(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const place = Math.floor(Number(entry.place));
  const username = String(entry.username || "").trim();
  if (!Number.isFinite(place) || place < 1 || !username) {
    return null;
  }

  const scoreRaw = String(entry.score || "").trim();
  return {
    place,
    entryId: String(entry.entryId || "").trim() || null,
    kickUserId: String(entry.kickUserId || "").trim() || null,
    username,
    score: scoreRaw.slice(0, 40),
    note: String(entry.note || "").trim().slice(0, 120),
  };
}

function defaultState() {
  return {
    open: false,
    phase: "closed",
    title: "",
    slotName: "",
    buyIn: "",
    capacity: 0,
    affiliatesOnly: false,
    subscribersOnly: false,
    results: [],
    updatedAt: null,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultState();
  }

  const open = Boolean(raw.open);
  let phase = normalizePhase(raw.phase);
  if (open) {
    phase = "signup";
  } else if (phase === "signup") {
    phase = "closed";
  }

  const results = (Array.isArray(raw.results) ? raw.results : [])
    .map(normalizeResult)
    .filter(Boolean)
    .sort((a, b) => a.place - b.place)
    .slice(0, 50);

  return {
    open,
    phase,
    title: String(raw.title || "").trim().slice(0, TITLE_MAX_LENGTH),
    slotName: String(raw.slotName || "").trim().slice(0, TITLE_MAX_LENGTH),
    buyIn: String(raw.buyIn || "").trim().slice(0, 40),
    capacity: normalizeTournamentCapacity(raw.capacity),
    affiliatesOnly: Boolean(raw.affiliatesOnly),
    subscribersOnly: Boolean(raw.subscribersOnly),
    results,
    updatedAt: raw.updatedAt || null,
  };
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Redis command failed.");
  }
  return data.result;
}

async function readRedisState() {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const result = await redisCommand(config, ["GET", STATE_KEY]);
    if (result === null || result === undefined) {
      return defaultState();
    }
    return normalizeState(
      typeof result === "string" ? JSON.parse(result) : result
    );
  } catch {
    return null;
  }
}

async function writeRedisState(state) {
  const config = getRedisConfig();
  if (!config) return false;

  try {
    const result = await redisCommand(config, [
      "SET",
      STATE_KEY,
      JSON.stringify(state),
    ]);
    return result === "OK";
  } catch {
    return false;
  }
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
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function readState() {
  const redisState = await readRedisState();
  if (redisState) return redisState;
  if (process.env.VERCEL === "1") return defaultState();
  return readFileState();
}

async function writeState(state) {
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
  });

  if (getRedisConfig()) {
    const saved = await writeRedisState(normalized);
    if (!saved) {
      throw new Error("Could not save tournament state to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Slot tournaments need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileState(normalized);
  return normalized;
}

export async function getSlotTournamentState() {
  return readState();
}

export async function setSlotTournamentOpen(open) {
  const current = await readState();
  const nextOpen = Boolean(open);

  if (nextOpen && current.capacity < CAPACITY_MIN) {
    throw new Error("Set a signup capacity before opening.");
  }

  return writeState({
    ...current,
    open: nextOpen,
    phase: nextOpen ? "signup" : current.phase === "signup" ? "live" : current.phase,
    results: nextOpen ? [] : current.results,
  });
}

export async function setSlotTournamentPhase(phase) {
  const nextPhase = normalizePhase(phase);
  if (nextPhase === "signup") {
    throw new Error("Open signups to enter signup phase.");
  }

  const current = await readState();
  return writeState({
    ...current,
    open: false,
    phase: nextPhase,
  });
}

export async function setSlotTournamentSettings({
  title,
  slotName,
  buyIn,
  capacity,
} = {}) {
  const current = await readState();
  const nextCapacity =
    capacity === undefined
      ? current.capacity
      : normalizeTournamentCapacity(capacity);

  if (capacity !== undefined && nextCapacity < CAPACITY_MIN) {
    throw new Error(
      `Signup capacity must be between ${CAPACITY_MIN} and ${CAPACITY_MAX}.`
    );
  }

  if (current.open && nextCapacity < CAPACITY_MIN) {
    throw new Error("Cannot clear capacity while signups are open.");
  }

  return writeState({
    ...current,
    title:
      title === undefined
        ? current.title
        : String(title || "").trim().slice(0, TITLE_MAX_LENGTH),
    slotName:
      slotName === undefined
        ? current.slotName
        : String(slotName || "").trim().slice(0, TITLE_MAX_LENGTH),
    buyIn:
      buyIn === undefined
        ? current.buyIn
        : String(buyIn || "").trim().slice(0, 40),
    capacity: nextCapacity,
  });
}

export async function setSlotTournamentAffiliatesOnly(affiliatesOnly) {
  const current = await readState();
  return writeState({
    ...current,
    affiliatesOnly: Boolean(affiliatesOnly),
  });
}

export async function setSlotTournamentSubscribersOnly(subscribersOnly) {
  const current = await readState();
  return writeState({
    ...current,
    subscribersOnly: Boolean(subscribersOnly),
  });
}

export async function setSlotTournamentResults(results) {
  const current = await readState();
  const normalized = (Array.isArray(results) ? results : [])
    .map(normalizeResult)
    .filter(Boolean)
    .sort((a, b) => a.place - b.place)
    .slice(0, 50);

  return writeState({
    ...current,
    open: false,
    phase: normalized.length ? "results" : current.phase === "results" ? "closed" : current.phase,
    results: normalized,
  });
}
