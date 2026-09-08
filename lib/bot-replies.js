import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const REPLIES_FILE = path.join(DATA_DIR, "bot-replies.json");
const REPLIES_KEY = "bh:bot-replies";

export const BOT_REPLY_FIELDS = [
  {
    key: "slotUsage",
    label: "!s — usage help",
    group: "Bonus Hunt",
    description: "Sent when someone types !s without a slot name.",
  },
  {
    key: "slotClosed",
    label: "!s — requests closed",
    group: "Bonus Hunt",
    description: "Sent when slot requests are closed.",
  },
  {
    key: "slotSuccess",
    label: "!s — success",
    group: "Bonus Hunt",
    description: "Vars: {slot} {group}",
  },
  {
    key: "slotSuccessPending",
    label: "!s — success (catalog pending)",
    group: "Bonus Hunt",
    description: "Vars: {slot}",
  },
  {
    key: "slotEnterName",
    label: "!s — empty name",
    group: "Bonus Hunt",
    description: "When the slot name is blank.",
  },
  {
    key: "slotUnknown",
    label: "!s — unknown slot",
    group: "Bonus Hunt",
    description: "Slot not in New Releases / Only on Stake.",
  },
  {
    key: "slotMultiple",
    label: "!s — multiple matches",
    group: "Bonus Hunt",
    description: "Vars: {names}",
  },
  {
    key: "slotCatalogMissing",
    label: "!s — catalog not loaded",
    group: "Bonus Hunt",
    description: "When the allowed slot list is empty.",
  },
  {
    key: "slotAffOnly",
    label: "!s — AFF only",
    group: "Bonus Hunt",
  },
  {
    key: "slotSubOnly",
    label: "!s — SUB only",
    group: "Bonus Hunt",
  },
  {
    key: "slotAffSubOnly",
    label: "!s — AFF/SUB only",
    group: "Bonus Hunt",
  },
  {
    key: "requestsOpenAnnouncement",
    label: "Requests opened announcement",
    group: "Bonus Hunt",
    description: "Vars: {hunt} {modeNote}",
  },
  {
    key: "giveawayEntered",
    label: "Giveaway — entered",
    group: "Giveaways",
  },
  {
    key: "giveawayAlreadyEntered",
    label: "Giveaway — already entered",
    group: "Giveaways",
  },
  {
    key: "giveawayAffOnly",
    label: "Giveaway — AFF only",
    group: "Giveaways",
  },
  {
    key: "giveawaySubOnly",
    label: "Giveaway — SUB only",
    group: "Giveaways",
  },
  {
    key: "giveawayAffSubOnly",
    label: "Giveaway — AFF/SUB only",
    group: "Giveaways",
  },
  {
    key: "pointsAdminOnly",
    label: "Points — admin only",
    group: "Points",
  },
  {
    key: "pointsUsage",
    label: "!points — usage",
    group: "Points",
  },
  {
    key: "pointsUserNotFound",
    label: "!points — user not found",
    group: "Points",
    description: "Vars: {username}",
  },
  {
    key: "pointsAwarded",
    label: "!points — success",
    group: "Points",
    description: "Vars: {verb} {amount} {username} {balance}",
  },
  {
    key: "pointsAllUsage",
    label: "!pointsall — usage",
    group: "Points",
  },
  {
    key: "pointsAllAwarded",
    label: "!pointsall — success",
    group: "Points",
    description: "Vars: {amount} {count} {minutes}",
  },
];

