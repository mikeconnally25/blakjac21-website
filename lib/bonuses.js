import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const BONUSES_FILE = path.join(DATA_DIR, "bonus-hunt.json");
const PAST_HUNTS_FILE = path.join(DATA_DIR, "past-hunts.json");
const BONUSES_KEY = "bh:bonuses";
const PAST_HUNTS_KEY = "bh:past-hunts";
const MAX_PAST_HUNTS = 50;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeBonus(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const slot = String(raw.slot || "").trim();
  const bet = Number(raw.bet);
  const payout =
    raw.payout === null || raw.payout === undefined || raw.payout === ""
      ? null
      : Number(raw.payout);

  if (!slot || !Number.isFinite(bet) || bet < 0) {
    return null;
  }

  if (payout !== null && (!Number.isFinite(payout) || payout < 0)) {
    return null;
  }

  const slotSlug = String(raw.slotSlug || "").trim().toLowerCase() || null;
  const provider = String(raw.provider || "").trim() || null;
  const thumbnailUrl = String(raw.thumbnailUrl || "").trim() || null;
  const requestedBy = String(raw.requestedBy || "").trim() || null;

  return {
    id: raw.id || crypto.randomUUID(),
    slot,
    slotSlug,
    provider,
    thumbnailUrl,
    requestedBy,
    bet: Number(bet.toFixed(2)),
    payout: payout === null ? null : Number(payout.toFixed(2)),
    status: payout === null ? "pending" : "opened",
    superBonus: Boolean(raw.superBonus),
    epicBonus: Boolean(raw.epicBonus),
    addedAt: raw.addedAt || new Date().toISOString(),
    openedAt: payout === null ? null : raw.openedAt || new Date().toISOString(),
  };
}

function normalizeStore(raw) {
  const bonuses = Array.isArray(raw?.bonuses) ? raw.bonuses : [];
  const title = String(raw?.title || "Live Hunt").trim() || "Live Hunt";
  const startBalance = Number(raw?.startBalance);

  return {
    title,
    startBalance: Number.isFinite(startBalance) && startBalance >= 0
      ? Number(startBalance.toFixed(2))
      : 0,
    showHighestMulti: Boolean(raw?.showHighestMulti),
    bonuses,
  };
}

function buildHuntStatus(bonuses) {
  if (!bonuses.length) {
    return "collecting";
  }

  const pendingCount = bonuses.filter((bonus) => bonus.status === "pending").length;
  if (pendingCount === bonuses.length) {
    return "collecting";
  }

  if (pendingCount > 0) {
    return "opening";
  }

  return "complete";
}

function sortBonuses(bonuses) {
  return [...bonuses].sort(
    (a, b) => new Date(a.addedAt) - new Date(b.addedAt)
  );
}

function toPublicBonus(bonus, index) {
  const multiplier =
    bonus.status === "opened" && bonus.bet > 0
      ? Number(((bonus.payout ?? 0) / bonus.bet).toFixed(2))
      : null;

  return {
    id: bonus.id,
    number: index + 1,
    slot: bonus.slot,
    slotSlug: bonus.slotSlug || null,
    provider: bonus.provider || null,
    thumbnailUrl: bonus.thumbnailUrl || null,
    requestedBy: bonus.requestedBy || null,
    bet: bonus.bet,
    payout: bonus.payout,
    multiplier,
    status: bonus.status,
    superBonus: Boolean(bonus.superBonus),
    epicBonus: Boolean(bonus.epicBonus),
    addedAt: bonus.addedAt,
    openedAt: bonus.openedAt,
  };
}

function findHighestMulti(bonuses) {
  const opened = bonuses.filter(
    (bonus) =>
      bonus.status === "opened" &&
      Number(bonus.bet) > 0 &&
      bonus.payout !== null &&
      bonus.payout !== undefined
  );

  if (!opened.length) {
    return null;
  }

  const ranked = opened
    .map((bonus) => ({
      slot: bonus.slot,
      bet: Number(bonus.bet),
      payout: Number(bonus.payout ?? 0),
      multiplier: Number(((bonus.payout ?? 0) / bonus.bet).toFixed(2)),
      requestedBy: String(bonus.requestedBy || "").trim() || null,
    }))
    .sort((a, b) => b.multiplier - a.multiplier);

  return ranked[0] || null;
}

