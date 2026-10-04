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

const ACTIVE_VIEWER_MINUTES = 15;

function emptyMatchup() {
  return {
    leftKickUserId: "",
    rightKickUserId: "",
    leftUsername: "",
    rightUsername: "",
  };
}

function normalizeMatchup(raw) {
  if (!raw || typeof raw !== "object") return emptyMatchup();
  return {
    leftKickUserId: String(raw.leftKickUserId || "").trim(),
    rightKickUserId: String(raw.rightKickUserId || "").trim(),
    leftUsername: String(raw.leftUsername || "").trim(),
    rightUsername: String(raw.rightUsername || "").trim(),
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

function toSide(username, group) {
  if (!username && !group) return null;
  return {
    username: group?.username || username || "Viewer",
    calls: group?.calls || [],
  };
}

async function listEligibleActiveViewers() {
  const { listRecentChatters } = await import("./kick-chat-archive.js");
  const { getAltSoftBlockIndex, getStakeLinkedKickUserIds, getUserByKickId } =
    await import("./users.js");
  const recent = await listRecentChatters({ withinMinutes: ACTIVE_VIEWER_MINUTES });
  const softBlockIndex = await getAltSoftBlockIndex();
  const stakeLinkedIds = await getStakeLinkedKickUserIds();
  const eligible = [];

  for (const chatter of recent) {
    const kickUserId = String(chatter.kickUserId || "").trim();
    if (!kickUserId) continue;
    if (softBlockIndex.get(kickUserId)?.softBlocked) continue;
    if (!stakeLinkedIds.has(kickUserId)) continue;

    const user = await getUserByKickId(kickUserId);
    if (user?.banned) continue;

    eligible.push({
      kickUserId,
      username: chatter.username || user?.username || "viewer",
    });
  }

  return eligible;
}

function pickTwo(viewers) {
  const pool = [...viewers];
  const left = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const right = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [left, right];
}

export async function getOneVOneState() {
  const [matchup, groups, viewers] = await Promise.all([
    readMatchup(),
    listSlotCallGroups().catch(() => []),
    listEligibleActiveViewers().catch(() => []),
  ]);
  const byId = new Map(groups.map((group) => [group.kickUserId, group]));

  return {
    activeCount: viewers.length,
    activeMinutes: ACTIVE_VIEWER_MINUTES,
    matchup: {
      left: toSide(matchup.leftUsername, byId.get(matchup.leftKickUserId)),
      right: toSide(matchup.rightUsername, byId.get(matchup.rightKickUserId)),
    },
  };
}

export async function drawOneVOneWinners() {
  const viewers = await listEligibleActiveViewers();
  if (viewers.length < 2) {
    throw new Error(
      "Need at least 2 active viewers. They have to chat in the last 15 minutes, link Stake, and not be blocked."
    );
  }

  const [left, right] = pickTwo(viewers);
  await writeMatchup({
    leftKickUserId: left.kickUserId,
    rightKickUserId: right.kickUserId,
    leftUsername: left.username,
    rightUsername: right.username,
  });
  return getOneVOneState();
}

export async function clearOneVOneMatchup() {
  await writeMatchup(emptyMatchup());
  return getOneVOneState();
}
