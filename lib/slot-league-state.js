import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slot-league-state.json");
const STATE_KEY = "bj:slot-league";

export const LEAGUE_CAPACITY = 16;
export const GROUP_IDS = ["A", "B", "C", "D"];
export const REGULAR_WEEKS = 10;
export const PHASES = new Set([
  "closed",
  "signup",
  "season",
  "playoffs",
  "results",
  // Legacy phases — normalized below.
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
  if (phase === "groups") return "season";
  if (phase === "knockout") return "playoffs";
  if (
    phase === "season" ||
    phase === "playoffs" ||
    phase === "results" ||
    phase === "signup" ||
    phase === "closed"
  ) {
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
  // Legacy in-group fixtures become weekly cross-group season games.
  if (stage === "group" || stage === "league") stage = "week";
  if (!["week", "qf", "sf", "final"].includes(stage)) return null;
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
    stage,
    group: null,
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
    .slice(0, 160);
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

/** Random pairing of all filled spots into weekly fixtures (cross-group OK). */
function buildRandomWeekPairs(spotIds) {
  const ids = shuffleInPlace([...spotIds]);
  const pairs = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    pairs.push([ids[i], ids[i + 1]]);
  }
  return pairs;
}

export function listSeasonMatches(state) {
  return (state?.matches || []).filter((m) => m.stage === "week");
}

export function listPlayoffMatches(state) {
  return (state?.matches || []).filter((m) =>
    ["qf", "sf", "final"].includes(m.stage)
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

function applyMatchToRow(row, scoredFor, scoredAgainst, result) {
  row.played += 1;
  row.pointsFor += scoredFor;
  row.pointsAgainst += scoredAgainst;
  if (result === "win") {
    row.wins += 1;
    row.points += POINTS_WIN;
  } else if (result === "loss") {
    row.losses += 1;
  } else {
    row.draws += 1;
    row.points += POINTS_DRAW;
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

/**
 * Four tables of four. Weekly fixtures can be cross-group; each player's
 * results still count on their own group table.
 */
export function computeGroupStandings(state) {
  const standings = {};
  const rowBySpot = new Map();
  for (const groupId of GROUP_IDS) {
    const spotIds = state.groups?.[groupId] || [];
    const rows = spotIds.map((spotId) => emptyTableRow(spotId, groupId));
    standings[groupId] = rows;
    for (const row of rows) rowBySpot.set(row.spotId, row);
  }

  for (const match of listSeasonMatches(state)) {
    if (!isMatchPlayed(match)) continue;
    const a = rowBySpot.get(match.spotAId);
    const b = rowBySpot.get(match.spotBId);
    if (!a || !b) continue;
    const scoreA = parseComparableScore(match.scoreA) ?? 0;
    const scoreB = parseComparableScore(match.scoreB) ?? 0;
    if (scoreA > scoreB) {
      applyMatchToRow(a, scoreA, scoreB, "win");
      applyMatchToRow(b, scoreB, scoreA, "loss");
    } else if (scoreB > scoreA) {
      applyMatchToRow(b, scoreB, scoreA, "win");
      applyMatchToRow(a, scoreA, scoreB, "loss");
    } else {
      applyMatchToRow(a, scoreA, scoreB, "draw");
      applyMatchToRow(b, scoreB, scoreA, "draw");
    }
  }

  for (const groupId of GROUP_IDS) {
    for (const row of standings[groupId]) {
      row.diff = row.pointsFor - row.pointsAgainst;
    }
    standings[groupId] = sortTableRows(standings[groupId]);
  }
  return standings;
}

/** Flat combined ranking across all groups. */
export function computeLeagueTable(state) {
  const standings = computeGroupStandings(state);
  const rows = GROUP_IDS.flatMap((groupId) => standings[groupId] || []);
  return sortTableRows(rows.map(({ position, ...rest }) => rest));
}

export function areSeasonMatchesComplete(state) {
  const matches = listSeasonMatches(state);
  if (matches.length < REGULAR_WEEKS * (LEAGUE_CAPACITY / 2)) return false;
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

/** Top 2 from each group, then seeded 1–8 by points (then GD, PF). */
export function pickPlayoffSeeds(state) {
  const standings = computeGroupStandings(state);
  const qualifiers = [];
  for (const groupId of GROUP_IDS) {
    const rows = standings[groupId] || [];
    if (rows.length < 2) {
      throw new Error(`Group ${groupId} needs at least 2 players for playoffs.`);
    }
    qualifiers.push(rows[0], rows[1]);
  }
  qualifiers.sort(
    (a, b) =>
      b.points - a.points ||
      b.diff - a.diff ||
      b.pointsFor - a.pointsFor ||
      a.spotId.localeCompare(b.spotId)
  );
  return qualifiers.map((row, index) => ({
    ...row,
    seed: index + 1,
  }));
}

function advancePlayoffBracket(matches) {
  const next = matches.map((m) => ({ ...m }));
  const byKey = (stage, index) =>
    next.find((m) => m.stage === stage && m.index === index);

  for (const [sfIndex, qfA, qfB] of [
    [0, 0, 1],
    [1, 2, 3],
  ]) {
    const sf = byKey("sf", sfIndex);
    const left = byKey("qf", qfA);
    const right = byKey("qf", qfB);
    if (!sf || !left || !right) continue;
    sf.spotAId = left.winnerSpotId || null;
    sf.spotBId = right.winnerSpotId || null;
    if (!sf.spotAId || !sf.spotBId) {
      sf.scoreA = null;
      sf.scoreB = null;
      sf.winnerSpotId = null;
    } else {
      sf.winnerSpotId = resolveMatchWinner(sf);
    }
  }

  const final = byKey("final", 0);
  const sf0 = byKey("sf", 0);
  const sf1 = byKey("sf", 1);
  if (final && sf0 && sf1) {
    final.spotAId = sf0.winnerSpotId || null;
    final.spotBId = sf1.winnerSpotId || null;
    if (!final.spotAId || !final.spotBId) {
      final.scoreA = null;
      final.scoreB = null;
      final.winnerSpotId = null;
    } else {
      final.winnerSpotId = resolveMatchWinner(final);
    }
  }
  return next;
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

/** Clear the 16 spots/fixtures and reopen signups for a fresh roster of slots. */
export async function resetLeagueRoster() {
  const state = await getSlotLeagueState();
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

function buildWeekMatches(spotIds, week, startIndex = 0) {
  const pairs = buildRandomWeekPairs(spotIds);
  return pairs.map(([spotAId, spotBId], offset) => ({
    id: crypto.randomUUID(),
    stage: "week",
    group: null,
    round: week,
    index: startIndex + offset,
    spotAId,
    spotBId,
    scoreA: null,
    scoreB: null,
    winnerSpotId: null,
  }));
}

export async function generateLeagueSeason({ force = false } = {}) {
  const state = await getSlotLeagueState();
  const filled = state.spots.filter((s) => s.entryId);
  if (filled.length !== LEAGUE_CAPACITY) {
    throw new Error(
      `Need all ${LEAGUE_CAPACITY} spots filled before starting the season.`
    );
  }
  if (listSeasonMatches(state).length && !force) {
    throw new Error("Season already generated. Force to rebuild.");
  }

  const ordered = shuffleInPlace([...filled]);
  const groups = emptyGroups();
  ordered.forEach((spot, i) => {
    groups[GROUP_IDS[i % 4]].push(spot.id);
  });

  const spotIds = ordered.map((s) => s.id);
  const matches = [];
  let index = 0;
  for (let week = 1; week <= REGULAR_WEEKS; week += 1) {
    const weekMatches = buildWeekMatches(spotIds, week, index);
    matches.push(...weekMatches);
    index += weekMatches.length;
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

/** Re-roll random cross-group pairings for one regular-season week. */
export async function randomizeWeekMatchups(week, { force = false } = {}) {
  const weekNum = Math.floor(Number(week));
  if (!Number.isFinite(weekNum) || weekNum < 1 || weekNum > REGULAR_WEEKS) {
    throw new Error(`Week must be between 1 and ${REGULAR_WEEKS}.`);
  }

  const state = await getSlotLeagueState();
  const filled = state.spots.filter((s) => s.entryId);
  if (filled.length !== LEAGUE_CAPACITY) {
    throw new Error(`Need all ${LEAGUE_CAPACITY} spots filled.`);
  }
  if (!Object.values(state.groups).some((ids) => ids.length)) {
    throw new Error("Generate the season (groups) before randomizing weeks.");
  }

  const existingWeek = listSeasonMatches(state).filter((m) => m.round === weekNum);
  if (existingWeek.some((m) => isMatchPlayed(m)) && !force) {
    throw new Error(
      `Week ${weekNum} already has scored matches. Force to rebuild.`
    );
  }

  const playoffs = listPlayoffMatches(state);
  if (playoffs.length) {
    throw new Error("Playoffs already started. Reset season to change weeks.");
  }

  const otherWeeks = listSeasonMatches(state).filter((m) => m.round !== weekNum);
  const startIndex =
    otherWeeks.reduce((max, m) => Math.max(max, m.index), -1) + 1;
  const weekMatches = buildWeekMatches(
    filled.map((s) => s.id),
    weekNum,
    startIndex
  );

  return writeSlotLeagueState({
    ...state,
    open: false,
    phase: "season",
    matches: [...otherWeeks, ...weekMatches, ...playoffs].sort(
      (a, b) => a.round - b.round || a.index - b.index
    ),
    championSpotId: null,
  });
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

  if (
    ["qf", "sf", "final"].includes(updated.stage) &&
    isMatchPlayed(updated) &&
    !updated.winnerSpotId
  ) {
    throw new Error("Playoff matches need a winner — draws are not allowed.");
  }

  let matches = state.matches.map((m) => (m.id === id ? updated : m));
  if (["qf", "sf", "final"].includes(updated.stage)) {
    matches = advancePlayoffBracket(matches);
  }

  const nextState = { ...state, matches };
  const final = matches.find((m) => m.stage === "final");
  const championSpotId = final?.winnerSpotId || null;
  let phase = state.phase;
  if (championSpotId) {
    phase = "results";
  } else if (listPlayoffMatches(nextState).length) {
    phase = "playoffs";
  } else if (listSeasonMatches(nextState).length) {
    phase = "season";
  }

  return writeSlotLeagueState({
    ...nextState,
    championSpotId,
    phase,
    open: false,
  });
}

/** Top 2 from each group → QF/SF/Final, seeded by points. */
export async function generateLeagueKnockout({ force = false } = {}) {
  const state = await getSlotLeagueState();
  if (!areSeasonMatchesComplete(state) && !force) {
    throw new Error(
      `Finish all ${REGULAR_WEEKS} weeks before generating playoffs.`
    );
  }
  if (listPlayoffMatches(state).length && !force) {
    throw new Error("Playoffs already generated. Force to rebuild.");
  }

  const seeds = pickPlayoffSeeds(state);
  // 1v8, 4v5, 2v7, 3v6
  const qfPairs = [
    [seeds[0], seeds[7]],
    [seeds[3], seeds[4]],
    [seeds[1], seeds[6]],
    [seeds[2], seeds[5]],
  ];

  const weekMatches = listSeasonMatches(state);
  const knockout = [];
  qfPairs.forEach(([a, b], index) => {
    knockout.push({
      id: crypto.randomUUID(),
      stage: "qf",
      group: null,
      round: 1,
      index,
      spotAId: a.spotId,
      spotBId: b.spotId,
      scoreA: null,
      scoreB: null,
      winnerSpotId: null,
    });
  });
  for (let index = 0; index < 2; index += 1) {
    knockout.push({
      id: crypto.randomUUID(),
      stage: "sf",
      group: null,
      round: 2,
      index,
      spotAId: null,
      spotBId: null,
      scoreA: null,
      scoreB: null,
      winnerSpotId: null,
    });
  }
  knockout.push({
    id: crypto.randomUUID(),
    stage: "final",
    group: null,
    round: 3,
    index: 0,
    spotAId: null,
    spotBId: null,
    scoreA: null,
    scoreB: null,
    winnerSpotId: null,
  });

  return writeSlotLeagueState({
    ...state,
    open: false,
    phase: "playoffs",
    matches: [...weekMatches, ...knockout],
    championSpotId: null,
  });
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
  const playoffMatches = listPlayoffMatches(state);
  const playedCount = seasonMatches.filter((m) => isMatchPlayed(m)).length;
  const groupWinners = getGroupWinners(state);
  let playoffSeeds = [];
  try {
    if (areSeasonMatchesComplete(state) || playoffMatches.length) {
      playoffSeeds = pickPlayoffSeeds(state);
    }
  } catch {
    playoffSeeds = [];
  }
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

  const spotGroup = new Map();
  for (const groupId of GROUP_IDS) {
    for (const spotId of state.groups?.[groupId] || []) {
      spotGroup.set(spotId, groupId);
    }
  }

  return {
    open: state.open,
    phase: state.phase,
    title: state.title,
    buyIn: state.buyIn,
    capacity: state.capacity,
    regularWeeks: REGULAR_WEEKS,
    filled: spots.filter((s) => s.entryId).length,
    spots: spots.map((spot) => ({
      ...spot,
      group: spotGroup.get(spot.id) || null,
    })),
    groups: state.groups,
    table,
    standings,
    groupWinners: groupWinners.map((row) => row.spotId),
    playoffSeeds: playoffSeeds.map((row) => ({
      spotId: row.spotId,
      seed: row.seed,
      group: row.group,
      points: row.points,
      diff: row.diff,
    })),
    matches: [...seasonMatches, ...playoffMatches],
    weekMatches: seasonMatches,
    playoffMatches,
    championSpotId: state.championSpotId,
    leaderSpotId: table[0]?.spotId || null,
    matchCount: seasonMatches.length + playoffMatches.length,
    matchesPlayed:
      playedCount + playoffMatches.filter((m) => isMatchPlayed(m)).length,
    weeksPlayed: Array.from({ length: REGULAR_WEEKS }, (_, i) => i + 1).filter(
      (week) => {
        const weekGames = seasonMatches.filter((m) => m.round === week);
        return weekGames.length > 0 && weekGames.every((m) => isMatchPlayed(m));
      }
    ).length,
    seasonComplete: areSeasonMatchesComplete(state),
    groupsComplete: areSeasonMatchesComplete(state),
    updatedAt: state.updatedAt,
  };
}
