import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.resolve("data");
const REPLIES_FILE = path.join(DATA_DIR, "bot-replies.json");
const REPLIES_KEY = "bh:bot-replies";
const MAX_CUSTOM_COMMANDS = 40;

export const BOT_REPLY_FIELDS = [
  {
    key: "slotUsage",
    label: "Slot command — usage help",
    group: "Bonus Hunt",
    description: "Sent when someone types the slot command without a name.",
  },
  {
    key: "slotClosed",
    label: "Slot command — requests closed",
    group: "Bonus Hunt",
    description: "Sent when slot requests are closed.",
  },
  {
    key: "slotSuccess",
    label: "Slot command — success",
    group: "Bonus Hunt",
    description: "Vars: {slot} {group}",
  },
  {
    key: "slotSuccessPending",
    label: "Slot command — success (catalog pending)",
    group: "Bonus Hunt",
    description: "Vars: {slot}",
  },
  {
    key: "slotEnterName",
    label: "Slot command — empty name",
    group: "Bonus Hunt",
    description: "When the slot name is blank.",
  },
  {
    key: "slotUnknown",
    label: "Slot command — unknown slot",
    group: "Bonus Hunt",
    description: "Slot not in New Releases / Only on Stake.",
  },
  {
    key: "slotMultiple",
    label: "Slot command — multiple matches",
    group: "Bonus Hunt",
    description: "Vars: {names}",
  },
  {
    key: "slotCatalogMissing",
    label: "Slot command — catalog not loaded",
    group: "Bonus Hunt",
    description: "When the allowed slot list is empty.",
  },
  {
    key: "slotAffOnly",
    label: "Slot command — AFF only",
    group: "Bonus Hunt",
  },
  {
    key: "slotSubOnly",
    label: "Slot command — SUB only",
    group: "Bonus Hunt",
  },
  {
    key: "slotAffSubOnly",
    label: "Slot command — AFF/SUB only",
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
    label: "Points award — usage",
    group: "Points",
  },
  {
    key: "pointsUserNotFound",
    label: "Points award — user not found",
    group: "Points",
    description: "Vars: {username}",
  },
  {
    key: "pointsAwarded",
    label: "Points award — success",
    group: "Points",
    description: "Vars: {verb} {amount} {username} {balance}",
  },
  {
    key: "pointsAllUsage",
    label: "Points all — usage",
    group: "Points",
  },
  {
    key: "pointsAllAwarded",
    label: "Points all — success",
    group: "Points",
    description: "Vars: {amount} {count} {minutes}",
  },
];

export const DEFAULT_BOT_REPLIES = {
  slotUsage:
    "Use: !s <slot name> — up to 3 slots from New Releases or Only on Stake.",
  slotClosed: "Slot requests are closed right now.",
  slotSuccess: "Requested {slot} ({group}).",
  slotSuccessPending:
    "Requested {slot} (queued — streamer is syncing the slot list).",
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

export const DEFAULT_BOT_TRIGGERS = {
  slot: ["!s", "!slot"],
  points: ["!points"],
  pointsAll: ["!pointsall"],
};

export const BOT_TRIGGER_FIELDS = [
  {
    key: "slot",
    label: "Slot request command",
    description: "Comma-separated triggers, e.g. !s, !slot",
  },
  {
    key: "points",
    label: "Points award command",
    description: "Comma-separated triggers, e.g. !points",
  },
  {
    key: "pointsAll",
    label: "Points all command",
    description: "Comma-separated triggers, e.g. !pointsall",
  },
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

export function normalizeCommandTrigger(trigger) {
  let value = String(trigger || "")
    .trim()
    .replace(/\s+/g, "");
  if (!value) {
    return "";
  }

  value = value.replace(/^!+/, "");
  if (!value) {
    return "";
  }

  return `!${value}`.toLowerCase().slice(0, 32);
}

function parseTriggerList(raw, fallback) {
  let list = [];
  if (typeof raw === "string") {
    list = raw.split(/[,\n]+/);
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    list = fallback;
  }

  const normalized = [];
  const seen = new Set();
  for (const entry of list) {
    const trigger = normalizeCommandTrigger(entry);
    if (!trigger || seen.has(trigger)) continue;
    seen.add(trigger);
    normalized.push(trigger);
  }

  return normalized.length ? normalized : [...fallback];
}

function normalizeTriggers(raw) {
  return {
    slot: parseTriggerList(raw?.slot, DEFAULT_BOT_TRIGGERS.slot),
    points: parseTriggerList(raw?.points, DEFAULT_BOT_TRIGGERS.points),
    pointsAll: parseTriggerList(raw?.pointsAll, DEFAULT_BOT_TRIGGERS.pointsAll),
  };
}

function normalizeCustomCommands(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set();
  const commands = [];

  for (const entry of raw.slice(0, MAX_CUSTOM_COMMANDS)) {
    if (!entry || typeof entry !== "object") continue;
    const trigger = normalizeCommandTrigger(entry.trigger);
    const reply = String(entry.reply || "").trim().slice(0, 400);
    if (!trigger || !reply || seen.has(trigger)) continue;
    seen.add(trigger);

    commands.push({
      id: String(entry.id || crypto.randomUUID()),
      trigger,
      reply,
      enabled: entry.enabled !== false,
    });
  }

  return commands;
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

function defaultConfig() {
  return {
    replies: { ...DEFAULT_BOT_REPLIES },
    triggers: {
      slot: [...DEFAULT_BOT_TRIGGERS.slot],
      points: [...DEFAULT_BOT_TRIGGERS.points],
      pointsAll: [...DEFAULT_BOT_TRIGGERS.pointsAll],
    },
    customCommands: [],
  };
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return defaultConfig();
  }

  const legacyFlat = BOT_REPLY_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(raw, field.key)
  );
  const repliesSource =
    raw.replies && typeof raw.replies === "object"
      ? raw.replies
      : legacyFlat
        ? raw
        : {};

  return {
    replies: normalizeReplies(repliesSource),
    triggers: normalizeTriggers(raw.triggers),
    customCommands: normalizeCustomCommands(raw.customCommands),
  };
}

async function readRedisConfig() {
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
    return normalizeConfig(JSON.parse(data.result));
  } catch {
    return null;
  }
}

