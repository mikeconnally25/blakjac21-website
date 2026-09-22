import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  creditPoints,
  getPointsBalance,
  spendPoints,
} from "./points.js";

const DATA_DIR = path.resolve("data");
const SESSIONS_FILE = path.join(DATA_DIR, "house-game-sessions.json");
const SESSIONS_KEY = "bj:house-games:sessions";
const SESSION_KEY_PREFIX = "bj:house-games:session:";
const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_SEC = Math.ceil(SESSION_TTL_MS / 1000);
const MIN_BET = 1;
const MAX_BET = 5000;
const DEFAULT_UNCAPPED_USERNAMES = ["captainbonk", "reachaces"];

function getUncappedUsernames() {
  const fromEnv = String(process.env.HOUSE_GAMES_UNCAPPED_USERNAMES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_UNCAPPED_USERNAMES, ...fromEnv]);
}

/** null = no house max (still limited by points balance). */
export function getHouseGamesMaxBet(username) {
  const name = String(username || "")
    .trim()
    .toLowerCase();
  if (name && getUncappedUsernames().has(name)) {
    return null;
  }
  return MAX_BET;
}

function normalizeBet(raw, username = null) {
  const bet = Math.floor(Number(raw));
  if (!Number.isFinite(bet) || bet < MIN_BET) {
    throw new Error(`Bet at least ${MIN_BET} point.`);
  }
  const maxBet = getHouseGamesMaxBet(username);
  if (maxBet != null && bet > maxBet) {
    throw new Error(`Max bet is ${maxBet} points.`);
  }
  return bet;
}

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const KENO_BOARD_SIZE = 40;
const KENO_DRAW_COUNT = 10;
const KENO_MAX_PICKS = 10;

/** Stake.com Keno paytables by risk (40 numbers, draw 10). Multipliers are total return. */
const KENO_PAYTABLES = {
  classic: {
    1: { 1: 3.96 },
    2: { 1: 1.9, 2: 4.5 },
    3: { 1: 1, 2: 3.1, 3: 10.4 },
    4: { 1: 0.8, 2: 1.8, 3: 5, 4: 22.5 },
    5: { 1: 0.25, 2: 1.4, 3: 4.1, 4: 16.5, 5: 36 },
    6: { 2: 1, 3: 3.68, 4: 7, 5: 16.5, 6: 40 },
    7: { 2: 0.47, 3: 3, 4: 4.5, 5: 14, 6: 31, 7: 60 },
    8: { 3: 2.2, 4: 4, 5: 13, 6: 22, 7: 55, 8: 70 },
    9: { 3: 1.55, 4: 3, 5: 8, 6: 15, 7: 44, 8: 60, 9: 85 },
    10: { 3: 1.4, 4: 2.25, 5: 4.5, 6: 8, 7: 17, 8: 50, 9: 80, 10: 100 },
  },
  low: {
    1: { 0: 0.7, 1: 1.85 },
    2: { 1: 2, 2: 3.8 },
    3: { 1: 1.1, 2: 1.38, 3: 26 },
    4: { 2: 2.2, 3: 7.9, 4: 90 },
    5: { 2: 1.5, 3: 4.2, 4: 13, 5: 300 },
    6: { 2: 1.1, 3: 2, 4: 6.2, 5: 100, 6: 700 },
    7: { 2: 1.1, 3: 1.6, 4: 3.5, 5: 15, 6: 225, 7: 700 },
    8: { 2: 1.1, 3: 1.5, 4: 2, 5: 5.5, 6: 39, 7: 100, 8: 800 },
    9: { 2: 1.1, 3: 1.3, 4: 1.7, 5: 2.5, 6: 7.5, 7: 50, 8: 250, 9: 1000 },
    10: {
      2: 1.1,
      3: 1.2,
      4: 1.3,
      5: 1.8,
      6: 3.5,
      7: 13,
      8: 50,
      9: 250,
      10: 1000,
    },
  },
  medium: {
    1: { 0: 0.4, 1: 2.75 },
    2: { 1: 1.8, 2: 5.1 },
    3: { 2: 2.8, 3: 50 },
    4: { 2: 1.7, 3: 10, 4: 100 },
    5: { 2: 1.4, 3: 4, 4: 14, 5: 390 },
    6: { 3: 3, 4: 9, 5: 180, 6: 710 },
    7: { 3: 2, 4: 7, 5: 30, 6: 400, 7: 800 },
    8: { 3: 2, 4: 4, 5: 11, 6: 67, 7: 400, 8: 900 },
    9: { 3: 2, 4: 2.5, 5: 5, 6: 15, 7: 100, 8: 500, 9: 1000 },
    10: {
      3: 1.6,
      4: 2,
      5: 4,
      6: 7,
      7: 26,
      8: 100,
      9: 500,
      10: 1000,
    },
  },
  high: {
    1: { 1: 3.96 },
    2: { 2: 17.1 },
    3: { 3: 81.5 },
    4: { 3: 10, 4: 259 },
    5: { 3: 4.5, 4: 48, 5: 450 },
    6: { 4: 11, 5: 350, 6: 710 },
    7: { 4: 7, 5: 90, 6: 400, 7: 800 },
    8: { 4: 5, 5: 20, 6: 270, 7: 600, 8: 900 },
    9: { 4: 4, 5: 11, 6: 56, 7: 500, 8: 800, 9: 1000 },
    10: {
      4: 3.5,
      5: 8,
      6: 13,
      7: 63,
      8: 500,
      9: 800,
      10: 1000,
    },
  },
};

