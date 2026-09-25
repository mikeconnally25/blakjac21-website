import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const PURCHASES_FILE = path.join(DATA_DIR, "points-purchases.json");
const PURCHASES_KEY = "bj:points-purchases";
const BUY_SETTINGS_FILE = path.join(DATA_DIR, "points-buy-settings.json");
const BUY_SETTINGS_KEY = "bj:points-buy-settings";
const MAX_ORDERS = 2000;

const DEFAULT_PACKAGES = [
  { id: "pts_2000", points: 2000, usd: 15, label: "2,000 points" },
  { id: "pts_10000", points: 10000, usd: 75, label: "10,000 points" },
];

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
    orders: {},
    byPaymentId: {},
  };
}

export function getPointsUsdRate() {
  const raw = Number(process.env.POINTS_USD_RATE);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return 100;
}

export function getPurchaseLimits() {
  const rate = getPointsUsdRate();
  return {
    rate,
    minUsd: 1,
    maxUsd: 100,
    minPoints: rate,
    maxPoints: rate * 100,
    stepPoints: rate,
  };
}

export function listPointPackages() {
  const rate = getPointsUsdRate();
  return DEFAULT_PACKAGES.map((pkg) => ({
    ...pkg,
    usd:
      pkg.usd != null && Number.isFinite(Number(pkg.usd))
        ? Number(Number(pkg.usd).toFixed(2))
        : Number((pkg.points / rate).toFixed(2)),
  }));
}

export function resolvePurchaseAmount({ packageId, points, usd } = {}) {
  const packages = listPointPackages();

  if (packageId) {
    const pkg = packages.find((entry) => entry.id === String(packageId));
    if (!pkg) {
      throw new Error("Unknown points package.");
    }
    return {
      packageId: pkg.id,
      points: pkg.points,
      usdAmount: pkg.usd,
    };
  }

  // Custom amounts are disabled — only listed packages are available.
  if (
    (points != null && String(points).trim() !== "") ||
    (usd != null && String(usd).trim() !== "")
  ) {
    throw new Error(
      "Custom amounts are not available. Choose a points package."
    );
  }

  throw new Error("Choose a points package to continue.");
}

