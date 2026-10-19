const SPREADSHEET_ID = "1wPakSQJBBbAQNEQxPVQWdj1uRbY86bRIUCxde_114_g";
const SHEET_GID = "2077816179";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;
const ROSTER_CACHE_TTL_MS = 60 * 1000;
const ROSTER_REDIS_KEY = "bj:leaderboard-roster";
const LEADERBOARD_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

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

function sendJson(res, statusCode, payload, cacheControl = "no-store") {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(payload));
}

function parseGvizResponse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Invalid leaderboard response.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function cellValue(cell) {
  if (!cell) {
    return null;
  }

  if (cell.v !== null && cell.v !== undefined) {
    return cell.v;
  }

  return cell.f ?? null;
}

function cellLabel(cell) {
  if (!cell) {
    return "";
  }

  return cell.f ?? String(cell.v ?? "");
}

const SHEET_MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Sheet dates are Eastern wall times, including a trailing "12:00 am". */
export function parseLeaderboardSheetDate(value, timeZone = "America/New_York") {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m))?/i);
  if (!match) return null;
  const month = SHEET_MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;

  const day = Number(match[1]);
  const year = 2000 + Number(match[3]);
  let hour = 0;
  let minute = 0;
  if (match[4]) {
    hour = Number(match[4]) % 12;
    if (String(match[6]).toLowerCase() === "pm") hour += 12;
    minute = Number(match[5]);
  }

  const utcDate = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcDate)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(utcDate.getTime() - (asUTC - utcDate.getTime()));
}

function mapAffiliateRow(row, index) {
  const cells = row.c || [];

  return {
    rank: Number(cellValue(cells[4])) || index + 1,
    username: String(cellValue(cells[2]) || "").trim(),
    wagered: Number(cellValue(cells[3])) || 0,
    wageredLabel: cellLabel(cells[3]),
  };
}

function rosterAgeMs(roster) {
  const stamped = Date.parse(roster?.updatedAt || "");
  if (!Number.isFinite(stamped)) {
    return Number.POSITIVE_INFINITY;
  }
  return Date.now() - stamped;
}

function rememberRoster(roster) {
  cachedRoster = roster;
  const stamped = Date.parse(roster?.updatedAt || "");
  cachedRosterAt = Number.isFinite(stamped) ? stamped : Date.now();
  return roster;
}

async function readSharedRoster() {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const result = await redisCommand(config, ["GET", ROSTER_REDIS_KEY]);
    if (result === null || result === undefined) return null;
    const roster = typeof result === "string" ? JSON.parse(result) : result;
    if (!roster || !Array.isArray(roster.entries)) return null;
    if (rosterAgeMs(roster) >= ROSTER_CACHE_TTL_MS) return null;
    return roster;
  } catch {
    return null;
  }
}

async function writeSharedRoster(roster) {
  const config = getRedisConfig();
  if (!config) return;

  try {
    await redisCommand(config, [
      "SET",
      ROSTER_REDIS_KEY,
      JSON.stringify(roster),
      "EX",
      String(Math.ceil(ROSTER_CACHE_TTL_MS / 1000)),
    ]);
  } catch {
    // The in-memory copy still serves this instance.
  }
}

export async function fetchAffiliateRoster() {
  const now = Date.now();
  if (cachedRoster && now - cachedRosterAt < ROSTER_CACHE_TTL_MS) {
    return cachedRoster;
  }

  if (rosterInFlight) {
    return rosterInFlight;
  }

  rosterInFlight = (async () => {
    const shared = await readSharedRoster();
    if (shared) {
      return rememberRoster(shared);
    }

    const response = await fetch(SHEET_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Could not load affiliate roster.");
    }

    const text = await response.text();
    const data = parseGvizResponse(text);
    const rows = data.table?.rows || [];
    const entries = rows
      .map((row, index) => mapAffiliateRow(row, index))
      .filter((entry) => entry.username);

    const firstRow = rows[0]?.c || [];
    const roster = {
      entries,
      periodStart: cellLabel(firstRow[5]) || null,
      periodEnd: cellLabel(firstRow[6]) || null,
      updatedAt: new Date().toISOString(),
    };

    rememberRoster(roster);
    await writeSharedRoster(roster);
    return roster;
  })();

  try {
    return await rosterInFlight;
  } finally {
    rosterInFlight = null;
  }
}

export async function isStakeUsernameOnAffiliateCode(stakeUsername) {
  const target = String(stakeUsername || "").trim().toLowerCase();
  if (!target) {
    return false;
  }

  const roster = await fetchAffiliateRoster();
  return roster.entries.some(
    (entry) => entry.username.toLowerCase() === target
  );
}

export async function fetchLeaderboardTop(limit = 10) {
  const roster = await fetchAffiliateRoster();
  return {
    entries: roster.entries.slice(0, limit),
    periodStart: roster.periodStart,
    periodEnd: roster.periodEnd,
    signature: String(roster.entries.length),
    updatedAt: roster.updatedAt,
  };
}

export async function handleLeaderboardGet(req, res) {
  try {
    const data = await fetchLeaderboardTop(10);
    sendJson(res, 200, data, LEADERBOARD_CACHE_CONTROL);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load leaderboard." });
  }
}
