import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const BONUSES_FILE = path.join(DATA_DIR, "bonus-hunt.json");
const BONUSES_KEY = "bh:bonuses";

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

  return {
    id: raw.id || crypto.randomUUID(),
    slot,
    bet: Number(bet.toFixed(2)),
    payout: payout === null ? null : Number(payout.toFixed(2)),
    status: payout === null ? "pending" : "opened",
    addedAt: raw.addedAt || new Date().toISOString(),
    openedAt: payout === null ? null : raw.openedAt || new Date().toISOString(),
  };
}

function sortBonuses(bonuses) {
  return [...bonuses].sort(
    (a, b) => new Date(a.addedAt) - new Date(b.addedAt)
  );
}

function toPublicBonus(bonus, index) {
  return {
    id: bonus.id,
    number: index + 1,
    slot: bonus.slot,
    bet: bonus.bet,
    payout: bonus.payout,
    status: bonus.status,
    addedAt: bonus.addedAt,
    openedAt: bonus.openedAt,
  };
}

function buildSummary(bonuses) {
  const totalBonuses = bonuses.length;
  const totalCost = bonuses.reduce((sum, bonus) => sum + bonus.bet, 0);
  const opened = bonuses.filter((bonus) => bonus.status === "opened");
  const totalWon = opened.reduce(
    (sum, bonus) => sum + (bonus.payout ?? 0),
    0
  );

  return {
    totalBonuses,
    openedCount: opened.length,
    pendingCount: totalBonuses - opened.length,
    totalCost: Number(totalCost.toFixed(2)),
    totalWon: Number(totalWon.toFixed(2)),
    profit: Number((totalWon - totalCost).toFixed(2)),
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
    return { bonuses: [] };
  }

  try {
    const parsed = JSON.parse(data.result);
    return {
      bonuses: Array.isArray(parsed.bonuses) ? parsed.bonuses : [],
    };
  } catch {
    return { bonuses: [] };
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
    await fs.writeFile(BONUSES_FILE, JSON.stringify({ bonuses: [] }, null, 2));
  }

  const raw = await fs.readFile(BONUSES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { bonuses: Array.isArray(parsed.bonuses) ? parsed.bonuses : [] };
}

async function writeFileStore(store) {
  await fs.writeFile(BONUSES_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { bonuses: [] };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
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

  await writeFileStore(store);
}

export async function getBonusHunt() {
  const store = await readStore();
  const bonuses = sortBonuses(store.bonuses);
  return {
    bonuses: bonuses.map(toPublicBonus),
    summary: buildSummary(bonuses),
  };
}

export async function addBonus({ slot, bet }) {
  const bonus = normalizeBonus({ slot, bet });
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

export async function updateBonusPayout({ id, payout }) {
  const store = await readStore();
  const index = store.bonuses.findIndex((entry) => entry.id === id);

  if (index < 0) {
    throw new Error("Bonus not found.");
  }

  const amount = Number(payout);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid payout amount.");
  }

  store.bonuses[index] = {
    ...store.bonuses[index],
    payout: Number(amount.toFixed(2)),
    status: "opened",
    openedAt: new Date().toISOString(),
  };

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
  await writeStore({ bonuses: [] });
  return { ok: true };
}