function normalizeOrder(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const kickUserId = String(entry.kickUserId || "").trim();
  if (!id || !kickUserId) return null;

  const status = ["pending", "paid", "failed"].includes(entry.status)
    ? entry.status
    : "pending";

  return {
    id,
    kickUserId,
    username: String(entry.username || "viewer"),
    points: Math.max(0, Math.floor(Number(entry.points) || 0)),
    usdAmount: Math.max(0, Number(entry.usdAmount) || 0),
    packageId: entry.packageId ? String(entry.packageId) : null,
    status,
    paymentId: entry.paymentId != null ? String(entry.paymentId) : null,
    invoiceId: entry.invoiceId != null ? String(entry.invoiceId) : null,
    createdAt: entry.createdAt || new Date().toISOString(),
    paidAt: entry.paidAt || null,
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultStore();
  }

  const orders = {};
  const rawOrders =
    raw.orders && typeof raw.orders === "object" ? raw.orders : {};
  for (const [id, entry] of Object.entries(rawOrders)) {
    const normalized = normalizeOrder({ ...entry, id: entry.id || id });
    if (normalized) {
      orders[normalized.id] = normalized;
    }
  }

  const byPaymentId = {};
  const rawByPayment =
    raw.byPaymentId && typeof raw.byPaymentId === "object"
      ? raw.byPaymentId
      : {};
  for (const [paymentId, orderId] of Object.entries(rawByPayment)) {
    const pid = String(paymentId || "").trim();
    const oid = String(orderId || "").trim();
    if (pid && oid && orders[oid]) {
      byPaymentId[pid] = oid;
    }
  }

  // Rebuild payment index from paid orders if missing.
  for (const order of Object.values(orders)) {
    if (order.paymentId && order.status === "paid") {
      byPaymentId[order.paymentId] = order.id;
    }
  }

  const ids = Object.keys(orders);
  if (ids.length > MAX_ORDERS) {
    const sorted = ids
      .map((id) => orders[id])
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const drop = sorted.slice(0, ids.length - MAX_ORDERS);
    for (const order of drop) {
      delete orders[order.id];
      if (order.paymentId) {
        delete byPaymentId[order.paymentId];
      }
    }
  }

  return { orders, byPaymentId };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${PURCHASES_KEY}`, {
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

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", PURCHASES_KEY, JSON.stringify(store)]),
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(PURCHASES_FILE);
  } catch {
    await fs.writeFile(
      PURCHASES_FILE,
      JSON.stringify(defaultStore(), null, 2)
    );
  }

  const raw = await fs.readFile(PURCHASES_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeFileStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PURCHASES_FILE, JSON.stringify(store, null, 2), "utf8");
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
      throw new Error("Could not save points purchases to Redis.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Points purchases need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(normalized);
  return normalized;
}

export async function createPurchase({
  kickUserId,
  username,
  points,
  usdAmount,
  packageId = null,
  invoiceId = null,
}) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    throw new Error("Sign in with Kick first.");
  }

  const pts = Math.floor(Number(points));
  const usd = Number(usdAmount);
  if (!Number.isFinite(pts) || pts < 1) {
    throw new Error("Invalid points amount.");
  }
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error("Invalid USD amount.");
  }

  const store = await readStore();
  const order = normalizeOrder({
    id: crypto.randomUUID(),
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    points: pts,
    usdAmount: usd,
    packageId,
    status: "pending",
    paymentId: null,
    invoiceId: invoiceId != null ? String(invoiceId) : null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  });

  store.orders[order.id] = order;
  await writeStore(store);
  return order;
}

export async function updatePurchaseInvoice(orderId, { invoiceId } = {}) {
  const id = String(orderId || "").trim();
  if (!id) return null;

  const store = await readStore();
  const existing = store.orders[id];
  if (!existing) return null;

  const updated = normalizeOrder({
    ...existing,
    invoiceId: invoiceId != null ? String(invoiceId) : existing.invoiceId,
  });
  store.orders[id] = updated;
  await writeStore(store);
  return updated;
}

export async function getPurchaseById(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  const store = await readStore();
  return store.orders[id] || null;
}

export async function getPurchaseByPaymentId(paymentId) {
  const pid = String(paymentId || "").trim();
  if (!pid) return null;
  const store = await readStore();
  const orderId = store.byPaymentId[pid];
  if (!orderId) return null;
  return store.orders[orderId] || null;
}

/**
 * Mark a pending order paid. Idempotent on payment_id and order status.
 * @returns {{ order: object, awarded: boolean } | null}
 */
export async function markPurchasePaid(orderId, paymentId) {
  const id = String(orderId || "").trim();
  const pid = String(paymentId || "").trim();
  if (!id || !pid) {
    throw new Error("order_id and payment_id are required.");
  }

  const store = await readStore();
  const existing = store.orders[id];
  if (!existing) {
    return null;
  }

  const priorByPayment = store.byPaymentId[pid];
  if (priorByPayment && priorByPayment !== id) {
    return {
      order: store.orders[priorByPayment] || existing,
      awarded: false,
    };
  }

  if (existing.status === "paid") {
    return { order: existing, awarded: false };
  }

  const paidAt = new Date().toISOString();
  const updated = normalizeOrder({
    ...existing,
    status: "paid",
    paymentId: pid,
    paidAt,
  });

  store.orders[id] = updated;
  store.byPaymentId[pid] = id;
  await writeStore(store);
  return { order: updated, awarded: true };
}

/**
 * Undo a paid mark so a failed award can be retried on the next IPN.
 */
export async function revertPurchasePaid(orderId, paymentId) {
  const id = String(orderId || "").trim();
  const pid = String(paymentId || "").trim();
  if (!id) return null;

  const store = await readStore();
  const existing = store.orders[id];
  if (!existing || existing.status !== "paid") {
    return existing || null;
  }

  if (pid && store.byPaymentId[pid] === id) {
    delete store.byPaymentId[pid];
  }

  const updated = normalizeOrder({
    ...existing,
    status: "pending",
    paymentId: null,
    paidAt: null,
  });
  store.orders[id] = updated;
  await writeStore(store);
  return updated;
}

function defaultBuySettings() {
  return { enabled: true };
}

function normalizeBuySettings(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultBuySettings();
  }
  return {
    enabled: raw.enabled !== false,
  };
}

async function readRedisBuySettings() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${BUY_SETTINGS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return defaultBuySettings();
  }

  try {
    return normalizeBuySettings(
      typeof data.result === "string" ? JSON.parse(data.result) : data.result
    );
  } catch {
    return defaultBuySettings();
  }
}

async function writeRedisBuySettings(settings) {
  const config = getRedisConfig();
  if (!config) return false;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", BUY_SETTINGS_KEY, JSON.stringify(settings)]),
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileBuySettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(BUY_SETTINGS_FILE);
  } catch {
    await fs.writeFile(
      BUY_SETTINGS_FILE,
      JSON.stringify(defaultBuySettings(), null, 2)
    );
  }

  const raw = await fs.readFile(BUY_SETTINGS_FILE, "utf8");
  return normalizeBuySettings(JSON.parse(raw));
}

async function writeFileBuySettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    BUY_SETTINGS_FILE,
    JSON.stringify(settings, null, 2),
    "utf8"
  );
}

export async function getPointsBuySettings() {
  const redisSettings = await readRedisBuySettings();
  if (redisSettings) {
    return redisSettings;
  }

  if (process.env.VERCEL === "1") {
    return defaultBuySettings();
  }

  return readFileBuySettings();
}

export async function isPointsBuyingEnabled() {
  const settings = await getPointsBuySettings();
  return settings.enabled !== false;
}

export async function setPointsBuyingEnabled(enabled) {
  const settings = normalizeBuySettings({ enabled: Boolean(enabled) });

  if (getRedisConfig()) {
    const saved = await writeRedisBuySettings(settings);
    if (!saved) {
      throw new Error("Could not save buy points settings to Redis.");
    }
    return settings;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Redis is required to save buy points settings on Vercel.");
  }

  await writeFileBuySettings(settings);
  return settings;
}
