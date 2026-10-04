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

export const ONE_V_ONE_KEYWORD = "1v1";

function emptyMatchup() {
  return {
    open: false,
    entries: [],
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

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kickUserId = String(raw.kickUserId || "").trim();
  const username = String(raw.username || "").trim();
  if (!kickUserId || !username) return null;
  return {
    kickUserId,
    username,
    enteredAt: raw.enteredAt || new Date().toISOString(),
  };
}

function normalizeMatchup(raw) {
  if (!raw || typeof raw !== "object") return emptyMatchup();
  const seen = new Set();
  const entries = [];
  for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
    const normalized = normalizeEntry(entry);
    if (!normalized || seen.has(normalized.kickUserId)) continue;
    seen.add(normalized.kickUserId);
    entries.push(normalized);
  }

  return {
    open: Boolean(raw.open),
    entries,
    leftKickUserId: String(raw.leftKickUserId || "").trim(),
    rightKickUserId: String(raw.rightKickUserId || "").trim(),
    leftUsername: String(raw.leftUsername || "").trim(),
    rightUsername: String(raw.rightUsername || "").trim(),
    leftSlot: normalizeSlot(raw.leftSlot),
    rightSlot: normalizeSlot(raw.rightSlot),
  };
}

function isWebsiteAccount(user) {
  if (!user || user.banned) return false;
  if (String(user.stakeUsername || "").trim()) return true;
  return Array.isArray(user.loginHistory) && user.loginHistory.length > 0;
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

async function listEligibleEntrants(entries) {
  const { getAltSoftBlockIndex, getUserByKickId } = await import("./users.js");
  const softBlockIndex = await getAltSoftBlockIndex();
  const eligible = [];

  for (const entry of entries) {
    const kickUserId = String(entry.kickUserId || "").trim();
    if (!kickUserId) continue;
    if (softBlockIndex.get(kickUserId)?.softBlocked) continue;

    const user = await getUserByKickId(kickUserId);
    if (!isWebsiteAccount(user)) continue;

    eligible.push({
      kickUserId,
      username: user.username || entry.username || "viewer",
    });
  }

  return eligible;
}

function withoutEntrants(entries, kickUserIds) {
  const drop = new Set(kickUserIds.filter(Boolean));
  return entries.filter((entry) => !drop.has(entry.kickUserId));
}

function pickOne(viewers) {
  return viewers[Math.floor(Math.random() * viewers.length)];
}

function pickTwo(viewers) {
  const pool = [...viewers];
  const left = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const right = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [left, right];
}

async function announceDraw(usernames) {
  const names = usernames.filter(Boolean);
  if (!names.length) return;
  try {
    const { sendKickChatMessage } = await import("./kick-chat.js");
    await sendKickChatMessage(
      `${names.map((name) => `@${name}`).join(" ")} you're in the 1v1. Request your slot with !slot and the slot name.`
    );
  } catch (error) {
    console.error("1v1 draw announcement failed:", error.message);
  }
}

export async function getOneVOneState() {
  const [matchup, chat] = await Promise.all([
    readMatchup(),
    listRecentKickChatMessages().catch(() => []),
  ]);
  const entrants = await listEligibleEntrants(matchup.entries).catch(() => []);

  return {
    keyword: ONE_V_ONE_KEYWORD,
    entriesOpen: matchup.open,
    entryCount: entrants.length,
    chat,
    matchup: {
      left: toSide(matchup.leftUsername, matchup.leftSlot),
      right: toSide(matchup.rightUsername, matchup.rightSlot),
    },
  };
}

export async function setOneVOneEntriesOpen(open) {
  const state = await readMatchup();
  await writeMatchup({ ...state, open: Boolean(open) });
  return getOneVOneState();
}

export async function clearOneVOneEntries() {
  const state = await readMatchup();
  await writeMatchup({ ...state, entries: [] });
  return getOneVOneState();
}

export async function addOneVOneEntry({ kickUserId, username }) {
  const state = await readMatchup();
  if (!state.open) return { closed: true };

  const userId = String(kickUserId || "").trim();
  if (!userId) return { closed: true };

  const { getAltSoftBlockIndex, getUserByKickId } = await import("./users.js");
  const user = await getUserByKickId(userId);
  if (!isWebsiteAccount(user)) return { rejected: "account" };
  if ((await getAltSoftBlockIndex()).get(userId)?.softBlocked) return { rejected: "blocked" };
  if (state.entries.some((entry) => entry.kickUserId === userId)) {
    return { alreadyEntered: true };
  }

  await writeMatchup({
    ...state,
    entries: [
      ...state.entries,
      {
        kickUserId: userId,
        username: user.username || username || "viewer",
        enteredAt: new Date().toISOString(),
      },
    ],
  });
  return { entered: true };
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

export async function drawOneVOneWinners(count = 2) {
  const drawCount = Number(count) === 1 ? 1 : 2;
  const matchup = await readMatchup();
  const viewers = await listEligibleEntrants(matchup.entries);
  const needMessage =
    "Need at least 2 entrants. They have to type 1v1 in chat while entries are open and have an account on the site.";

  if (drawCount === 2) {
    if (viewers.length < 2) throw new Error(needMessage);
    const [left, right] = pickTwo(viewers);
    await writeMatchup({
      ...matchup,
      entries: withoutEntrants(matchup.entries, [left.kickUserId, right.kickUserId]),
      leftKickUserId: left.kickUserId,
      rightKickUserId: right.kickUserId,
      leftUsername: left.username,
      rightUsername: right.username,
      leftSlot: null,
      rightSlot: null,
    });
    await announceDraw([left.username, right.username]);
    return getOneVOneState();
  }

  const side = !matchup.leftKickUserId ? "left" : !matchup.rightKickUserId ? "right" : "";
  if (!side) {
    throw new Error("Remove a viewer before drawing 1.");
  }

  const seated = new Set(
    [matchup.leftKickUserId, matchup.rightKickUserId].filter(Boolean)
  );
  const pool = viewers.filter((viewer) => !seated.has(viewer.kickUserId));
  if (!pool.length) {
    throw new Error(
      seated.size
        ? "Need another entrant who is not already in the 1v1."
        : "Need at least 1 entrant. They have to type 1v1 in chat while entries are open and have an account on the site."
    );
  }

  const picked = pickOne(pool);
  await writeMatchup({
    ...matchup,
    entries: withoutEntrants(matchup.entries, [picked.kickUserId]),
    [`${side}KickUserId`]: picked.kickUserId,
    [`${side}Username`]: picked.username,
    [`${side}Slot`]: null,
  });
  await announceDraw([picked.username]);
  return getOneVOneState();
}

export async function removeOneVOneViewer(side) {
  const which = side === "left" || side === "right" ? side : "";
  if (!which) {
    throw new Error("Choose the left or right viewer.");
  }

  const matchup = await readMatchup();
  await writeMatchup({
    ...matchup,
    [`${which}KickUserId`]: "",
    [`${which}Username`]: "",
    [`${which}Slot`]: null,
  });
  return getOneVOneState();
}

export async function clearOneVOneMatchup() {
  const state = await readMatchup();
  await writeMatchup({
    ...state,
    leftKickUserId: "",
    rightKickUserId: "",
    leftUsername: "",
    rightUsername: "",
    leftSlot: null,
    rightSlot: null,
  });
  return getOneVOneState();
}