function normalizeKenoRisk(raw) {
  const risk = String(raw || "")
    .trim()
    .toLowerCase();
  if (risk === "low" || risk === "medium" || risk === "high") return risk;
  return "classic";
}

function getKenoPaytable(risk, pickCount) {
  const tables = KENO_PAYTABLES[normalizeKenoRisk(risk)] || KENO_PAYTABLES.classic;
  return tables[pickCount] || {};
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function defaultSessions() {
  return { sessions: {} };
}

function cryptoInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = cryptoInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return shuffle(deck);
}

function cardValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function publicCards(cards, hideHole = false) {
  return cards.map((card, index) =>
    hideHole && index === 1
      ? { hidden: true }
      : { rank: card.rank, suit: card.suit, label: formatCard(card) }
  );
}

async function redisCommand(config, command) {
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
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Redis command failed.");
  }
  const data = await response.json().catch(() => ({}));
  return data.result;
}

function sessionRedisKey(id) {
  return `${SESSION_KEY_PREFIX}${String(id || "").trim()}`;
}

function activeBlackjackRedisKey(kickUserId) {
  return `bj:house-games:active:${String(kickUserId || "").trim()}`;
}

async function setActiveBlackjackPointer(kickUserId, sessionId) {
  const userId = String(kickUserId || "").trim();
  const id = String(sessionId || "").trim();
  if (!userId) return;

  const config = getRedisConfig();
  if (config) {
    try {
      if (!id) {
        await redisCommand(config, ["DEL", activeBlackjackRedisKey(userId)]);
        return;
      }
      await redisCommand(config, [
        "SET",
        activeBlackjackRedisKey(userId),
        id,
        "EX",
        SESSION_TTL_SEC,
      ]);
    } catch (error) {
      console.error("Could not update active blackjack pointer:", error.message);
    }
    return;
  }

  if (process.env.VERCEL === "1") return;

  const store = await readSessions();
  store.activeByUser = store.activeByUser || {};
  if (!id) {
    delete store.activeByUser[userId];
  } else {
    store.activeByUser[userId] = id;
  }
  await writeSessions(store);
}

async function getActiveBlackjackPointer(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;

  const config = getRedisConfig();
  if (config) {
    try {
      const raw = await redisCommand(config, [
        "GET",
        activeBlackjackRedisKey(userId),
      ]);
      return raw ? String(raw) : null;
    } catch {
      return null;
    }
  }

  const store = await readSessions();
  return store.activeByUser?.[userId] || null;
}

async function readSessions() {
  const config = getRedisConfig();
  if (config) {
    try {
      const response = await fetch(
        `${config.url}/get/${encodeURIComponent(SESSIONS_KEY)}`,
        {
          headers: { Authorization: `Bearer ${config.token}` },
          cache: "no-store",
        }
      );
      if (!response.ok) return defaultSessions();
      const data = await response.json().catch(() => ({}));
      const raw = data.result;
      if (!raw) return defaultSessions();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed?.sessions ? parsed : defaultSessions();
    } catch {
      return defaultSessions();
    }
  }

  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.sessions ? parsed : defaultSessions();
  } catch {
    return defaultSessions();
  }
}

