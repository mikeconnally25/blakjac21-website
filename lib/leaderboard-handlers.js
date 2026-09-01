const SPREADSHEET_ID = "1wPakSQJBBbAQNEQxPVQWdj1uRbY86bRIUCxde_114_g";
const SHEET_GID = "2077816179";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;
const CACHE_TTL_MS = 1000;
const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPayload = null;
let cachedAt = 0;
let cachedRoster = null;
let cachedRosterAt = 0;
let inFlight = null;
let rosterInFlight = null;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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

function mapAffiliateRow(row, index) {
  const cells = row.c || [];

  return {
    rank: Number(cellValue(cells[4])) || index + 1,
    username: String(cellValue(cells[2]) || "").trim(),
    wagered: Number(cellValue(cells[3])) || 0,
    wageredLabel: cellLabel(cells[3]),
  };
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
  const now = Date.now();
  if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    return cachedPayload;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    const roster = await fetchAffiliateRoster();
    const payload = {
      entries: roster.entries.slice(0, limit),
      periodStart: roster.periodStart,
      periodEnd: roster.periodEnd,
      signature: String(roster.entries.length),
      updatedAt: roster.updatedAt,
    };

    cachedPayload = payload;
    cachedAt = Date.now();
    return payload;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function handleLeaderboardGet(req, res) {
  try {
    const data = await fetchLeaderboardTop(10);
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load leaderboard." });
  }
}
