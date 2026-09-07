import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const POINTS_FILE = path.join(DATA_DIR, "points.json");
const POINTS_KEY = "bj:points";
const MAX_LEDGER = 200;
const MAX_REDEMPTIONS = 300;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function defaultStore() {
  return {
    balances: {},
    ledger: [],
    catalog: [],
    redemptions: [],
  };
}

function normalizeBalance(entry, kickUserId) {
  if (!entry || typeof entry !== "object") {
    return {
      kickUserId: String(kickUserId || ""),
      points: 0,
      username: null,
      updatedAt: null,
    };
  }

  return {
    kickUserId: String(entry.kickUserId || kickUserId || ""),
    points: Math.max(0, Math.floor(Number(entry.points) || 0)),
    username: entry.username ? String(entry.username) : null,
    updatedAt: entry.updatedAt || null,
  };
}

function normalizeCatalogItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = String(item.id || "").trim();
  const title = String(item.title || "").trim();
  const cost = Math.floor(Number(item.cost));
  if (!id || !title || !Number.isFinite(cost) || cost < 1) {
    return null;
  }

  return {
    id,
    title,
    description: String(item.description || "").trim(),
    cost,
    active: item.active !== false,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  };
}

function normalizeRedemption(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = String(entry.id || "").trim();
  const kickUserId = String(entry.kickUserId || "").trim();
  if (!id || !kickUserId) {
    return null;
  }

  const status = ["pending", "fulfilled", "cancelled"].includes(entry.status)
    ? entry.status
    : "pending";

  return {
    id,
    kickUserId,
    username: String(entry.username || "viewer"),
    itemId: String(entry.itemId || ""),
    itemTitle: String(entry.itemTitle || "Item"),
    cost: Math.max(0, Math.floor(Number(entry.cost) || 0)),
    status,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
  };
}

function normalizeLedgerEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    id: String(entry.id || crypto.randomUUID()),
    type: String(entry.type || "award"),
    kickUserId: String(entry.kickUserId || ""),
    username: String(entry.username || ""),
    amount: Math.floor(Number(entry.amount) || 0),
    balanceAfter: Math.max(0, Math.floor(Number(entry.balanceAfter) || 0)),
    note: String(entry.note || "").trim(),
    actorKickUserId: entry.actorKickUserId
      ? String(entry.actorKickUserId)
      : null,
    actorUsername: entry.actorUsername ? String(entry.actorUsername) : null,
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultStore();
  }

  const balances = {};
  const rawBalances =
    raw.balances && typeof raw.balances === "object" ? raw.balances : {};
  for (const [kickUserId, entry] of Object.entries(rawBalances)) {
    balances[String(kickUserId)] = normalizeBalance(entry, kickUserId);
  }

  return {
    balances,
    ledger: (Array.isArray(raw.ledger) ? raw.ledger : [])
      .map(normalizeLedgerEntry)
      .filter(Boolean)
      .slice(-MAX_LEDGER),
    catalog: (Array.isArray(raw.catalog) ? raw.catalog : [])
      .map(normalizeCatalogItem)
      .filter(Boolean),
    redemptions: (Array.isArray(raw.redemptions) ? raw.redemptions : [])
      .map(normalizeRedemption)
      .filter(Boolean)
      .slice(-MAX_REDEMPTIONS),
  };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${POINTS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return defaultStore();
  }

  try {
    return normalizeStore(
      typeof data.result === "string" ? JSON.parse(data.result) : data.result
    );
  } catch {
    return defaultStore();
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  // Body-based SET avoids 414 failures once the store grows (catalog + redemptions).
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", POINTS_KEY, JSON.stringify(store)]),
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(POINTS_FILE);
  } catch {
    await fs.writeFile(POINTS_FILE, JSON.stringify(defaultStore(), null, 2));
  }

  const raw = await fs.readFile(POINTS_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POINTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return defaultStore();
  }

  return readFileStore();
}