async function writeSessions(store) {
  const pruned = { sessions: {}, activeByUser: {} };
  const now = Date.now();
  for (const [id, session] of Object.entries(store.sessions || {})) {
    const created = Date.parse(session?.createdAt || "") || 0;
    if (created && now - created > SESSION_TTL_MS) continue;
    pruned.sessions[id] = session;
  }

  for (const [userId, sessionId] of Object.entries(store.activeByUser || {})) {
    if (pruned.sessions[sessionId]) {
      pruned.activeByUser[userId] = sessionId;
    }
  }

  const config = getRedisConfig();
  if (config) {
    const value = JSON.stringify(pruned);
    await redisCommand(config, ["SET", SESSIONS_KEY, value]);
    return pruned;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("House games need shared storage (Upstash Redis).");
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(pruned, null, 2));
  return pruned;
}

/** Load one blackjack hand without rewriting the shared sessions blob. */
async function loadBlackjackSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  const config = getRedisConfig();
  if (config) {
    try {
      const raw = await redisCommand(config, ["GET", sessionRedisKey(id)]);
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed?.id) return parsed;
      }
    } catch {
      /* fall through to legacy blob */
    }

    // Legacy shared-blob fallback (pre per-session keys)
    const store = await readSessions();
    return store.sessions[id] || null;
  }

  const store = await readSessions();
  return store.sessions[id] || null;
}

async function saveBlackjackSession(session) {
  if (!session?.id) {
    throw new Error("Could not save house game session.");
  }

  const config = getRedisConfig();
  if (config) {
    await redisCommand(config, [
      "SET",
      sessionRedisKey(session.id),
      JSON.stringify(session),
      "EX",
      SESSION_TTL_SEC,
    ]);
    const open =
      !session.resolved && String(session.status || "") === "player";
    await setActiveBlackjackPointer(
      session.kickUserId,
      open ? session.id : null
    );
    return session;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("House games need shared storage (Upstash Redis).");
  }

  const store = await readSessions();
  store.sessions[session.id] = session;
  store.activeByUser = store.activeByUser || {};
  const open = !session.resolved && String(session.status || "") === "player";
  if (open) {
    store.activeByUser[String(session.kickUserId)] = session.id;
  } else if (store.activeByUser[String(session.kickUserId)] === session.id) {
    delete store.activeByUser[String(session.kickUserId)];
  }
  await writeSessions(store);
  return session;
}

function normalizeHands(session) {
  if (Array.isArray(session.hands) && session.hands.length) {
    return session.hands;
  }
  // Legacy single-hand sessions
  return [
    {
      cards: session.player || [],
      bet: session.bet || 0,
      doubled: Boolean(session.doubled),
      fromSplit: false,
      done: Boolean(session.resolved),
      result: session.result || null,
      payout: session.payout ?? null,
    },
  ];
}

function activeHandIndex(session) {
  const hands = normalizeHands(session);
  const idx = Number(session.activeHand);
  if (Number.isInteger(idx) && idx >= 0 && idx < hands.length && !hands[idx].done) {
    return idx;
  }
  const next = hands.findIndex((hand) => !hand.done);
  return next === -1 ? Math.max(0, hands.length - 1) : next;
}

function canSplitHand(session, hand) {
  const hands = normalizeHands(session);
  return (
    hands.length === 1 &&
    Array.isArray(hand?.cards) &&
    hand.cards.length === 2 &&
    hand.cards[0].rank === hand.cards[1].rank &&
    !hand.doubled &&
    !hand.done
  );
}

function canDoubleHand(hand) {
  if (!hand || hand.done || hand.doubled || hand.cards?.length !== 2) return false;
  // Split aces: one card only, no double/hit
  if (hand.fromSplit && hand.cards[0]?.rank === "A") return false;
  return true;
}

function canHitHand(hand) {
  if (!hand || hand.done) return false;
  if (hand.fromSplit && hand.cards?.[0]?.rank === "A") return false;
  return true;
}

