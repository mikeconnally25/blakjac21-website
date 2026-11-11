import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slot-league-state.json");
const STATE_KEY = "bj:slot-league";

export const LEAGUE_CAPACITY = 16;
export const GROUP_IDS = ["A", "B", "C", "D"];
export const PHASES = new Set([
  "closed",
  "signup",
  "season",
  "results",
  // Legacy NBA Cup phases — normalized to season/results.
  "groups",
  "knockout",
]);
const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const TITLE_MAX_LENGTH = 80;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function normalizePhase(raw) {
  const phase = String(raw || "").trim().toLowerCase();
  if (phase === "groups" || phase === "knockout") return "season";
  if (phase === "season" || phase === "results" || phase === "signup" || phase === "closed") {
    return phase;
  }
  return PHASES.has(phase) ? phase : "closed";
}

function normalizeScoreValue(raw) {
  const value = String(raw ?? "").trim().slice(0, 40);
  return value || null;
}

export function parseComparableScore(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/x$/i, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeSlot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim().slice(0, TITLE_MAX_LENGTH);
  if (!name) return null;
  return {
    id: String(raw.id || "").trim() || crypto.randomUUID(),
    name,
    slug: String(raw.slug || "").trim().slice(0, 120) || null,
    thumbnailUrl:
      String(raw.thumbnailUrl || "").trim().slice(0, 500) || null,
  };
}

function emptyGroups() {
  return { A: [], B: [], C: [], D: [] };
}

function createEmptySpots() {
  return Array.from({ length: LEAGUE_CAPACITY }, (_, index) => ({
    id: `spot-${index + 1}`,
    index: index + 1,
    entryId: null,
    slot: null,
  }));
}

function normalizeSpot(raw, fallbackIndex) {
  const index =
    Number.isFinite(Number(raw?.index)) && Number(raw.index) >= 1
      ? Math.floor(Number(raw.index))
      : fallbackIndex;
  return {
    id: String(raw?.id || "").trim() || `spot-${index}`,
    index,
    entryId: String(raw?.entryId || "").trim() || null,
    slot: normalizeSlot(raw?.slot),
  };
}

function normalizeSpots(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const spots = [];
  for (let i = 0; i < LEAGUE_CAPACITY; i += 1) {
    spots.push(normalizeSpot(list[i], i + 1));
  }
  // Ensure unique ids
  const seen = new Set();
  return spots.map((spot, i) => {
    let id = spot.id;
    if (!id || seen.has(id)) {
      id = `spot-${i + 1}`;
    }
    seen.add(id);
    return { ...spot, id, index: i + 1 };
  });
}

