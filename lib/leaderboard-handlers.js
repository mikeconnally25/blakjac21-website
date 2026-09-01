const SPREADSHEET_ID = "1wPakSQJBBbAQNEQxPVQWdj1uRbY86bRIUCxde_114_g";
const SHEET_GID = "2077816179";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
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

export async function fetchLeaderboardTop(limit = 10) {
  const response = await fetch(SHEET_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not load leaderboard data.");
  }

  const text = await response.text();
  const data = parseGvizResponse(text);
  const rows = data.table?.rows || [];

  const entries = rows.slice(0, limit).map((row, index) => {
    const cells = row.c || [];

    return {
      rank: Number(cellValue(cells[4])) || index + 1,
      username: String(cellValue(cells[2]) || "").trim(),
      wagered: Number(cellValue(cells[3])) || 0,
      wageredLabel: cellLabel(cells[3]),
    };
  });

  const firstRow = rows[0]?.c || [];

  return {
    entries,
    periodStart: cellLabel(firstRow[5]) || null,
    periodEnd: cellLabel(firstRow[6]) || null,
    updatedAt: new Date().toISOString(),
  };
}

export async function handleLeaderboardGet(req, res) {
  try {
    const data = await fetchLeaderboardTop(10);
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load leaderboard." });
  }
}
