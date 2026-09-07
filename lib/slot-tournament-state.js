import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slot-tournament-state.json");
const STATE_KEY = "slot-tournaments:state";
const TITLE_MAX_LENGTH = 80;
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 500;
const SLOTS_MAX = 500;
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

function normalizeTournamentSlot(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const name = String(raw.name || "").trim().slice(0, TITLE_MAX_LENGTH);
  if (!name) {
    return null;
  }

  const id = String(raw.id || "").trim() || crypto.randomUUID();
  const slug = String(raw.slug || "").trim().slice(0, 120) || null;
  const entryId = String(raw.entryId || "").trim() || null;
  const thumbnailUrl = String(raw.thumbnailUrl || "").trim().slice(0, 500) || null;

  return { id, name, slug, entryId, thumbnailUrl };
}

function normalizeTournamentSlots(rawSlots) {
  const slots = (Array.isArray(rawSlots) ? rawSlots : [])
    .map(normalizeTournamentSlot)
    .filter(Boolean)
    .slice(0, SLOTS_MAX);

  const seenEntryIds = new Set();
  return slots.map((slot) => {
    if (!slot.entryId) {
      return slot;
    }
    if (seenEntryIds.has(slot.entryId)) {
      return { ...slot, entryId: null };
    }
    seenEntryIds.add(slot.entryId);
    return slot;
  });
}

function normalizeScoreValue(raw) {
  const value = String(raw ?? "").trim().slice(0, 40);
  return value || null;
}

function parseComparableScore(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/x$/i, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeBracketMatch(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const round = Math.floor(Number(raw.round));
  const index = Math.floor(Number(raw.index));
  if (!Number.isFinite(round) || round < 1 || !Number.isFinite(index) || index < 0) {
    return null;
  }

  return {
    id: String(raw.id || "").trim() || crypto.randomUUID(),
    round,
    index,
    entryAId: String(raw.entryAId || "").trim() || null,
    entryBId: String(raw.entryBId || "").trim() || null,
    scoreA: normalizeScoreValue(raw.scoreA),
    scoreB: normalizeScoreValue(raw.scoreB),
    winnerEntryId: String(raw.winnerEntryId || "").trim() || null,
  };
}

function emptyBracket() {
  return {
    generatedAt: null,
    entrantIds: [],
    matches: [],
  };
}

function normalizeBracket(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyBracket();
  }

  const matches = (Array.isArray(raw.matches) ? raw.matches : [])
    .map(normalizeBracketMatch)
    .filter(Boolean)
    .sort((a, b) => a.round - b.round || a.index - b.index)
    .slice(0, 1024);

  return {
    generatedAt: raw.generatedAt || null,
    entrantIds: (Array.isArray(raw.entrantIds) ? raw.entrantIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, CAPACITY_MAX),
    matches,
  };
}

function bracketHasScores(bracket) {
  return (bracket?.matches || []).some(
    (match) => Boolean(match.scoreA) || Boolean(match.scoreB)
  );
}

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) {
    size *= 2;
  }
  return size;
}

function resolveMatchWinner(match) {
  if (!match) return null;

  // Round-1 empty seed is a bye. Later-round nulls mean "waiting for opponent".
  if (match.round === 1) {
    if (match.entryAId && !match.entryBId) {
      return match.entryAId;
    }
    if (match.entryBId && !match.entryAId) {
      return match.entryBId;
    }
  }

  if (!match.entryAId || !match.entryBId) {
    return null;
  }

  const scoreA = parseComparableScore(match.scoreA);
  const scoreB = parseComparableScore(match.scoreB);
  if (scoreA === null || scoreB === null) {
    return null;
  }
  if (scoreA === scoreB) {
    return null;
  }
  return scoreA > scoreB ? match.entryAId : match.entryBId;
}

function recomputeBracketWinners(matches) {
  const sorted = [...matches].sort(
    (a, b) => a.round - b.round || a.index - b.index
  );
  const maxRound = sorted.reduce((max, match) => Math.max(max, match.round), 1);
  const savedScores = new Map(
    sorted.map((match) => [
      match.id,
      { scoreA: match.scoreA, scoreB: match.scoreB },
    ])
  );

  for (const match of sorted) {
    if (match.round > 1) {
      match.entryAId = null;
      match.entryBId = null;
      match.winnerEntryId = null;
      match.scoreA = null;
      match.scoreB = null;
    }
  }

  for (let round = 1; round <= maxRound; round += 1) {
    const roundMatches = sorted.filter((match) => match.round === round);
    for (const match of roundMatches) {
      if (round > 1 && match.entryAId && match.entryBId) {
        const saved = savedScores.get(match.id);
        match.scoreA = saved?.scoreA || null;
        match.scoreB = saved?.scoreB || null;
      }

      const winner = resolveMatchWinner(match);
      match.winnerEntryId = winner;
      if (winner) {
        placeWinnerInNextRound(sorted, match, winner);
      }
    }
  }

  return sorted;
}