async function writeStore(store) {
  const normalized = normalizeStore(store);

  if (getRedisConfig()) {
    const saved = await writeRedisStore(normalized);
    if (!saved) {
      throw new Error("Could not save points store to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Points need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(normalized);
  return normalized;
}

function pushLedger(store, entry) {
  store.ledger = [...store.ledger, normalizeLedgerEntry(entry)]
    .filter(Boolean)
    .slice(-MAX_LEDGER);
}

export async function getPointsBalance(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    return normalizeBalance(null, "");
  }

  const store = await readStore();
  return normalizeBalance(store.balances[userId], userId);
}

export async function getPointsBalancesMap() {
  const store = await readStore();
  const map = {};
  for (const [kickUserId, entry] of Object.entries(store.balances)) {
    map[kickUserId] = normalizeBalance(entry, kickUserId);
  }
  return map;
}

export async function awardPoints({
  kickUserId,
  username,
  amount,
  note = "",
  actorKickUserId = null,
  actorUsername = null,
}) {
  const userId = String(kickUserId || "").trim();
  const delta = Math.floor(Number(amount));
  if (!userId) {
    throw new Error("User id is required.");
  }
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Provide a non-zero points amount.");
  }

  const store = await readStore();
  const existing = normalizeBalance(store.balances[userId], userId);
  const nextPoints = Math.max(0, existing.points + delta);
  const updated = {
    kickUserId: userId,
    points: nextPoints,
    username: String(username || existing.username || "viewer").trim() || "viewer",
    updatedAt: new Date().toISOString(),
  };

  store.balances[userId] = updated;
  pushLedger(store, {
    id: crypto.randomUUID(),
    type: delta > 0 ? "award" : "adjust",
    kickUserId: userId,
    username: updated.username,
    amount: delta,
    balanceAfter: nextPoints,
    note,
    actorKickUserId,
    actorUsername,
    createdAt: updated.updatedAt,
  });

  await writeStore(store);
  return updated;
}

export async function awardPointsBulk({
  users,
  amount,
  note = "Chat bulk award",
  actorKickUserId = null,
  actorUsername = null,
}) {
  const delta = Math.floor(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Provide a non-zero points amount.");
  }

  const targets = (Array.isArray(users) ? users : [])
    .map((user) => ({
      kickUserId: String(user?.kickUserId || "").trim(),
      username: String(user?.username || "viewer").trim() || "viewer",
    }))
    .filter((user) => user.kickUserId);

  if (!targets.length) {
    throw new Error(
      "No Kick chatters active in that window. They are tracked when someone types in your Kick channel."
    );
  }

  const store = await readStore();
  const now = new Date().toISOString();
  const results = [];

  for (const target of targets) {
    const existing = normalizeBalance(
      store.balances[target.kickUserId],
      target.kickUserId
    );
    const nextPoints = Math.max(0, existing.points + delta);
    const updated = {
      kickUserId: target.kickUserId,
      points: nextPoints,
      username: target.username || existing.username || "viewer",
      updatedAt: now,
    };
    store.balances[target.kickUserId] = updated;
    pushLedger(store, {
      id: crypto.randomUUID(),
      type: delta > 0 ? "award" : "adjust",
      kickUserId: target.kickUserId,
      username: updated.username,
      amount: delta,
      balanceAfter: nextPoints,
      note,
      actorKickUserId,
      actorUsername,
      createdAt: now,
    });
    results.push(updated);
  }

  await writeStore(store);
  return {
    awarded: results.length,
    amount: delta,
    balances: results,
  };
}

export async function listCatalog({ includeInactive = false } = {}) {
  const store = await readStore();
  const items = store.catalog
    .slice()
    .sort((a, b) => a.cost - b.cost || a.title.localeCompare(b.title));
  return includeInactive ? items : items.filter((item) => item.active);
}

export async function upsertCatalogItem({
  id,
  title,
  description = "",
  cost,
  active = true,
}) {
  const store = await readStore();
  const itemId = String(id || crypto.randomUUID()).trim();
  const existing = store.catalog.find((entry) => entry.id === itemId);
  const next = normalizeCatalogItem({
    id: itemId,
    title,
    description,
    cost,
    active,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!next) {
    throw new Error("Provide a title and a cost of at least 1 point.");
  }

  if (existing) {
    store.catalog = store.catalog.map((entry) =>
      entry.id === itemId ? next : entry
    );
  } else {
    store.catalog.push(next);
  }

  await writeStore(store);
  return next;
}

export async function setCatalogItemActive(id, active) {
  const store = await readStore();
  const itemId = String(id || "").trim();
  const index = store.catalog.findIndex((entry) => entry.id === itemId);
  if (index < 0) {
    throw new Error("Catalog item not found.");
  }

  store.catalog[index] = {
    ...store.catalog[index],
    active: Boolean(active),
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.catalog[index];
}

export async function redeemCatalogItem({
  kickUserId,
  username,
  itemId,
}) {
  const userId = String(kickUserId || "").trim();
  const catalogItemId = String(itemId || "").trim();
  if (!userId) {
    throw new Error("Sign in to redeem.");
  }
  if (!catalogItemId) {
    throw new Error("Choose a catalog item.");
  }

  const store = await readStore();
  const item = store.catalog.find(
    (entry) => entry.id === catalogItemId && entry.active
  );
  if (!item) {
    throw new Error("That item is not available.");
  }

  const balance = normalizeBalance(store.balances[userId], userId);
  if (balance.points < item.cost) {
    throw new Error(
      `Not enough points. You have ${balance.points}; this costs ${item.cost}.`
    );
  }

  const now = new Date().toISOString();
  const nextPoints = balance.points - item.cost;
  const displayName =
    String(username || balance.username || "viewer").trim() || "viewer";

  store.balances[userId] = {
    kickUserId: userId,
    points: nextPoints,
    username: displayName,
    updatedAt: now,
  };

  const redemption = {
    id: crypto.randomUUID(),
    kickUserId: userId,
    username: displayName,
    itemId: item.id,
    itemTitle: item.title,
    cost: item.cost,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  store.redemptions = [...store.redemptions, redemption].slice(-MAX_REDEMPTIONS);
  pushLedger(store, {
    id: crypto.randomUUID(),
    type: "redeem",
    kickUserId: userId,
    username: displayName,
    amount: -item.cost,
    balanceAfter: nextPoints,
    note: `Redeemed ${item.title}`,
    createdAt: now,
  });

  await writeStore(store);
  return {
    balance: store.balances[userId],
    redemption,
  };
}

export async function listRedemptions({
  kickUserId = null,
  status = null,
} = {}) {
  const store = await readStore();
  let items = store.redemptions.slice();

  if (kickUserId) {
    const userId = String(kickUserId).trim();
    items = items.filter((entry) => entry.kickUserId === userId);
  }

  if (status) {
    items = items.filter((entry) => entry.status === status);
  }

  return items.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export async function fulfillRedemption(id) {
  const store = await readStore();
  const redemptionId = String(id || "").trim();
  const index = store.redemptions.findIndex((entry) => entry.id === redemptionId);
  if (index < 0) {
    throw new Error("Redemption not found.");
  }

  const current = store.redemptions[index];
  if (current.status !== "pending") {
    throw new Error("Only pending redemptions can be fulfilled.");
  }

  store.redemptions[index] = {
    ...current,
    status: "fulfilled",
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.redemptions[index];
}

export async function cancelRedemption(id) {
  const store = await readStore();
  const redemptionId = String(id || "").trim();
  const index = store.redemptions.findIndex((entry) => entry.id === redemptionId);
  if (index < 0) {
    throw new Error("Redemption not found.");
  }

  const current = store.redemptions[index];
  if (current.status !== "pending") {
    throw new Error("Only pending redemptions can be cancelled.");
  }

  const balance = normalizeBalance(
    store.balances[current.kickUserId],
    current.kickUserId
  );
  const now = new Date().toISOString();
  const nextPoints = balance.points + current.cost;

  store.balances[current.kickUserId] = {
    kickUserId: current.kickUserId,
    points: nextPoints,
    username: current.username || balance.username || "viewer",
    updatedAt: now,
  };

  store.redemptions[index] = {
    ...current,
    status: "cancelled",
    updatedAt: now,
  };

  pushLedger(store, {
    id: crypto.randomUUID(),
    type: "refund",
    kickUserId: current.kickUserId,
    username: current.username,
    amount: current.cost,
    balanceAfter: nextPoints,
    note: `Refunded ${current.itemTitle}`,
    createdAt: now,
  });

  await writeStore(store);
  return {
    redemption: store.redemptions[index],
    balance: store.balances[current.kickUserId],
  };
}
