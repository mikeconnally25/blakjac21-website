import fs from "fs/promises";
import path from "path";
import { awardPoints } from "./points.js";

const DATA_DIR = path.resolve("data");
const CLAIMS_FILE = path.join(DATA_DIR, "daily-claims.json");
const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CLAIM_TTL_SECONDS = 24 * 60 * 60;
const LEGACY_TTL_MS = 48 * 60 * 60 * 1000;

export const DAILY_CLAIM_AMOUNT = 250;

export function dailyClaimDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function claimKey(kickUserId) {
  return `bj:daily-claim:${kickUserId}`;
}

function legacyClaimKey(kickUserId, day) {
  return `bj:daily-claim:${kickUserId}:${day}`;
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function claimError(message, statusCode, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw claimError("Could not claim UncCoins.", 500);
  }

  const data = await response.json();
  return data.result;
}

async function readFileClaims() {
  try {
    const raw = JSON.parse(await fs.readFile(CLAIMS_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeFileClaims(claims) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CLAIMS_FILE, JSON.stringify(claims), "utf8");
}

function assertStore() {
  if (getRedisConfig()) return "redis";
  if (process.env.VERCEL === "1") {
    throw claimError("Daily claim is unavailable.", 500);
  }
  return "file";
}

function futureStamp(value) {
  const stamp = Number(value);
  return Number.isFinite(stamp) && stamp > Date.now() ? stamp : 0;
}

function legacyNextClaimAt(pttl) {
  const ttl = Number(pttl);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  return Date.now() + ttl - (LEGACY_TTL_MS - CLAIM_COOLDOWN_MS);
}

async function redisNextClaimAt(key, { legacy = false } = {}) {
  const value = await redisCommand(["GET", key]);
  if (value == null) return 0;
  const stored = futureStamp(value);
  if (stored) return stored;
  const pttl = await redisCommand(["PTTL", key]);
  return legacy ? legacyNextClaimAt(pttl) : futureStamp(Date.now() + Number(pttl));
}

async function getNextClaimAt(kickUserId) {
  if (assertStore() === "redis") {
    const current = await redisNextClaimAt(claimKey(kickUserId));
    if (current) return current;
    return futureStamp(
      await redisNextClaimAt(legacyClaimKey(kickUserId, dailyClaimDay()), {
        legacy: true,
      })
    );
  }

  const claims = await readFileClaims();
  return futureStamp(claims[claimKey(kickUserId)]);
}

function claimStatus(nextClaimAt) {
  const readyAt = futureStamp(nextClaimAt);
  return {
    amount: DAILY_CLAIM_AMOUNT,
    claimed: readyAt > 0,
    nextClaimAt: readyAt,
  };
}

async function reserveClaim(kickUserId) {
  const pending = await getNextClaimAt(kickUserId);
  if (pending) return { ok: false, nextClaimAt: pending };

  const nextClaimAt = Date.now() + CLAIM_COOLDOWN_MS;
  const key = claimKey(kickUserId);
  if (assertStore() === "redis") {
    const result = await redisCommand([
      "SET",
      key,
      String(nextClaimAt),
      "NX",
      "EX",
      String(CLAIM_TTL_SECONDS),
    ]);
    if (result === "OK") return { ok: true, nextClaimAt };
    return { ok: false, nextClaimAt: await getNextClaimAt(kickUserId) };
  }

  const claims = await readFileClaims();
  const existing = futureStamp(claims[key]);
  if (existing) return { ok: false, nextClaimAt: existing };
  claims[key] = nextClaimAt;
  await writeFileClaims(claims);
  return { ok: true, nextClaimAt };
}

async function releaseClaim(kickUserId) {
  const key = claimKey(kickUserId);
  if (assertStore() === "redis") {
    await redisCommand(["DEL", key]);
    return;
  }

  const claims = await readFileClaims();
  delete claims[key];
  await writeFileClaims(claims);
}

export async function getDailyClaimStatus(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return claimStatus(0);
  return claimStatus(await getNextClaimAt(userId));
}

export async function claimDailyUncCoins({ kickUserId, username }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    throw claimError("Sign in with Kick first.", 401);
  }

  const reserved = await reserveClaim(userId);
  if (!reserved.ok) {
    throw claimError("Already claimed. Next claim opens in 24 hours.", 409, {
      nextClaimAt: reserved.nextClaimAt,
    });
  }

  try {
    const updated = await awardPoints({
      kickUserId: userId,
      username,
      amount: DAILY_CLAIM_AMOUNT,
      note: "Daily claim",
    });

    return {
      ...claimStatus(reserved.nextClaimAt),
      points: updated.points,
    };
  } catch (error) {
    await releaseClaim(userId);
    throw error;
  }
}