function placeWinnerInNextRound(matches, match, winnerEntryId) {
  const nextRound = match.round + 1;
  const nextIndex = Math.floor(match.index / 2);
  const nextMatch = matches.find(
    (entry) => entry.round === nextRound && entry.index === nextIndex
  );
  if (!nextMatch || !winnerEntryId) {
    return;
  }

  const slot = match.index % 2 === 0 ? "entryAId" : "entryBId";
  nextMatch[slot] = winnerEntryId;
}

export function buildSlotTournamentBracket(entries) {
  const sorted = [...(entries || [])].sort(
    (a, b) => new Date(a.enteredAt) - new Date(b.enteredAt)
  );

  if (sorted.length < 2) {
    throw new Error("Need at least 2 entrants to build a bracket.");
  }

  const entrantIds = sorted.map((entry) => entry.id);
  const size = nextPowerOfTwo(entrantIds.length);
  const roundCount = Math.log2(size);
  const seeds = Array.from({ length: size }, (_, index) => entrantIds[index] || null);
  const matches = [];

  for (let round = 1; round <= roundCount; round += 1) {
    const matchCount = size / 2 ** round;
    for (let index = 0; index < matchCount; index += 1) {
      matches.push({
        id: crypto.randomUUID(),
        round,
        index,
        entryAId: null,
        entryBId: null,
        scoreA: null,
        scoreB: null,
        winnerEntryId: null,
      });
    }
  }

  const roundOne = matches.filter((match) => match.round === 1);
  for (let index = 0; index < roundOne.length; index += 1) {
    const match = roundOne[index];
    match.entryAId = seeds[index] || null;
    match.entryBId = seeds[size - 1 - index] || null;
  }

  return {
    generatedAt: new Date().toISOString(),
    entrantIds,
    matches: recomputeBracketWinners(matches),
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
    slots: [],
    bracket: emptyBracket(),
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
    slots: normalizeTournamentSlots(raw.slots),
    bracket: normalizeBracket(raw.bracket),
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
    slots: nextOpen
      ? current.slots.map((slot) => ({ ...slot, entryId: null }))
      : current.slots,
    bracket: nextOpen ? emptyBracket() : current.bracket,
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

export async function setSlotTournamentSlots(slots, { validEntryIds } = {}) {
  const current = await readState();
  const allowed =
    validEntryIds instanceof Set
      ? validEntryIds
      : Array.isArray(validEntryIds)
        ? new Set(validEntryIds.map((id) => String(id || "").trim()).filter(Boolean))
        : null;

  const normalized = normalizeTournamentSlots(slots).map((slot) => {
    if (!slot.entryId || !allowed) {
      return slot;
    }
    return allowed.has(slot.entryId) ? slot : { ...slot, entryId: null };
  });

  return writeState({
    ...current,
    slots: normalized,
  });
}

export async function clearSlotTournamentSlotAssignments() {
  const current = await readState();
  return writeState({
    ...current,
    slots: current.slots.map((slot) => ({ ...slot, entryId: null })),
  });
}

export async function generateSlotTournamentBracket(entries, { force = false } = {}) {
  const current = await readState();
  if (!force && bracketHasScores(current.bracket)) {
    throw new Error(
      "Bracket already has scores. Reset the bracket before regenerating."
    );
  }

  const bracket = buildSlotTournamentBracket(entries);
  return writeState({
    ...current,
    bracket,
  });
}

export async function clearSlotTournamentBracket() {
  const current = await readState();
  return writeState({
    ...current,
    bracket: emptyBracket(),
  });
}

export async function setSlotTournamentBracketScore({
  matchId,
  scoreA,
  scoreB,
} = {}) {
  const current = await readState();
  const bracket = normalizeBracket(current.bracket);
  if (!bracket.matches.length) {
    throw new Error("Generate a bracket before entering scores.");
  }

  const id = String(matchId || "").trim();
  const match = bracket.matches.find((entry) => entry.id === id);
  if (!match) {
    throw new Error("Match not found.");
  }

  if (!match.entryAId || !match.entryBId) {
    throw new Error("Both players must be set before scoring.");
  }

  match.scoreA = normalizeScoreValue(scoreA);
  match.scoreB = normalizeScoreValue(scoreB);

  return writeState({
    ...current,
    bracket: {
      ...bracket,
      matches: recomputeBracketWinners(bracket.matches),
    },
  });
}
