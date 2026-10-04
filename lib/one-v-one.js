import fs from "fs/promises";
import path from "path";
import { botReply } from "./bot-replies.js";
import { listRecentKickChatMessages } from "./kick-chat-archive.js";
import {
  findAllowedSlotByQuery,
  getAllowedSlotCatalog,
} from "./stake-slots.js";

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

const ACTIVE_VIEWER_MINUTES = 5;

function emptyMatchup() {
  return {
    leftKickUserId: "",
    rightKickUserId: "",
    leftUsername: "",
    rightUsername: "",
    leftSlot: null,
    rightSlot: null,
  };
}

function normalizeSlot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slotName = String(raw.slotName || "").trim();
  if (!slotName) return null;
  return {
    slotName,
    slotSlug: String(raw.slotSlug || "").trim(),
    provider: raw.provider ? String(raw.provider) : "",
    thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl) : "",
  };
}

function normalizeMatchup(raw) {
  if (!raw || typeof raw !== "object") return emptyMatchup();
  return {
    leftKickUserId: String(raw.leftKickUserId || "").trim(),
    rightKickUserId: String(raw.rightKickUserId || "").trim(),
    leftUsername: String(raw.leftUsername || "").trim(),
    rightUsername: String(raw.rightUsername || "").trim(),
    leftSlot: normalizeSlot(raw.leftSlot),
    rightSlot: normalizeSlot(raw.rightSlot),
  };
}

function slugFromSlotQuery(query) {
  return (
    String(query || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pending-slot"
  );
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

function toPublicSlot(slot) {
  if (!slot) return null;
  return {
    slotName: slot.slotName,
    provider: slot.provider || null,
    thumbnailUrl: slot.thumbnailUrl || null,
  };
}

function toSide(username, slot) {
  if (!username) return null;
  return {
    username,
    slot: toPublicSlot(slot),
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
  const [matchup, viewers, chat] = await Promise.all([
    readMatchup(),
    listEligibleActiveViewers().catch(() => []),
    listRecentKickChatMessages().catch(() => []),
  ]);

  return {
    activeCount: viewers.length,
    activeMinutes: ACTIVE_VIEWER_MINUTES,
    chat,
    matchup: {
      left: toSide(matchup.leftUsername, matchup.leftSlot),
      right: toSide(matchup.rightUsername, matchup.rightSlot),
    },
  };
}

export async function assignDrawnViewerSlot({ kickUserId, slotQuery }) {
  const matchup = await readMatchup();
  const userId = String(kickUserId || "").trim();
  const side =
    userId && userId === matchup.leftKickUserId
      ? "left"
      : userId === matchup.rightKickUserId
        ? "right"
        : "";
  if (!side) return null;

  const query = String(slotQuery || "").trim();
  if (!query) {
    throw new Error(await botReply("slotEnterName"));
  }

  const catalog = await getAllowedSlotCatalog();
  let slot;

  if (!catalog.slots?.length) {
    slot = {
      slotName: query,
      slotSlug: slugFromSlotQuery(query),
      provider: "",
      thumbnailUrl: "",
    };
  } else {
    const result = findAllowedSlotByQuery(catalog, query);
    if (result.matches.length > 1) {
      const names = result.matches
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(", ");
      throw new Error(await botReply("slotMultiple", { names }));
    }
    if (!result.slot) {
      throw new Error(await botReply("slotUnknown"));
    }
    slot = {
      slotName: result.slot.name,
      slotSlug: result.slot.slug,
      provider: result.slot.provider || "",
      thumbnailUrl: result.slot.thumbnailUrl || "",
    };
  }

  await writeMatchup({
    ...matchup,
    [`${side}Slot`]: slot,
  });

  return {
    username: matchup[`${side}Username`],
    slot,
    pending: !slot.thumbnailUrl && !catalog.slots?.length,
  };
}

export async function drawOneVOneWinners() {
  const viewers = await listEligibleActiveViewers();
  if (viewers.length < 2) {
    throw new Error(
      "Need at least 2 active viewers. They have to chat in the last 5 minutes, link Stake, and not be blocked."
    );
  }

  const [left, right] = pickTwo(viewers);
  await writeMatchup({
    leftKickUserId: left.kickUserId,
    rightKickUserId: right.kickUserId,
    leftUsername: left.username,
    rightUsername: right.username,
    leftSlot: null,
    rightSlot: null,
  });

  try {
    const { sendKickChatMessage } = await import("./kick-chat.js");
    await sendKickChatMessage(
      `@${left.username} @${right.username} you're in the 1v1. Request your slot with !slot and the slot name.`
    );
  } catch (error) {
    console.error("1v1 draw announcement failed:", error.message);
  }

  return getOneVOneState();
}

export async function clearOneVOneMatchup() {
  await writeMatchup(emptyMatchup());
  return getOneVOneState();
}
