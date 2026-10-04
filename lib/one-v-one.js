import fs from "fs/promises";
import path from "path";
import { listSlotCallGroups } from "./slot-requests.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "one-v-one.json");
const STATE_KEY = "site:one-v-one";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function emptyMatchup() {
  return { leftKickUserId: "", rightKickUserId: "" };
}

function normalizeMatchup(raw) {
  if (!raw || typeof raw !== "object") return emptyMatchup();
  return {
    leftKickUserId: String(raw.leftKickUserId || "").trim(),
    rightKickUserId: String(raw.rightKickUserId || "").trim(),
  };
}

async function readRedisMatchup() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${STATE_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) return emptyMatchup();

  try {
    return normalizeMatchup(JSON.parse(data.result));
  } catch {
    return emptyMatchup();
  }
}

async function writeRedisMatchup(matchup) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(matchup));
  const response = await fetch(`${config.url}/set/${STATE_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json();
  return data.result === "OK";
}

async function readFileMatchup() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify(emptyMatchup(), null, 2));
  }

  const raw = await fs.readFile(STATE_FILE, "utf8");
  return normalizeMatchup(JSON.parse(raw));
}

async function writeFileMatchup(matchup) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(matchup, null, 2));
}

async function readMatchup() {
  const redisMatchup = await readRedisMatchup();
  if (redisMatchup) return redisMatchup;

  if (process.env.VERCEL === "1") return emptyMatchup();
  return readFileMatchup();
}

async function writeMatchup(matchup) {
  const normalized = normalizeMatchup(matchup);

  if (getRedisConfig()) {
    const saved = await writeRedisMatchup(normalized);
    if (!saved) {
      throw new Error("Could not save the 1v1.");
    }
    return normalized;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("1v1 needs shared storage. Add Upstash Redis in Vercel.");
  }

  await writeFileMatchup(normalized);
  return normalized;
}

function toSide(group) {
  if (!group) return null;
  return {
    username: group.username,
    calls: group.calls,
  };
}

export async function getOneVOneState() {
  const [matchup, groups] = await Promise.all([
    readMatchup(),
    listSlotCallGroups().catch(() => []),
  ]);
  const byId = new Map(groups.map((group) => [group.kickUserId, group]));

  return {
    matchup: {
      left: toSide(byId.get(matchup.leftKickUserId)),
      right: toSide(byId.get(matchup.rightKickUserId)),
    },
    selection: matchup,
    chatters: groups.map((group) => ({
      kickUserId: group.kickUserId,
      username: group.username,
      callCount: group.calls.length,
    })),
  };
}

export async function setOneVOneMatchup(leftKickUserId, rightKickUserId) {
  const left = String(leftKickUserId || "").trim();
  const right = String(rightKickUserId || "").trim();

  if (!left || !right) {
    throw new Error("Pick two chatters.");
  }
  if (left === right) {
    throw new Error("Pick two different chatters.");
  }

  const groups = await listSlotCallGroups();
  const byId = new Map(groups.map((group) => [group.kickUserId, group]));
  if (!byId.has(left) || !byId.has(right)) {
    throw new Error("Both chatters need at least one slot call.");
  }

  await writeMatchup({ leftKickUserId: left, rightKickUserId: right });
  return getOneVOneState();
}

export async function clearOneVOneMatchup() {
  await writeMatchup(emptyMatchup());
  return getOneVOneState();
}