function normalizeGroups(raw) {
  const groups = emptyGroups();
  if (!raw || typeof raw !== "object") return groups;
  for (const key of GROUP_IDS) {
    groups[key] = (Array.isArray(raw[key]) ? raw[key] : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  return groups;
}

function normalizeMatch(raw) {
  if (!raw || typeof raw !== "object") return null;
  let stage = String(raw.stage || "").trim().toLowerCase();
  // Group fixtures are the Prem-style 4×4 tables.
  if (stage === "league") stage = "group";
  if (["qf", "sf", "final"].includes(stage)) return null;
  if (stage !== "group") return null;
  const groupRaw = String(raw.group || "").trim().toUpperCase();
  const group = GROUP_IDS.includes(groupRaw) ? groupRaw : null;
  const round = Math.max(1, Math.floor(Number(raw.round) || 1));
  const index = Math.max(0, Math.floor(Number(raw.index) || 0));
  const scoreA = normalizeScoreValue(raw.scoreA);
  const scoreB = normalizeScoreValue(raw.scoreB);
  const parsedA = parseComparableScore(scoreA);
  const parsedB = parseComparableScore(scoreB);
  let winnerSpotId = String(raw.winnerSpotId || "").trim() || null;
  if (parsedA !== null && parsedB !== null) {
    if (parsedA > parsedB) {
      winnerSpotId = String(raw.spotAId || "").trim() || null;
    } else if (parsedB > parsedA) {
      winnerSpotId = String(raw.spotBId || "").trim() || null;
    } else {
      winnerSpotId = null;
    }
  }
  return {
    id: String(raw.id || "").trim() || crypto.randomUUID(),
    stage: "group",
    group,
    round,
    index,
    spotAId: String(raw.spotAId || "").trim() || null,
    spotBId: String(raw.spotBId || "").trim() || null,
    scoreA,
    scoreB,
    winnerSpotId,
  };
}

export function isMatchPlayed(match) {
  return (
    parseComparableScore(match?.scoreA) !== null &&
    parseComparableScore(match?.scoreB) !== null
  );
}

function normalizeMatches(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeMatch)
    .filter(Boolean)
    .slice(0, 128);
}

function defaultState() {
  return {
    open: false,
    phase: "closed",
    title: "Slot League",
    buyIn: "",
    capacity: LEAGUE_CAPACITY,
    spots: createEmptySpots(),
    groups: emptyGroups(),
    matches: [],
    championSpotId: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultState();
  }
  const open = Boolean(raw.open);
  let phase = normalizePhase(raw.phase);
  if (open && phase === "closed") {
    phase = "signup";
  }
  if (!open && phase === "signup") {
    phase = "closed";
  }
  return {
    open,
    phase,
    title: String(raw.title || "Slot League")
      .trim()
      .slice(0, TITLE_MAX_LENGTH) || "Slot League",
    buyIn: String(raw.buyIn || "").trim().slice(0, 40),
    capacity: LEAGUE_CAPACITY,
    spots: normalizeSpots(raw.spots),
    groups: normalizeGroups(raw.groups),
    matches: normalizeMatches(raw.matches),
    championSpotId: String(raw.championSpotId || "").trim() || null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
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
    if (result === null || result === undefined) return defaultState();
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    return normalizeState(parsed);
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

export async function getSlotLeagueState() {
  const fromRedis = await readRedisState();
  if (fromRedis) return fromRedis;
  if (process.env.VERCEL === "1") return defaultState();
  return readFileState();
}

async function writeSlotLeagueState(next) {
  const state = normalizeState({
    ...next,
    updatedAt: new Date().toISOString(),
  });
  if (getRedisConfig()) {
    const saved = await writeRedisState(state);
    if (!saved) {
      throw new Error("Could not save league state to Redis.");
    }
    return state;
  }
  if (process.env.VERCEL === "1") {
    throw new Error(
      "League state needs shared storage. Add Upstash Redis in Vercel."
    );
  }
  await writeFileState(state);
  return state;
}

function resolveMatchWinner(match) {
  if (!match?.spotAId || !match?.spotBId) return null;
  const scoreA = parseComparableScore(match.scoreA);
  const scoreB = parseComparableScore(match.scoreB);
  if (scoreA === null || scoreB === null) return null;
  if (scoreA === scoreB) return null;
  return scoreA > scoreB ? match.spotAId : match.spotBId;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Circle method: even number of teams → (n-1) matchdays of n/2 fixtures. */
function buildRoundRobinRounds(spotIds) {
  const teams = [...spotIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) {
    teams.push(null);
  }
  const n = teams.length;
  const rounds = [];
  for (let round = 0; round < n - 1; round += 1) {
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    const fixed = teams[0];
    const rotating = teams.slice(1);
    rotating.unshift(rotating.pop());
    teams.splice(0, teams.length, fixed, ...rotating);
  }
  return rounds;
}

export function listSeasonMatches(state) {
  return (state?.matches || []).filter(
    (m) => m.stage === "group" || m.stage === "league"
  );
}

function sortTableRows(rows) {
  rows.sort(
    (x, y) =>
      y.points - x.points ||
      y.diff - x.diff ||
      y.pointsFor - x.pointsFor ||
      x.spotId.localeCompare(y.spotId)
  );
  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

function applyMatchToRows(match, bySpot) {
  if (!isMatchPlayed(match)) return;
  const a = bySpot.get(match.spotAId);
  const b = bySpot.get(match.spotBId);
  if (!a || !b) return;
  const scoreA = parseComparableScore(match.scoreA) ?? 0;
  const scoreB = parseComparableScore(match.scoreB) ?? 0;
  a.played += 1;
  b.played += 1;
  a.pointsFor += scoreA;
  a.pointsAgainst += scoreB;
  b.pointsFor += scoreB;
  b.pointsAgainst += scoreA;
  if (scoreA > scoreB) {
    a.wins += 1;
    a.points += POINTS_WIN;
    b.losses += 1;
  } else if (scoreB > scoreA) {
    b.wins += 1;
    b.points += POINTS_WIN;
    a.losses += 1;
  } else {
    a.draws += 1;
    b.draws += 1;
    a.points += POINTS_DRAW;
    b.points += POINTS_DRAW;
  }
}

function emptyTableRow(spotId, groupId = null) {
  return {
    spotId,
    group: groupId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
    points: 0,
  };
}

/** Four Prem-style tables (A–D), 4 teams each. */
export function computeGroupStandings(state) {
  const standings = {};
  for (const groupId of GROUP_IDS) {
    const spotIds = state.groups?.[groupId] || [];
    const rows = spotIds.map((spotId) => emptyTableRow(spotId, groupId));
    const bySpot = new Map(rows.map((r) => [r.spotId, r]));
    for (const match of listSeasonMatches(state)) {
      if (match.group !== groupId) continue;
      applyMatchToRows(match, bySpot);
    }
    for (const row of rows) {
      row.diff = row.pointsFor - row.pointsAgainst;
    }
    standings[groupId] = sortTableRows(rows);
  }
  return standings;
}

/** Flat combined ranking across all groups (for legacy/champion helpers). */
export function computeLeagueTable(state) {
  const standings = computeGroupStandings(state);
  const rows = GROUP_IDS.flatMap((groupId) => standings[groupId] || []);
  return sortTableRows(rows.map(({ position, ...rest }) => rest));
}

export function areSeasonMatchesComplete(state) {
  const matches = listSeasonMatches(state);
  if (!matches.length) return false;
  return matches.every((m) => isMatchPlayed(m));
}

export function areGroupMatchesComplete(state) {
  return areSeasonMatchesComplete(state);
}

export function getGroupWinners(state) {
  const standings = computeGroupStandings(state);
  return GROUP_IDS.map((groupId) => standings[groupId]?.[0] || null).filter(
    Boolean
  );
}

export async function setSlotLeagueOpen(open) {
  const state = await getSlotLeagueState();
  const nextOpen = Boolean(open);
  if (nextOpen) {
    return writeSlotLeagueState({
      ...state,
      open: true,
      phase: "signup",
      spots: createEmptySpots(),
      groups: emptyGroups(),
      matches: [],
      championSpotId: null,
    });
  }
  return writeSlotLeagueState({
    ...state,
    open: false,
    phase: state.phase === "signup" ? "closed" : state.phase,
  });
}

export async function setSlotLeagueSettings({ title, buyIn } = {}) {
  const state = await getSlotLeagueState();
  return writeSlotLeagueState({
    ...state,
    title:
      title != null
        ? String(title).trim().slice(0, TITLE_MAX_LENGTH) || state.title
        : state.title,
    buyIn:
      buyIn != null ? String(buyIn).trim().slice(0, 40) : state.buyIn,
  });
}

export async function setSlotLeaguePhase(phase) {
  const next = normalizePhase(phase);
  const state = await getSlotLeagueState();
  if (next === "signup") {
    return writeSlotLeagueState({ ...state, open: true, phase: "signup" });
  }
  return writeSlotLeagueState({
    ...state,
    open: next === "closed" ? false : state.open,
    phase: next,
  });
}

export async function resetSlotLeagueSeason() {
  return writeSlotLeagueState({
    ...defaultState(),
    title: (await getSlotLeagueState()).title || "Slot League",
  });
}

export async function claimLeagueSpotForEntry({
  entryId,
  slot,
  allowWhenClosed = false,
} = {}) {
  const id = String(entryId || "").trim();
  if (!id) throw new Error("Entry id is required.");
  const normalizedSlot = normalizeSlot(slot);
  if (!normalizedSlot) throw new Error("Pick a valid Stake slot.");

  const state = await getSlotLeagueState();
  if (!allowWhenClosed && (!state.open || state.phase !== "signup")) {
    throw new Error("League signups are closed.");
  }

  const already = state.spots.find((s) => s.entryId === id);
  if (already) {
    const slug = normalizedSlot.slug;
    if (
      slug &&
      state.spots.some(
        (s) => s.id !== already.id && s.slot?.slug && s.slot.slug === slug
      )
    ) {
      throw new Error("That slot is already claimed.");
    }
    const spots = state.spots.map((s) =>
      s.id === already.id ? { ...s, slot: normalizedSlot } : s
    );
    return writeSlotLeagueState({ ...state, spots });
  }

  if (
    normalizedSlot.slug &&
    state.spots.some((s) => s.slot?.slug === normalizedSlot.slug)
  ) {
    throw new Error("That slot is already claimed.");
  }

  const free = state.spots.find((s) => !s.entryId);
  if (!free) {
    throw new Error("League is full (16/16).");
  }

  const spots = state.spots.map((s) =>
    s.id === free.id ? { ...s, entryId: id, slot: normalizedSlot } : s
  );
  const filled = spots.filter((s) => s.entryId).length;
  let next = { ...state, spots };
  if (filled >= LEAGUE_CAPACITY) {
    next = { ...next, open: false, phase: "signup" };
  }
  return writeSlotLeagueState(next);
}

export async function assignEntryToSpot({ spotId, entryId, slot } = {}) {
  const state = await getSlotLeagueState();
  const sid = String(spotId || "").trim();
  const spot = state.spots.find((s) => s.id === sid);
  if (!spot) throw new Error("Unknown spot.");

  let nextEntryId = spot.entryId;
  if (entryId !== undefined) {
    nextEntryId = entryId != null ? String(entryId).trim() || null : null;
    if (nextEntryId) {
      const taken = state.spots.find(
        (s) => s.entryId === nextEntryId && s.id !== sid
      );
      if (taken) {
        throw new Error("That entrant is already on another spot.");
      }
    }
  }

  let nextSlot = spot.slot;
  if (slot !== undefined) {
    nextSlot = slot ? normalizeSlot(slot) : null;
  }
  if (
    nextSlot?.slug &&
    state.spots.some(
      (s) => s.id !== sid && s.slot?.slug && s.slot.slug === nextSlot.slug
    )
  ) {
    throw new Error("That slot is already claimed.");
  }

  const spots = state.spots.map((s) =>
    s.id === sid ? { ...s, entryId: nextEntryId, slot: nextSlot } : s
  );
  return writeSlotLeagueState({ ...state, spots });
}

export async function setSpotSlot({ spotId, slot } = {}) {
  return assignEntryToSpot({ spotId, slot });
}

export async function releaseLeagueSpotForEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return getSlotLeagueState();
  const state = await getSlotLeagueState();
  const spots = state.spots.map((s) =>
    s.entryId === id ? { ...s, entryId: null, slot: null } : s
  );
  return writeSlotLeagueState({ ...state, spots });
}

export async function clearLeagueSpotAssignments() {
  const state = await getSlotLeagueState();
  return writeSlotLeagueState({
    ...state,
    spots: state.spots.map((s) => ({ ...s, entryId: null, slot: null })),
  });
}

export async function generateLeagueSeason({ force = false } = {}) {
  const state = await getSlotLeagueState();
  const filled = state.spots.filter((s) => s.entryId);
  if (filled.length !== LEAGUE_CAPACITY) {
    throw new Error(
      `Need all ${LEAGUE_CAPACITY} spots filled before generating groups.`
    );
  }
  if (listSeasonMatches(state).length && !force) {
    throw new Error("Group tables already generated. Force to rebuild.");
  }

  const ordered = shuffleInPlace([...filled]);
  const groups = emptyGroups();
  ordered.forEach((spot, i) => {
    const groupId = GROUP_IDS[i % 4];
    groups[groupId].push(spot.id);
  });

  // Align rounds across groups: each group of 4 has 3 matchdays × 2 fixtures.
  const matches = [];
  let index = 0;
  const maxRounds = 3;
  for (let round = 1; round <= maxRounds; round += 1) {
    for (const groupId of GROUP_IDS) {
      const rounds = buildRoundRobinRounds(groups[groupId]);
      const pairs = rounds[round - 1] || [];
      for (const [spotAId, spotBId] of pairs) {
        matches.push({
          id: crypto.randomUUID(),
          stage: "group",
          group: groupId,
          round,
          index,
          spotAId,
          spotBId,
          scoreA: null,
          scoreB: null,
          winnerSpotId: null,
        });
        index += 1;
      }
    }
  }

  return writeSlotLeagueState({
    ...state,
    open: false,
    phase: "season",
    groups,
    matches,
    championSpotId: null,
  });
}

export async function generateLeagueGroups(options = {}) {
  return generateLeagueSeason(options);
}

export async function setLeagueMatchScore({
  matchId,
  scoreA,
  scoreB,
} = {}) {
  const id = String(matchId || "").trim();
  if (!id) throw new Error("Match id is required.");

  const state = await getSlotLeagueState();
  const match = state.matches.find((m) => m.id === id);
  if (!match) throw new Error("Match not found.");

  const updated = {
    ...match,
    scoreA: normalizeScoreValue(scoreA),
    scoreB: normalizeScoreValue(scoreB),
  };
  updated.winnerSpotId = resolveMatchWinner(updated);

  const matches = state.matches.map((m) => (m.id === id ? updated : m));
  const nextState = { ...state, matches };
  const seasonComplete = areSeasonMatchesComplete(nextState);
  let championSpotId = null;
  if (seasonComplete) {
    const winners = [...getGroupWinners(nextState)].sort(
      (a, b) =>
        b.points - a.points ||
        b.diff - a.diff ||
        b.pointsFor - a.pointsFor
    );
    championSpotId = winners[0]?.spotId || null;
  }

  return writeSlotLeagueState({
    ...nextState,
    championSpotId,
    phase: seasonComplete ? "results" : "season",
    open: false,
  });
}

/** No knockout in the 4-table format. */
export async function generateLeagueKnockout() {
  throw new Error(
    "This league uses 4 tables of 4 — no knockout. Score the group fixtures instead."
  );
}

function enrichSpotSlot(slot, catalogBySlug, catalogByName) {
  if (!slot || typeof slot !== "object") return slot || null;
  const slug = String(slot.slug || "").trim().toLowerCase();
  const name = String(slot.name || "").trim().toLowerCase();
  const live =
    (slug && catalogBySlug.get(slug)) ||
    (name && catalogByName.get(name)) ||
    null;
  if (!live) return slot;
  return {
    id: live.id || slot.id || undefined,
    name: live.name || slot.name,
    slug: live.slug || slot.slug || null,
    thumbnailUrl: live.thumbnailUrl || slot.thumbnailUrl || null,
  };
}

export function toPublicLeagueState(
  state,
  { entriesById = new Map(), catalogSlots = [] } = {}
) {
  const standings = computeGroupStandings(state);
  const table = computeLeagueTable(state);
  const seasonMatches = listSeasonMatches(state);
  const playedCount = seasonMatches.filter((m) => isMatchPlayed(m)).length;
  const groupWinners = getGroupWinners(state);
  const catalogBySlug = new Map();
  const catalogByName = new Map();
  for (const item of catalogSlots) {
    const slug = String(item?.slug || "").trim().toLowerCase();
    const name = String(item?.name || "").trim().toLowerCase();
    if (slug) catalogBySlug.set(slug, item);
    if (name) catalogByName.set(name, item);
  }
  const spots = state.spots.map((spot) => {
    const entry = spot.entryId ? entriesById.get(spot.entryId) : null;
    return {
      id: spot.id,
      index: spot.index,
      entryId: spot.entryId,
      username: entry?.username || null,
      isBot: Boolean(entry?.isBot),
      slot: enrichSpotSlot(spot.slot, catalogBySlug, catalogByName),
    };
  });

  return {
    open: state.open,
    phase: state.phase,
    title: state.title,
    buyIn: state.buyIn,
    capacity: state.capacity,
    filled: spots.filter((s) => s.entryId).length,
    spots,
    groups: state.groups,
    table,
    standings,
    groupWinners: groupWinners.map((row) => row.spotId),
    matches: seasonMatches,
    championSpotId: state.championSpotId,
    leaderSpotId: table[0]?.spotId || null,
    matchCount: seasonMatches.length,
    matchesPlayed: playedCount,
    seasonComplete: areSeasonMatchesComplete(state),
    groupsComplete: areSeasonMatchesComplete(state),
    updatedAt: state.updatedAt,
  };
}
