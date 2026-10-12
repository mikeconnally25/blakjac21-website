import fs from "fs/promises";
import path from "path";
import { awardPoints } from "./points.js";

const DATA_DIR = path.resolve("data");
const CLAIMS_FILE = path.join(DATA_DIR, "daily-claims.json");
const CLAIM_TTL_SECONDS = 60 * 60 * 48;

export const DAILY_CLAIM_AMOUNT = 500;

export function dailyClaimDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function claimKey(kickUserId, day) {
  return `bj:daily-claim:${kickUserId}:${day}`;
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function claimError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
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

async function hasClaim(kickUserId, day) {
  const key = claimKey(kickUserId, day);
  if (assertStore() === "redis") {
    const value = await redisCommand(["GET", key]);
    return value != null;
  }

  const claims = await readFileClaims();
  return Boolean(claims[key]);
}

async function reserveClaim(kickUserId, day) {
  const key = claimKey(kickUserId, day);
  if (assertStore() === "redis") {
    const result = await redisCommand([
      "SET",
      key,
      "1",
      "NX",
      "EX",
      String(CLAIM_TTL_SECONDS),
    ]);
    return result === "OK";
  }

  const claims = await readFileClaims();
  if (claims[key]) return false;
  claims[key] = 1;
  await writeFileClaims(claims);
  return true;
}

async function releaseClaim(kickUserId, day) {
  const key = claimKey(kickUserId, day);
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
  const day = dailyClaimDay();
  if (!userId) {
    return { amount: DAILY_CLAIM_AMOUNT, claimed: false, day };
  }

  return {
    amount: DAILY_CLAIM_AMOUNT,
    claimed: await hasClaim(userId, day),
    day,
  };
}

export async function claimDailyUncCoins({ kickUserId, username }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) {
    throw claimError("Sign in with Kick first.", 401);
  }

  const day = dailyClaimDay();
  const reserved = await reserveClaim(userId, day);
  if (!reserved) {
    throw claimError("Already claimed today. Resets at midnight ET.", 409);
  }

  try {
    const updated = await awardPoints({
      kickUserId: userId,
      username,
      amount: DAILY_CLAIM_AMOUNT,
      note: "Daily claim",
    });

    return {
      amount: DAILY_CLAIM_AMOUNT,
      claimed: true,
      day,
      points: updated.points,
    };
  } catch (error) {
    await releaseClaim(userId, day);
    throw error;
  }
}