async function writeRedisConfig(botConfig) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(botConfig));
  const response = await fetch(`${config.url}/set/${REPLIES_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
}

async function readFileConfig() {
  try {
    const raw = await fs.readFile(REPLIES_FILE, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeFileConfig(botConfig) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REPLIES_FILE, JSON.stringify(botConfig, null, 2));
}

let memoryConfig = null;
let memoryLoadedAt = 0;
const MEMORY_TTL_MS = 5_000;

export async function getBotConfig() {
  if (memoryConfig && Date.now() - memoryLoadedAt < MEMORY_TTL_MS) {
    return memoryConfig;
  }

  const redis = await readRedisConfig();
  if (redis) {
    memoryConfig = redis;
    memoryLoadedAt = Date.now();
    return redis;
  }

  const file = await readFileConfig();
  if (file) {
    memoryConfig = file;
    memoryLoadedAt = Date.now();
    return file;
  }

  memoryConfig = defaultConfig();
  memoryLoadedAt = Date.now();
  return memoryConfig;
}

export async function getBotReplies() {
  const config = await getBotConfig();
  return config.replies;
}

export async function saveBotConfig( partial = {}) {
  const current = await getBotConfig();
  const next = normalizeConfig({
    replies: partial.replies ?? current.replies,
    triggers: partial.triggers ?? current.triggers,
    customCommands: partial.customCommands ?? current.customCommands,
  });

  memoryConfig = next;
  memoryLoadedAt = Date.now();

  const redisOk = await writeRedisConfig(next).catch(() => false);
  await writeFileConfig(next).catch(() => {});

  if (getRedisConfig() && !redisOk) {
    throw new Error("Could not save bot commands to Redis.");
  }

  return next;
}

/** @deprecated use saveBotConfig */
export async function saveBotReplies(partial) {
  return saveBotConfig({ replies: partial });
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

export function listBotTriggerFields() {
  return BOT_TRIGGER_FIELDS.map((field) => ({
    ...field,
    defaultValue: (DEFAULT_BOT_TRIGGERS[field.key] || []).join(", "),
  }));
}

export function matchCommandTrigger(text, triggers) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return null;
  }

  const list = [...(triggers || [])]
    .map(normalizeCommandTrigger)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const lower = cleaned.toLowerCase();
  for (const trigger of list) {
    if (lower === trigger) {
      return { trigger, args: "" };
    }
    if (lower.startsWith(`${trigger} `)) {
      return {
        trigger,
        args: cleaned.slice(trigger.length).trim(),
      };
    }
  }

  return null;
}

export async function matchCustomCommand(content) {
  const config = await getBotConfig();
  const cleaned = String(content || "")
    .replace(/\[emote:\d+:[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const matched = matchCommandTrigger(
    cleaned,
    config.customCommands.filter((entry) => entry.enabled).map((entry) => entry.trigger)
  );
  if (!matched) {
    return null;
  }

  const command = config.customCommands.find(
    (entry) => entry.enabled && entry.trigger === matched.trigger
  );
  if (!command) {
    return null;
  }

  return {
    ...command,
    args: matched.args,
  };
}
