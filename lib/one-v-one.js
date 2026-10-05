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
    bets: [],
    winner: "",
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

function normalizeBet(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kickUserId = String(raw.kickUserId || "").trim();
  const side = raw.side === "left" || raw.side === "right" ? raw.side : "";
  const amount = Math.floor(Number(raw.amount));
  if (!kickUserId || !side || !Number.isFinite(amount) || amount < 1) return null;
  return {
    kickUserId,
    username: String(raw.username || "viewer").trim() || "viewer",
    side,
    amount,
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
    bets: (Array.isArray(raw.bets) ? raw.bets : []).map(normalizeBet).filter(Boolean),
    winner: raw.winner === "left" || raw.winner === "right" ? raw.winner : "",
  };
}

function parseSide(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "1" || value === "left") return "left";
  if (value === "2" || value === "right") return "right";
  return "";
}

function sideNumber(side) {
  return side === "left" ? 1 : 2;
}

function poolTotal(bets, side) {
  return bets.filter((bet) => bet.side === side).reduce((sum, bet) => sum + bet.amount, 0);
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

function publicBets(matchup, viewerKickUserId = "") {
  const bets = Array.isArray(matchup.bets) ? matchup.bets : [];
  const mine = bets.find((bet) => bet.kickUserId === String(viewerKickUserId || "").trim());
  return {
    pools: {
      one: poolTotal(bets, "left"),
      two: poolTotal(bets, "right"),
    },
    myBet: mine ? { side: sideNumber(mine.side), amount: mine.amount } : null,
    winner: matchup.winner ? sideNumber(matchup.winner) : null,
  };
}

async function refundBets(bets) {
  if (!bets?.length) return;
  const { awardPoints } = await import("./points.js");
  for (const bet of bets) {
    await awardPoints({
      kickUserId: bet.kickUserId,
      username: bet.username,
      amount: bet.amount,
      note: "1v1 bet refund",
    });
  }
}

export async function getOneVOneState(viewerKickUserId = "") {
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
    ...publicBets(matchup, viewerKickUserId),
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

  if (matchup.winner) {
    throw new Error("Reset the 1v1 before drawing again.");
  }

  if (drawCount === 2) {
    if (viewers.length < 2) throw new Error(needMessage);
    const [left, right] = pickTwo(viewers);
    await refundBets(matchup.bets);
    await writeMatchup({
      ...matchup,
      entries: withoutEntrants(matchup.entries, [left.kickUserId, right.kickUserId]),
      bets: [],
      winner: "",
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
  const dropped = matchup.bets.filter((bet) => bet.side === side);
  await refundBets(dropped);
  await writeMatchup({
    ...matchup,
    entries: withoutEntrants(matchup.entries, [picked.kickUserId]),
    bets: matchup.bets.filter((bet) => bet.side !== side),
    [`${side}KickUserId`]: picked.kickUserId,
    [`${side}Username`]: picked.username,
    [`${side}Slot`]: null,
  });
  await announceDraw([picked.username]);
  return getOneVOneState();
}

export async function removeOneVOneViewer(side) {
  const which = parseSide(side);
  if (!which) {
    throw new Error("Choose side 1 or side 2.");
  }

  const matchup = await readMatchup();
  const dropped = matchup.bets.filter((bet) => bet.side === which);
  await refundBets(dropped);
  await writeMatchup({
    ...matchup,
    bets: matchup.bets.filter((bet) => bet.side !== which),
    winner: matchup.winner === which ? "" : matchup.winner,
    [`${which}KickUserId`]: "",
    [`${which}Username`]: "",
    [`${which}Slot`]: null,
  });
  return getOneVOneState();
}

export async function clearOneVOneMatchup() {
  const state = await readMatchup();
  await refundBets(state.bets);
  await writeMatchup({
    ...state,
    bets: [],
    winner: "",
    leftKickUserId: "",
    rightKickUserId: "",
    leftUsername: "",
    rightUsername: "",
    leftSlot: null,
    rightSlot: null,
  });
  return getOneVOneState();
}

export async function placeOneVOneBet({ kickUserId, username, side, amount }) {
  const which = parseSide(side);
  if (!which) throw new Error("Pick side 1 or side 2.");

  const userId = String(kickUserId || "").trim();
  if (!userId) throw new Error("Sign in to bet UncCoins.");

  const cost = Math.floor(Number(amount));
  if (!Number.isFinite(cost) || cost < 1) throw new Error("Bet at least 1 UncCoin.");
  if (cost > 5000) throw new Error("Max bet is 5,000 UncCoins.");

  const state = await readMatchup();
  if (state.winner) throw new Error("Betting is closed. This 1v1 already has a winner.");
  if (!state[`${which}KickUserId`]) throw new Error("That side doesn't have a viewer yet.");

  const existing = state.bets.find((bet) => bet.kickUserId === userId);
  if (existing && existing.side !== which) {
    throw new Error(`You already bet on side ${sideNumber(existing.side)}.`);
  }

  const { spendPoints, awardPoints } = await import("./points.js");
  await spendPoints({
    kickUserId: userId,
    username,
    amount: cost,
    note: `1v1 bet on side ${sideNumber(which)}`,
  });

  try {
    const fresh = await readMatchup();
    if (fresh.winner || !fresh[`${which}KickUserId`]) {
      throw new Error("Betting just closed.");
    }
    const bets = fresh.bets.map((bet) => ({ ...bet }));
    const mine = bets.find((bet) => bet.kickUserId === userId);
    if (mine && mine.side !== which) {
      throw new Error(`You already bet on side ${sideNumber(mine.side)}.`);
    }
    if (mine) mine.amount += cost;
    else {
      bets.push({
        kickUserId: userId,
        username: String(username || "viewer").trim() || "viewer",
        side: which,
        amount: cost,
      });
    }
    await writeMatchup({ ...fresh, bets });
  } catch (error) {
    await awardPoints({
      kickUserId: userId,
      username,
      amount: cost,
      note: "1v1 bet refund",
    });
    throw error;
  }

  return getOneVOneState(userId);
}

export async function settleOneVOne(side) {
  const which = parseSide(side);
  if (!which) throw new Error("Choose side 1 or side 2.");

  const state = await readMatchup();
  if (!state[`${which}KickUserId`]) throw new Error("That side is empty.");
  if (state.winner) throw new Error("This 1v1 is already settled.");

  const winners = state.bets.filter((bet) => bet.side === which);
  const losers = state.bets.filter((bet) => bet.side !== which);
  const winPool = winners.reduce((sum, bet) => sum + bet.amount, 0);
  const losePool = losers.reduce((sum, bet) => sum + bet.amount, 0);

  if (!winPool) {
    await refundBets(losers);
  } else {
    const { awardPoints } = await import("./points.js");
    let paid = 0;
    for (let index = 0; index < winners.length; index += 1) {
      const bet = winners[index];
      const share =
        index === winners.length - 1
          ? losePool - paid
          : Math.floor((bet.amount / winPool) * losePool);
      paid += share;
      await awardPoints({
        kickUserId: bet.kickUserId,
        username: bet.username,
        amount: bet.amount + share,
        note: `1v1 win on side ${sideNumber(which)}`,
      });
    }
  }

  await writeMatchup({ ...state, bets: [], winner: which });
  return getOneVOneState();
}