function publicHand(hand, { active = false } = {}) {
  return {
    cards: publicCards(hand.cards || []),
    total: handTotal(hand.cards || []),
    bet: hand.bet,
    doubled: Boolean(hand.doubled),
    fromSplit: Boolean(hand.fromSplit),
    done: Boolean(hand.done),
    result: hand.result || null,
    payout: hand.payout ?? null,
    active,
  };
}

function summarizeResults(hands) {
  const results = hands.map((h) => h.result).filter(Boolean);
  if (!results.length) return null;
  if (results.every((r) => r === "blackjack")) return "blackjack";
  if (results.every((r) => r === "win" || r === "blackjack")) return "win";
  if (results.every((r) => r === "push")) return "push";
  if (results.every((r) => r === "lose" || r === "bust")) {
    return results.includes("bust") && results.every((r) => r === "bust")
      ? "bust"
      : "lose";
  }
  return "split";
}

function publicBlackjackState(session, { revealDealer = false } = {}) {
  const hands = normalizeHands(session);
  const done = Boolean(session.resolved);
  const showDealer = revealDealer || done;
  const activeIdx = activeHandIndex(session);
  const active = hands[activeIdx] || hands[0];
  const playing = !done && session.status === "player" && active && !active.done;

  return {
    sessionId: session.id,
    game: "blackjack",
    status: session.status,
    resolved: done,
    bet: active?.bet ?? session.bet,
    activeHand: activeIdx,
    hands: hands.map((hand, index) =>
      publicHand(hand, { active: playing && index === activeIdx })
    ),
    player: {
      cards: publicCards(active?.cards || []),
      total: handTotal(active?.cards || []),
    },
    dealer: {
      cards: publicCards(session.dealer, !showDealer),
      total: showDealer ? handTotal(session.dealer) : null,
    },
    result: session.result || null,
    payout: session.payout ?? null,
    canHit: playing && canHitHand(active),
    canStand: playing && Boolean(active),
    canDouble: playing && canDoubleHand(active),
    canSplit: playing && canSplitHand(session, active),
  };
}

function settleHandVsDealer(hand, dealerCards) {
  const playerTotal = handTotal(hand.cards);
  const dealerTotal = handTotal(dealerCards);
  let result = "lose";
  let payout = 0;

  if (playerTotal > 21) {
    result = "bust";
    payout = 0;
  } else if (
    isBlackjack(hand.cards) &&
    !hand.fromSplit &&
    !isBlackjack(dealerCards)
  ) {
    // Natural only on unsplit first hand (already handled at deal usually)
    result = "blackjack";
    payout = Math.floor(hand.bet * 2.5);
  } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
    result = "win";
    payout = hand.bet * 2;
  } else if (playerTotal === dealerTotal) {
    result = "push";
    payout = hand.bet;
  } else {
    result = "lose";
    payout = 0;
  }

  hand.done = true;
  hand.result = result;
  hand.payout = payout;
  return hand;
}

async function resolveBlackjack(session, username) {
  const hands = normalizeHands(session);
  const anyAlive = hands.some((hand) => handTotal(hand.cards) <= 21);

  let dealer = [...session.dealer];
  if (anyAlive) {
    while (handTotal(dealer) < 17) {
      dealer.push(session.deck.shift());
    }
  }

  let totalPayout = 0;
  for (const hand of hands) {
    if (!hand.done || hand.payout == null || hand.result == null) {
      settleHandVsDealer(hand, dealer);
    } else if (hand.result === "bust") {
      // already busted during play
      hand.payout = 0;
    }
    totalPayout += Math.max(0, Math.floor(Number(hand.payout) || 0));
  }

  session.hands = hands;
  session.dealer = dealer;
  session.player = hands[0]?.cards || [];
  session.bet = hands.reduce((sum, hand) => sum + (hand.bet || 0), 0);
  session.status = "resolved";
  session.resolved = true;
  session.result = summarizeResults(hands);
  session.payout = totalPayout;

  let balance = await getPointsBalance(session.kickUserId);
  if (totalPayout > 0) {
    balance = await creditPoints({
      kickUserId: session.kickUserId,
      username,
      amount: totalPayout,
      note: `Blackjack ${session.result}`,
    });
  }

  return { session, balance };
}

