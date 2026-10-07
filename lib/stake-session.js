import crypto from "crypto";
import { getOneVOneState } from "./one-v-one.js";

const SESSION_PREFIX = "bj:stake-session:";
const TOKEN_PREFIX = "bj:stake-session-token:";
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BETS = 300;

const memorySessions = new Map();
const memoryTokens = new Map();

const CONTEXTS = new Set(["hunt", "1v1"]);

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function isStakeSessionContext(value) {
  return CONTEXTS.has(String(value || ""));
}

function emptySession(context) {
  return {
    context,
    startedAt: null,
    updatedAt: null,
    bets: [],
  };
}

function normalizeGameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeBet(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const game = String(raw.game || "").trim();
  const amount = Number(raw.amount);
  if (!id || !game || !Number.isFinite(amount) || amount < 0) return null;

  const payoutRaw = raw.payout;
  const payout =
    payoutRaw === null || payoutRaw === undefined || payoutRaw === ""
      ? null
      : Number(payoutRaw);
  if (payout !== null && (!Number.isFinite(payout) || payout < 0)) return null;

  const multiplier = Number(raw.multiplier);
  return {
    id,
    game,
    slug: String(raw.slug || "").trim().toLowerCase(),
    amount,
    payout,
    multiplier: Number.isFinite(multiplier) ? multiplier : null,
    currency: String(raw.currency || "").trim().toLowerCase(),
    createdAt: String(raw.createdAt || "").trim() || new Date().toISOString(),
  };
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config) return { skipped: true, result: null };

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
    throw new Error(data.error || "Could not reach the session store.");
  }
  return { skipped: false, result: data.result };
}

async function readSession(context) {
  const cached = memorySessions.get(context);
  try {
    const { skipped, result } = await redisCommand(["GET", `${SESSION_PREFIX}${context}`]);
    if (skipped) return cached || emptySession(context);
    if (result === null || result === undefined) return emptySession(context);
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const bets = Array.isArray(parsed?.bets)
      ? parsed.bets.map(normalizeBet).filter(Boolean)
      : [];
    return {
      context,
      startedAt: parsed?.startedAt || null,
      updatedAt: parsed?.updatedAt || null,
      bets,
    };
  } catch {
    return cached || emptySession(context);
  }
}

async function writeSession(session) {
  memorySessions.set(session.context, session);
  const payload = JSON.stringify(session);
  const { skipped } = await redisCommand([
    "SET",
    `${SESSION_PREFIX}${session.context}`,
    payload,
  ]);
  if (skipped) return session;
  return session;
}

export async function startStakeSession(context) {
  if (!isStakeSessionContext(context)) {
    throw new Error("Choose a hunt or 1v1 session.");
  }

  const now = new Date().toISOString();
  const session = {
    context,
    startedAt: now,
    updatedAt: now,
    bets: [],
  };
  await writeSession(session);

  const token = crypto.randomBytes(24).toString("hex");
  const record = {
    token,
    context,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  memoryTokens.set(token, record);
  const ttlSeconds = Math.ceil(TOKEN_TTL_MS / 1000);
  await redisCommand([
    "SET",
    `${TOKEN_PREFIX}${token}`,
    JSON.stringify(record),
    "EX",
    String(ttlSeconds),
  ]);

  return { token, expiresAt: record.expiresAt, startedAt: now };
}

async function readToken(token) {
  const cached = memoryTokens.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached;

  try {
    const { skipped, result } = await redisCommand(["GET", `${TOKEN_PREFIX}${token}`]);
    if (skipped || result === null || result === undefined) return null;
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    if (!parsed?.context || Number(parsed.expiresAt) <= Date.now()) return null;
    memoryTokens.set(token, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function betMatchesSlot(bet, slot) {
  const slug = normalizeGameKey(slot?.slotSlug);
  const name = normalizeGameKey(slot?.slotName);
  const betSlug = normalizeGameKey(bet.slug);
  const betName = normalizeGameKey(bet.game);
  if (slug && (betSlug === slug || betName === slug)) return true;
  if (name && betName === name) return true;
  return false;
}

async function visibleBets(session) {
  if (session.context !== "1v1") {
    return { bets: session.bets, filterNote: "" };
  }

  const state = await getOneVOneState().catch(() => null);
  const slots = [state?.matchup?.left?.slot, state?.matchup?.right?.slot].filter(
    (slot) => slot?.slotSlug || slot?.slotName
  );
  if (!slots.length) {
    return { bets: session.bets, filterNote: "" };
  }

  return {
    bets: session.bets.filter((bet) => slots.some((slot) => betMatchesSlot(bet, slot))),
    filterNote: slots
      .map((slot) => slot.slotName)
      .filter(Boolean)
      .join(" vs "),
  };
}

function summarize(bets) {
  const wagered = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const returned = bets.reduce((sum, bet) => sum + (Number(bet.payout) || 0), 0);
  return {
    count: bets.length,
    wagered: Number(wagered.toFixed(2)),
    returned: Number(returned.toFixed(2)),
    net: Number((returned - wagered).toFixed(2)),
  };
}

export async function getStakeSession(context) {
  if (!isStakeSessionContext(context)) {
    throw new Error("Choose a hunt or 1v1 session.");
  }

  const session = await readSession(context);
  const visible = await visibleBets(session);
  return {
    context,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    filterNote: visible.filterNote,
    ...summarize(visible.bets),
    bets: visible.bets.slice(0, 40),
  };
}

export async function importStakeSessionBets(token, incoming) {
  const record = await readToken(String(token || "").trim());
  if (!record) {
    throw new Error("Stake session expired. Start tracking again.");
  }

  const session = await readSession(record.context);
  if (!session.startedAt) {
    throw new Error("Start tracking on the site before sending bets.");
  }

  const byId = new Map(session.bets.map((bet) => [bet.id, bet]));
  let added = 0;
  for (const raw of Array.isArray(incoming) ? incoming.slice(0, 40) : []) {
    const bet = normalizeBet(raw);
    if (!bet) continue;
    if (!byId.has(bet.id)) added += 1;
    byId.set(bet.id, { ...byId.get(bet.id), ...bet });
  }

  const bets = [...byId.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_BETS);
  const next = {
    ...session,
    updatedAt: new Date().toISOString(),
    bets,
  };
  await writeSession(next);
  const visible = await visibleBets(next);
  return {
    ok: true,
    context: record.context,
    added,
    ...summarize(visible.bets),
  };
}

export async function clearStakeSession(context) {
  if (!isStakeSessionContext(context)) {
    throw new Error("Choose a hunt or 1v1 session.");
  }
  await writeSession(emptySession(context));
  return getStakeSession(context);
}