function buildSummary(bonuses, { startBalance = 0 } = {}) {
  const totalBonuses = bonuses.length;
  const totalCost = bonuses.reduce((sum, bonus) => sum + bonus.bet, 0);
  const opened = bonuses.filter((bonus) => bonus.status === "opened");
  const pending = bonuses.filter((bonus) => bonus.status === "pending");
  const totalWon = opened.reduce(
    (sum, bonus) => sum + (bonus.payout ?? 0),
    0
  );
  const pendingBetTotal = pending.reduce((sum, bonus) => sum + bonus.bet, 0);
  const pendingCount = pending.length;
  const normalizedStart =
    Number.isFinite(Number(startBalance)) && Number(startBalance) >= 0
      ? Number(startBalance)
      : 0;

  // Required average X to recover start cost:
  // each remaining bet pays (bet × X), so
  // X = (startBalance − winnings so far) / remaining bet total.
  // e.g. need $800 more with $8 left in bets → 100x.
  const amountStillNeeded = normalizedStart - totalWon;

  let breakevenX = null;
  if (pendingBetTotal > 0) {
    breakevenX = Math.max(0, amountStillNeeded) / pendingBetTotal;
  }

  const openedWithMultiplier = opened.filter(
    (bonus) => bonus.bet > 0 && bonus.payout !== null
  );
  const runAverageX =
    openedWithMultiplier.length > 0
      ? openedWithMultiplier.reduce(
          (sum, bonus) => sum + (bonus.payout ?? 0) / bonus.bet,
          0
        ) / openedWithMultiplier.length
      : null;
  const totalX =
    openedWithMultiplier.length > 0
      ? openedWithMultiplier.reduce(
          (sum, bonus) => sum + (bonus.payout ?? 0) / bonus.bet,
          0
        )
      : null;
  const avgBet = totalBonuses > 0 ? totalCost / totalBonuses : null;
  const curAvg = opened.length > 0 ? totalWon / opened.length : null;

  // Hunt profit vs starting balance: begins at -start, then moves with wins and buys.
  const profit = totalWon - totalCost - normalizedStart;
  // Live tracker P/L: start cost − winnings.
  const profitLoss = normalizedStart - totalWon;

  return {
    totalBonuses,
    openedCount: opened.length,
    pendingCount,
    totalCost: Number(totalCost.toFixed(2)),
    totalWon: Number(totalWon.toFixed(2)),
    avgBet: avgBet === null ? null : Number(avgBet.toFixed(2)),
    curAvg: curAvg === null ? null : Number(curAvg.toFixed(2)),
    totalX: totalX === null ? null : Number(totalX.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    profitLoss: Number(profitLoss.toFixed(2)),
    pendingBetTotal: Number(pendingBetTotal.toFixed(2)),
    amountStillNeeded: Number(Math.max(0, amountStillNeeded).toFixed(2)),
    runAverageX:
      runAverageX === null ? null : Number(runAverageX.toFixed(2)),
    breakevenX:
      breakevenX === null ? null : Number(breakevenX.toFixed(2)),
    highestMulti: findHighestMulti(bonuses),
  };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${BONUSES_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return normalizeStore({ bonuses: [] });
  }

  try {
    const parsed = JSON.parse(data.result);
    return normalizeStore(parsed);
  } catch {
    return normalizeStore({ bonuses: [] });
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${BONUSES_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(BONUSES_FILE);
  } catch {
    await fs.writeFile(
      BONUSES_FILE,
      JSON.stringify(normalizeStore({ bonuses: [] }), null, 2)
    );
  }

  const raw = await fs.readFile(BONUSES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeStore(parsed);
}

async function writeFileStore(store) {
  await fs.writeFile(BONUSES_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return normalizeStore(redisStore);
  }

  if (process.env.VERCEL === "1") {
    return normalizeStore({ bonuses: [] });
  }

  return readFileStore();
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (getRedisConfig()) {
    const saved = await writeRedisStore(normalized);
    if (!saved) {
      throw new Error("Could not save bonus hunt to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Bonus hunt needs shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(normalized);
}

export async function getBonusHunt() {
  const store = await readStore();
  const bonuses = sortBonuses(store.bonuses);

  return {
    hunt: {
      title: store.title,
      startBalance: store.startBalance,
      showHighestMulti: Boolean(store.showHighestMulti),
      status: buildHuntStatus(bonuses),
    },
    bonuses: bonuses.map(toPublicBonus),
    summary: buildSummary(bonuses, { startBalance: store.startBalance }),
  };
}

export async function addBonus({
  slot,
  bet,
  slotSlug,
  thumbnailUrl,
  provider,
  requestedBy,
}) {
  const bonus = normalizeBonus({
    slot,
    bet,
    slotSlug,
    thumbnailUrl,
    provider,
    requestedBy,
  });
  if (!bonus) {
    throw new Error("Enter a valid slot name and bet amount.");
  }

  const store = await readStore();
  store.bonuses.push(bonus);
  await writeStore(store);

  const sorted = sortBonuses(store.bonuses);
  const index = sorted.findIndex((entry) => entry.id === bonus.id);
  return toPublicBonus(sorted[index], index);
}

export async function updateBonusPayout({ id, payout, superBonus, epicBonus }) {
  const store = await readStore();
  const index = store.bonuses.findIndex((entry) => entry.id === id);

  if (index < 0) {
    throw new Error("Bonus not found.");
  }

  const current = store.bonuses[index];
  const next = { ...current };
  let changed = false;

  if (payout !== undefined) {
    const amount = Number(payout);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Enter a valid payout amount.");
    }

    next.payout = Number(amount.toFixed(2));
    next.status = "opened";
    next.openedAt = current.openedAt || new Date().toISOString();
    changed = true;
  }

  if (superBonus !== undefined) {
    next.superBonus = Boolean(superBonus);
    changed = true;
  }

  if (epicBonus !== undefined) {
    next.epicBonus = Boolean(epicBonus);
    changed = true;
  }

  if (!changed) {
    throw new Error("Nothing to update.");
  }

  store.bonuses[index] = next;
  await writeStore(store);

  const sorted = sortBonuses(store.bonuses);
  const sortedIndex = sorted.findIndex((entry) => entry.id === id);
  return toPublicBonus(sorted[sortedIndex], sortedIndex);
}

export async function removeBonus(id) {
  const store = await readStore();
  const nextBonuses = store.bonuses.filter((entry) => entry.id !== id);

  if (nextBonuses.length === store.bonuses.length) {
    throw new Error("Bonus not found.");
  }

  store.bonuses = nextBonuses;
  await writeStore(store);
  return { ok: true };
}

export async function clearBonusHunt() {
  const store = await readStore();
  await writeStore({
    ...store,
    showHighestMulti: false,
    bonuses: [],
  });
  return { ok: true };
}

function normalizePastHuntRecord(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const title = String(raw.title || "Live Hunt").trim() || "Live Hunt";
  const startBalance = Number(raw.startBalance);
  const bonuses = Array.isArray(raw.bonuses)
    ? sortBonuses(
        raw.bonuses
          .map((bonus) => normalizeBonus(bonus))
          .filter(Boolean)
      )
    : [];
  const endedAt = raw.endedAt || new Date().toISOString();

  return {
    id: raw.id || crypto.randomUUID(),
    title,
    startBalance:
      Number.isFinite(startBalance) && startBalance >= 0
        ? Number(startBalance.toFixed(2))
        : 0,
    status: raw.status || buildHuntStatus(bonuses),
    endedAt,
    summary: buildSummary(bonuses, {
      startBalance:
        Number.isFinite(startBalance) && startBalance >= 0
          ? Number(startBalance.toFixed(2))
          : 0,
    }),
    bonuses: bonuses.map((bonus, index) => toPublicBonus(bonus, index)),
  };
}

async function readRedisPastHunts() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${PAST_HUNTS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return [];
  }

  try {
    const parsed = JSON.parse(data.result);
    return Array.isArray(parsed)
      ? parsed.map(normalizePastHuntRecord).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function writeRedisPastHunts(records) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(records));
  const response = await fetch(`${config.url}/set/${PAST_HUNTS_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFilePastHunts() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(PAST_HUNTS_FILE);
  } catch {
    await fs.writeFile(PAST_HUNTS_FILE, "[]");
  }

  const raw = await fs.readFile(PAST_HUNTS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.map(normalizePastHuntRecord).filter(Boolean)
    : [];
}

async function writeFilePastHunts(records) {
  await fs.writeFile(PAST_HUNTS_FILE, JSON.stringify(records, null, 2));
}

async function readPastHunts() {
  const redisRecords = await readRedisPastHunts();
  if (redisRecords) {
    return redisRecords;
  }

  if (process.env.VERCEL === "1") {
    return [];
  }

  return readFilePastHunts();
}

async function writePastHunts(records) {
  const normalized = records
    .map(normalizePastHuntRecord)
    .filter(Boolean)
    .slice(0, MAX_PAST_HUNTS);

  if (getRedisConfig()) {
    const saved = await writeRedisPastHunts(normalized);
    if (!saved) {
      throw new Error("Could not save past hunts to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Past hunts need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFilePastHunts(normalized);
  return normalized;
}

export async function listPastHunts() {
  const records = await readPastHunts();
  return records.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
}

export async function deletePastHunt(id) {
  const huntId = String(id || "").trim();
  if (!huntId) {
    throw new Error("Past hunt id is required.");
  }

  const pastHunts = await readPastHunts();
  const nextHunts = pastHunts.filter((hunt) => hunt.id !== huntId);

  if (nextHunts.length === pastHunts.length) {
    throw new Error("Past hunt not found.");
  }

  await writePastHunts(nextHunts);
  return { ok: true };
}

export async function endBonusHunt() {
  const store = await readStore();
  const bonuses = sortBonuses(store.bonuses);
  const archive = normalizePastHuntRecord({
    title: store.title,
    startBalance: store.startBalance,
    status: buildHuntStatus(bonuses),
    endedAt: new Date().toISOString(),
    bonuses,
  });

  const pastHunts = await readPastHunts();
  await writePastHunts([archive, ...pastHunts]);

  await writeStore({
    ...store,
    showHighestMulti: false,
    bonuses: [],
  });

  return {
    archived: archive,
    hunt: {
      title: store.title,
      startBalance: store.startBalance,
      showHighestMulti: false,
      status: "collecting",
    },
    summary: buildSummary([], { startBalance: store.startBalance }),
    bonuses: [],
  };
}

export async function updateHuntSettings({ title, startBalance, showHighestMulti }) {
  const store = await readStore();
  const nextTitle = title === undefined ? store.title : String(title || "").trim();
  const nextStart =
    startBalance === undefined ? store.startBalance : Number(startBalance);

  if (!nextTitle) {
    throw new Error("Hunt title is required.");
  }

  if (!Number.isFinite(nextStart) || nextStart < 0) {
    throw new Error("Enter a valid start balance.");
  }

  store.title = nextTitle;
  store.startBalance = Number(nextStart.toFixed(2));
  if (typeof showHighestMulti === "boolean") {
    store.showHighestMulti = showHighestMulti;
  }
  await writeStore(store);

  const bonuses = sortBonuses(store.bonuses);
  return {
    hunt: {
      title: store.title,
      startBalance: store.startBalance,
      showHighestMulti: Boolean(store.showHighestMulti),
      status: buildHuntStatus(bonuses),
    },
    summary: buildSummary(bonuses, { startBalance: store.startBalance }),
  };
}