function markHandDone(hand, result, payout = 0) {
  hand.done = true;
  hand.result = result;
  hand.payout = payout;
}

function nextPlayableHand(session, fromIndex) {
  const hands = normalizeHands(session);
  for (let i = fromIndex + 1; i < hands.length; i += 1) {
    if (!hands[i].done) return i;
  }
  return -1;
}

async function finishHandOrAdvance(session, username, balance, finishedIndex = null) {
  const hands = normalizeHands(session);
  const idx =
    Number.isInteger(finishedIndex) && finishedIndex >= 0
      ? finishedIndex
      : activeHandIndex(session);
  const hand = hands[idx];

  if (hand && !hand.done && handTotal(hand.cards) > 21) {
    markHandDone(hand, "bust", 0);
  }

  session.hands = hands;
  const next = nextPlayableHand(session, idx);
  if (next >= 0) {
    session.activeHand = next;
    session.status = "player";
    session.player = hands[next].cards;
    return { session, balance };
  }

  const allBust = hands.every((h) => h.result === "bust");
  if (allBust) {
    session.hands = hands;
    session.status = "resolved";
    session.resolved = true;
    session.result = "bust";
    session.payout = 0;
    session.player = hands[0]?.cards || [];
    return {
      session,
      balance: balance || (await getPointsBalance(session.kickUserId)),
    };
  }

  return resolveBlackjack(session, username);
}

export async function getActiveBlackjack({ kickUserId }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;

  const activeId = await getActiveBlackjackPointer(userId);
  if (!activeId) return null;

  let session = null;
  try {
    session = await loadBlackjackSession(activeId);
  } catch {
    session = null;
  }

  if (!session || session.kickUserId !== userId) {
    await setActiveBlackjackPointer(userId, null);
    return null;
  }

  if (session.resolved || session.status !== "player") {
    await setActiveBlackjackPointer(userId, null);
    return null;
  }

  let balance = null;
  try {
    balance = await getPointsBalance(userId);
  } catch {
    balance = null;
  }

  return {
    ...publicBlackjackState(session, { revealDealer: false }),
    balance,
    resumed: true,
  };
}

export async function startBlackjack({ kickUserId, username, bet }) {
  // Refresh restores mid-hand; Deal should also recover it instead of hard-failing.
  const existing = await getActiveBlackjack({ kickUserId });
  if (existing?.sessionId) {
    return existing;
  }

  const wager = normalizeBet(bet, username);
  const balanceBefore = await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Blackjack wager",
  });

  const deck = buildDeck();
  const playerCards = [deck.shift(), deck.shift()];
  const dealer = [deck.shift(), deck.shift()];
  const hand = {
    cards: playerCards,
    bet: wager,
    doubled: false,
    fromSplit: false,
    done: false,
    result: null,
    payout: null,
  };

  const session = {
    id: crypto.randomUUID(),
    game: "blackjack",
    kickUserId: String(kickUserId),
    bet: wager,
    doubled: false,
    deck,
    player: playerCards,
    hands: [hand],
    activeHand: 0,
    dealer,
    status: "player",
    resolved: false,
    result: null,
    payout: null,
    createdAt: new Date().toISOString(),
  };

  const playerBj = isBlackjack(playerCards);
  const dealerBj = isBlackjack(dealer);

  let balance = balanceBefore;
  if (playerBj || dealerBj) {
    if (playerBj && dealerBj) {
      markHandDone(hand, "push", wager);
    } else if (playerBj) {
      markHandDone(hand, "blackjack", Math.floor(wager * 2.5));
    } else {
      markHandDone(hand, "lose", 0);
    }
    session.hands = [hand];
    session.status = "resolved";
    session.resolved = true;
    session.result = hand.result;
    session.payout = hand.payout;
    if (session.payout > 0) {
      balance = await creditPoints({
        kickUserId,
        username,
        amount: session.payout,
        note: `Blackjack ${session.result}`,
      });
    }
  }

  try {
    await saveBlackjackSession(session);
  } catch (error) {
    // Refund if the hand never got persisted after the wager.
    try {
      await creditPoints({
        kickUserId,
        username,
        amount: wager,
        note: "Blackjack wager refund",
      });
    } catch {
      /* ignore refund failure */
    }
    throw error;
  }

  return {
    ...publicBlackjackState(session, { revealDealer: session.resolved }),
    balance,
  };
}

