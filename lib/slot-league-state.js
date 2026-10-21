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
  "groups",
  "knockout",
  "results",
]);
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
  const stage = String(raw.stage || "").trim().toLowerCase();
  if (!["group", "qf", "sf", "final"].includes(stage)) return null;
  const groupRaw = String(raw.group || "").trim().toUpperCase();
  const group =
    stage === "group" && GROUP_IDS.includes(groupRaw) ? groupRaw : null;
  const round = Math.max(1, Math.floor(Number(raw.round) || 1));
  const index = Math.max(0, Math.floor(Number(raw.index) || 0));
  return {
    id: String(raw.id || "").trim() || crypto.randomUUID(),
    stage,
    group,
    round,
    index,
    spotAId: String(raw.spotAId || "").trim() || null,
    spotBId: String(raw.spotBId || "").trim() || null,
    scoreA: normalizeScoreValue(raw.scoreA),
    scoreB: normalizeScoreValue(raw.scoreB),
    winnerSpotId: String(raw.winnerSpotId || "").trim() || null,
  };
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

function buildRoundRobinPairs(spotIds) {
  const ids = [...spotIds];
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push([ids[i], ids[j]]);
    }
  }
  return pairs;
}

export function computeGroupStandings(state) {
  const spotById = new Map(state.spots.map((s) => [s.id, s]));
  const standings = {};
  for (const groupId of GROUP_IDS) {
    const spotIds = state.groups[groupId] || [];
    const rows = spotIds.map((spotId) => ({
      spotId,
      group: groupId,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
    }));
    const bySpot = new Map(rows.map((r) => [r.spotId, r]));
    for (const match of state.matches) {
      if (match.stage !== "group" || match.group !== groupId) continue;
      if (!match.winnerSpotId) continue;
      const a = bySpot.get(match.spotAId);
      const b = bySpot.get(match.spotBId);
      if (!a || !b) continue;
      const scoreA = parseComparableScore(match.scoreA) ?? 0;
      const scoreB = parseComparableScore(match.scoreB) ?? 0;
      a.played += 1;
      b.played += 1;
      a.pointsFor += scoreA;
      a.pointsAgainst += scoreB;
      b.pointsFor += scoreB;
      b.pointsAgainst += scoreA;
      if (match.winnerSpotId === a.spotId) {
        a.wins += 1;
        b.losses += 1;
      } else if (match.winnerSpotId === b.spotId) {
        b.wins += 1;
        a.losses += 1;
      }
    }
    for (const row of rows) {
      row.diff = row.pointsFor - row.pointsAgainst;
      row.spot = spotById.get(row.spotId) || null;
    }
    rows.sort((x, y) => y.wins - x.wins || y.diff - x.diff || x.spotId.localeCompare(y.spotId));
    standings[groupId] = rows;
  }
  return standings;
}

export function pickKnockoutSeeds(state) {
  const standings = computeGroupStandings(state);
  const winners = [];
  const remaining = [];
  for (const groupId of GROUP_IDS) {
    const rows = standings[groupId] || [];
    if (!rows.length) continue;
    winners.push(rows[0]);
    remaining.push(...rows.slice(1));
  }
  winners.sort((a, b) => b.wins - a.wins || b.diff - a.diff);
  remaining.sort((a, b) => b.wins - a.wins || b.diff - a.diff);
  const wildcards = remaining.slice(0, 4);
  if (winners.length < 4 || wildcards.length < 4) {
    throw new Error(
      "Need all 4 group winners and 4 wildcards before knockout. Finish group matches first."
    );
  }
  // Seeds 1-4 winners, 5-8 wildcards → QF 1v8, 4v5, 2v7, 3v6
  const seeds = [
    winners[0],
    winners[1],
    winners[2],
    winners[3],
    wildcards[0],
    wildcards[1],
    wildcards[2],
    wildcards[3],
  ];
  return {
    standings,
    seeds,
    qfPairs: [
      [seeds[0], seeds[7]],
      [seeds[3], seeds[4]],
      [seeds[1], seeds[6]],
      [seeds[2], seeds[5]],
    ],
  };
}

export function areGroupMatchesComplete(state) {
  const groupMatches = state.matches.filter((m) => m.stage === "group");
  if (groupMatches.length < 24) return false;
  return groupMatches.every((m) => Boolean(m.winnerSpotId));
}

function advanceKnockoutBracket(matches) {
  const next = matches.map((m) => ({ ...m }));
  const byKey = (stage, index) =>
    next.find((m) => m.stage === stage && m.index === index);

  // QF 0,1 → SF 0; QF 2,3 → SF 1
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

export async function generateLeagueGroups({ force = false } = {}) {
  const state = await getSlotLeagueState();
  const filled = state.spots.filter((s) => s.entryId);
  if (filled.length !== LEAGUE_CAPACITY) {
    throw new Error(`Need all ${LEAGUE_CAPACITY} spots filled before groups.`);
  }
  if (state.matches.some((m) => m.stage === "group") && !force) {
    throw new Error("Groups already generated. Force to rebuild.");
  }

  const ordered = shuffleInPlace([...filled]);
  const groups = emptyGroups();
  ordered.forEach((spot, i) => {
    const groupId = GROUP_IDS[i % 4];
    groups[groupId].push(spot.id);
  });

  const matches = [];
  let index = 0;
  for (const groupId of GROUP_IDS) {
    const pairs = buildRoundRobinPairs(groups[groupId]);
    for (const [spotAId, spotBId] of pairs) {
      matches.push({
        id: crypto.randomUUID(),
        stage: "group",
        group: groupId,
        round: 1,
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

  return writeSlotLeagueState({
    ...state,
    open: false,
    phase: "groups",
    groups,
    matches,
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

  let matches = state.matches.map((m) => (m.id === id ? updated : m));
  if (["qf", "sf", "final"].includes(updated.stage)) {
    matches = advanceKnockoutBracket(matches);
  }

  const final = matches.find((m) => m.stage === "final");
  const championSpotId = final?.winnerSpotId || null;
  let phase = state.phase;
  if (championSpotId) {
    phase = "results";
  } else if (matches.some((m) => m.stage === "qf")) {
    phase = "knockout";
  } else if (matches.some((m) => m.stage === "group")) {
    phase = "groups";
  }

  return writeSlotLeagueState({
    ...state,
    matches,
    championSpotId,
    phase,
  });
}

export async function generateLeagueKnockout({ force = false } = {}) {
  const state = await getSlotLeagueState();
  if (!force && !areGroupMatchesComplete(state)) {
    throw new Error("Finish all group matches before knockout.");
  }
  if (state.matches.some((m) => m.stage === "qf") && !force) {
    throw new Error("Knockout already generated. Force to rebuild.");
  }

  const { qfPairs } = pickKnockoutSeeds(state);
  const groupMatches = state.matches.filter((m) => m.stage === "group");
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
    phase: "knockout",
    matches: [...groupMatches, ...knockout],
    championSpotId: null,
  });
}

export function toPublicLeagueState(state, { entriesById = new Map() } = {}) {
  const standings = computeGroupStandings(state);
  const spots = state.spots.map((spot) => {
    const entry = spot.entryId ? entriesById.get(spot.entryId) : null;
    return {
      id: spot.id,
      index: spot.index,
      entryId: spot.entryId,
      username: entry?.username || null,
      isBot: Boolean(entry?.isBot),
      slot: spot.slot,
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
    standings,
    matches: state.matches,
    championSpotId: state.championSpotId,
    groupsComplete: areGroupMatchesComplete(state),
    updatedAt: state.updatedAt,
  };
}