export const DEFAULT_BOT_REPLIES = {
  slotUsage:
    "Use: !s <slot name> — up to 3 slots from New Releases or Only on Stake.",
  slotClosed: "Slot requests are closed right now.",
  slotSuccess: "Requested {slot} ({group}).",
  slotSuccessPending: "Requested {slot} (queued — streamer is syncing the slot list).",
  slotEnterName: "Enter a slot name.",
  slotUnknown:
    "Choose a slot from New Releases or Only on Stake on stake.com.",
  slotMultiple: "Multiple slots match that name ({names}). Be more specific.",
  slotCatalogMissing:
    "Slot list is not loaded yet. Ask the streamer to sync slots from Stake.",
  slotAffOnly:
    "Slot requests are AFF only — sign in, link Stake, and verify on code BLAKJAC21 first.",
  slotSubOnly:
    "Slot requests are SUB only — you need an active Kick subscription.",
  slotAffSubOnly:
    "Slot requests are AFF/SUB only — verify Stake with code BLAKJAC21 or be an active Kick subscriber.",
  requestsOpenAnnouncement:
    "Requests are now open for hunt {hunt}, type !s to request a slot!{modeNote}",
  giveawayEntered: "You're entered in the giveaway!",
  giveawayAlreadyEntered: "You're already entered in the giveaway.",
  giveawayAffOnly:
    "AFF only — sign in on the site and link Stake with code BLAKJAC21 first.",
  giveawaySubOnly:
    "SUB only — you need an active Kick subscription to enter.",
  giveawayAffSubOnly:
    "This giveaway is restricted. Verify Stake with BLAKJAC21 or be an active Kick sub.",
  pointsAdminOnly: "Only admins can award points.",
  pointsUsage: "Use: !points @username 100",
  pointsUserNotFound:
    "Could not find @{username} — they need to sign in on the site first.",
  pointsAwarded:
    "{verb} {amount} points to @{username}. Balance: {balance}.",
  pointsAllUsage:
    "Use: !pointsall 100  (optional: !pointsall 100 15 for last 15 minutes)",
  pointsAllAwarded:
    "Awarded {amount} points to {count} chatters active in the last {minutes}m.",
};

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeReplies(raw) {
  const next = { ...DEFAULT_BOT_REPLIES };
  if (!raw || typeof raw !== "object") {
    return next;
  }

  for (const field of BOT_REPLY_FIELDS) {
    const value = raw[field.key];
    if (typeof value === "string" && value.trim()) {
      next[field.key] = value.trim().slice(0, 400);
    }
  }

  return next;
}

async function readRedisReplies() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${REPLIES_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return null;
  }

  try {
    return normalizeReplies(JSON.parse(data.result));
  } catch {
    return null;
  }
}

async function writeRedisReplies(replies) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(replies));
  const response = await fetch(`${config.url}/set/${REPLIES_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileReplies() {
  try {
    const raw = await fs.readFile(REPLIES_FILE, "utf8");
    return normalizeReplies(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeFileReplies(replies) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REPLIES_FILE, JSON.stringify(replies, null, 2));
}

let memoryReplies = null;
let memoryLoadedAt = 0;
const MEMORY_TTL_MS = 5_000;

export async function getBotReplies() {
  if (memoryReplies && Date.now() - memoryLoadedAt < MEMORY_TTL_MS) {
    return memoryReplies;
  }

  const redis = await readRedisReplies();
  if (redis) {
    memoryReplies = redis;
    memoryLoadedAt = Date.now();
    return redis;
  }

  const file = await readFileReplies();
  if (file) {
    memoryReplies = file;
    memoryLoadedAt = Date.now();
    return file;
  }

  memoryReplies = { ...DEFAULT_BOT_REPLIES };
  memoryLoadedAt = Date.now();
  return memoryReplies;
}

export async function saveBotReplies(partial) {
  const current = await getBotReplies();
  const next = normalizeReplies({ ...current, ...(partial || {}) });
  memoryReplies = next;
  memoryLoadedAt = Date.now();

  const redisOk = await writeRedisReplies(next).catch(() => false);
  await writeFileReplies(next).catch(() => {});

  if (getRedisConfig() && !redisOk) {
    throw new Error("Could not save bot replies to Redis.");
  }

  return next;
}

export function formatBotReply(template, vars = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    if (vars[key] === undefined || vars[key] === null) {
      return "";
    }
    return String(vars[key]);
  });
}

export async function botReply(key, vars = {}) {
  const replies = await getBotReplies();
  const template = replies[key] || DEFAULT_BOT_REPLIES[key] || "";
  return formatBotReply(template, vars);
}

export function listBotReplyFields() {
  return BOT_REPLY_FIELDS.map((field) => ({
    ...field,
    defaultValue: DEFAULT_BOT_REPLIES[field.key] || "",
  }));
}