export async function actBlackjack({
  kickUserId,
  username,
  sessionId,
  action,
}) {
  const id = String(sessionId || "").trim();
  const act = String(action || "").trim().toLowerCase();
  if (!id) throw new Error("Missing blackjack session.");
  if (!["hit", "stand", "double", "split"].includes(act)) {
    throw new Error("Choose hit, stand, double, or split.");
  }

  const session = await loadBlackjackSession(id);
  if (!session || session.kickUserId !== String(kickUserId)) {
    throw new Error("Blackjack hand not found.");
  }
  if (session.resolved || session.status !== "player") {
    throw new Error("This hand is already finished.");
  }

  let hands = normalizeHands(session);
  session.hands = hands;
  let activeIdx = activeHandIndex(session);
  session.activeHand = activeIdx;
  let hand = hands[activeIdx];
  if (!hand || hand.done) {
    throw new Error("No active blackjack hand.");
  }

  let balance = await getPointsBalance(kickUserId);

  if (act === "split") {
    if (!canSplitHand(session, hand)) {
      throw new Error("You can only split a matching pair once.");
    }
    balance = await spendPoints({
      kickUserId,
      username,
      amount: hand.bet,
      note: "Blackjack split",
    });

    const leftCard = hand.cards[0];
    const rightCard = hand.cards[1];
    const left = {
      cards: [leftCard, session.deck.shift()],
      bet: hand.bet,
      doubled: false,
      fromSplit: true,
      done: false,
      result: null,
      payout: null,
    };
    const right = {
      cards: [rightCard, session.deck.shift()],
      bet: hand.bet,
      doubled: false,
      fromSplit: true,
      done: false,
      result: null,
      payout: null,
    };

    hands = [left, right];
    session.hands = hands;
    session.activeHand = 0;
    session.player = left.cards;
    session.bet = left.bet + right.bet;

    // Split aces: one card each, then dealer (or next hand auto-done)
    if (leftCard.rank === "A") {
      markHandDone(left, null, null);
      markHandDone(right, null, null);
      const settled = await resolveBlackjack(session, username);
      Object.assign(session, settled.session);
      balance = settled.balance;
    }
  } else if (act === "double") {
    if (!canDoubleHand(hand)) {
      throw new Error("You can only double on your first two cards.");
    }
    balance = await spendPoints({
      kickUserId,
      username,
      amount: hand.bet,
      note: "Blackjack double",
    });
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(session.deck.shift());
    session.player = hand.cards;
    session.hands = hands;

    if (handTotal(hand.cards) > 21) {
      markHandDone(hand, "bust", 0);
      const advanced = await finishHandOrAdvance(
        session,
        username,
        balance,
        activeIdx
      );
      Object.assign(session, advanced.session);
      balance = advanced.balance;
    } else {
      markHandDone(hand, null, null);
      const advanced = await finishHandOrAdvance(
        session,
        username,
        balance,
        activeIdx
      );
      Object.assign(session, advanced.session);
      balance = advanced.balance;
    }
  } else if (act === "hit") {
    if (!canHitHand(hand)) {
      throw new Error("You cannot hit this hand.");
    }
    hand.cards.push(session.deck.shift());
    session.player = hand.cards;
    session.hands = hands;
    if (handTotal(hand.cards) > 21) {
      markHandDone(hand, "bust", 0);
      const advanced = await finishHandOrAdvance(
        session,
        username,
        balance,
        activeIdx
      );
      Object.assign(session, advanced.session);
      balance = advanced.balance;
    }
  } else if (act === "stand") {
    markHandDone(hand, null, null);
    session.hands = hands;
    const advanced = await finishHandOrAdvance(
      session,
      username,
      balance,
      activeIdx
    );
    Object.assign(session, advanced.session);
    balance = advanced.balance;
  }

  await saveBlackjackSession(session);

  return {
    ...publicBlackjackState(session, { revealDealer: session.resolved }),
    balance,
  };
}

function rouletteColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export async function playRoulette({
  kickUserId,
  username,
  bet,
  choice,
  picks,
}) {
  const unitBet = normalizeBet(bet, username);
  const outside = String(choice || "").trim().toLowerCase();
  const outsideAllowed = new Set([
    "red",
    "black",
    "even",
    "odd",
    "low",
    "high",
  ]);

  let numberPicks = [
    ...new Set(
      (Array.isArray(picks) ? picks : [])
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 36)
    ),
  ].sort((a, b) => a - b);

  // Legacy single-number choice support
  if (!numberPicks.length && /^\d+$/.test(outside)) {
    numberPicks = [Number(outside)];
  }

  const usingNumbers = numberPicks.length > 0;
  const usingOutside = outsideAllowed.has(outside);

  if (usingNumbers && usingOutside) {
    throw new Error("Choose either numbers or an outside bet, not both.");
  }
  if (!usingNumbers && !usingOutside) {
    throw new Error(
      "Pick 1–12 numbers (0–36), or red, black, even, odd, low, or high."
    );
  }
  if (usingNumbers && numberPicks.length > 12) {
    throw new Error("Pick up to 12 numbers.");
  }

  const totalWager = usingNumbers ? unitBet * numberPicks.length : unitBet;

  await spendPoints({
    kickUserId,
    username,
    amount: totalWager,
    note: "Roulette wager",
  });

  const spin = cryptoInt(37);
  const color = rouletteColor(spin);
  let won = false;
  let multiplier = 0;
  let hitPick = null;

  if (usingNumbers) {
    won = numberPicks.includes(spin);
    multiplier = 36;
    hitPick = won ? spin : null;
  } else if (outside === "red" || outside === "black") {
    won = spin !== 0 && color === outside;
    multiplier = 2;
  } else if (outside === "even") {
    won = spin !== 0 && spin % 2 === 0;
    multiplier = 2;
  } else if (outside === "odd") {
    won = spin !== 0 && spin % 2 === 1;
    multiplier = 2;
  } else if (outside === "low") {
    won = spin >= 1 && spin <= 18;
    multiplier = 2;
  } else if (outside === "high") {
    won = spin >= 19 && spin <= 36;
    multiplier = 2;
  }

  // Straight-up pays on the unit bet only (one winning number).
  const payout = won ? unitBet * multiplier : 0;
  let balance = await getPointsBalance(kickUserId);
  if (payout > 0) {
    balance = await creditPoints({
      kickUserId,
      username,
      amount: payout,
      note: "Roulette win",
    });
  }

  return {
    game: "roulette",
    bet: unitBet,
    totalBet: totalWager,
    choice: usingOutside ? outside : null,
    picks: usingNumbers ? numberPicks : [],
    hitPick,
    spin,
    color,
    won,
    payout,
    result: won ? "win" : "lose",
    balance,
  };
}

export async function playKeno({ kickUserId, username, bet, picks, risk }) {
  const wager = normalizeBet(bet, username);
  const kenoRisk = normalizeKenoRisk(risk);
  const selected = [
    ...new Set(
      (Array.isArray(picks) ? picks : [])
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= KENO_BOARD_SIZE)
    ),
  ].sort((a, b) => a - b);

  if (selected.length < 1 || selected.length > KENO_MAX_PICKS) {
    throw new Error(
      `Pick between 1 and ${KENO_MAX_PICKS} keno numbers (1–${KENO_BOARD_SIZE}).`
    );
  }

  await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Keno wager",
  });

  const pool = Array.from({ length: KENO_BOARD_SIZE }, (_, i) => i + 1);
  const drawn = shuffle(pool).slice(0, KENO_DRAW_COUNT).sort((a, b) => a - b);
  const hits = selected.filter((n) => drawn.includes(n));
  const hitCount = hits.length;
  const table = getKenoPaytable(kenoRisk, selected.length);
  const multiplier = Number(table[hitCount] || 0);
  const payout =
    multiplier > 0 ? Math.floor(wager * multiplier) : 0;

  let balance = await getPointsBalance(kickUserId);
  if (payout > 0) {
    balance = await creditPoints({
      kickUserId,
      username,
      amount: payout,
      note: "Keno win",
    });
  }

  return {
    game: "keno",
    bet: wager,
    risk: kenoRisk,
    picks: selected,
    drawn,
    hits,
    hitCount,
    multiplier,
    payout,
    won: payout > 0,
    result: payout > 0 ? "win" : "lose",
    balance,
  };
}
