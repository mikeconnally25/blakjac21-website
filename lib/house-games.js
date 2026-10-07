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
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
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

export function canSelfCreditHousePoints(username) {
  return getHouseGamesMaxBet(username) == null;
}

function normalizeBet(raw, username = null) {
  const bet = Math.floor(Number(raw));
  if (!Number.isFinite(bet) || bet < MIN_BET) {
    throw new Error(`Bet at least ${MIN_BET} UncCoin.`);
  }
  const maxBet = getHouseGamesMaxBet(username);
  if (maxBet != null && bet > maxBet) {
    throw new Error(`Max bet is ${maxBet} UncCoins.`);
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

const CARD_SUITS = ["S", "H", "D", "C"];
const CARD_RANKS = [
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

/** Stake Originals draws each card on its own, so every rank stays 1 in 13. */
function drawIndependentCard() {
  return {
    rank: CARD_RANKS[cryptoInt(CARD_RANKS.length)],
    suit: CARD_SUITS[cryptoInt(CARD_SUITS.length)],
  };
}

function buildDeck() {
  const deck = [];
  for (let i = 0; i < 80; i += 1) {
    deck.push(drawIndependentCard());
  }
  return deck;
}

function takeCard(session) {
  if (!Array.isArray(session.deck) || session.deck.length === 0) {
    session.deck = buildDeck();
  }
  return session.deck.shift();
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
    cardValue(hand.cards[0]) === cardValue(hand.cards[1]) &&
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

function isPlayableBlackjackSession(session) {
  if (!session || session.resolved || String(session.status || "") !== "player") {
    return false;
  }
  if (!Array.isArray(session.deck)) {
    return false;
  }
  const hands = normalizeHands(session);
  if (!hands.length) return false;
  const active = hands[activeHandIndex(session)];
  if (!active || active.done) return false;
  if (!Array.isArray(active.cards) || active.cards.length < 1) return false;
  return true;
}

async function discardUnplayableBlackjack(session, kickUserId) {
  const userId = String(kickUserId || session?.kickUserId || "").trim();
  if (userId) {
    await setActiveBlackjackPointer(userId, null);
  }
  if (!session?.id || session.resolved) return;
  session.resolved = true;
  session.status = "resolved";
  session.result = session.result || "lose";
  session.payout = session.payout ?? 0;
  try {
    await saveBlackjackSession(session);
  } catch {
    /* best-effort cleanup */
  }
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
    // Stake stands on every 17, including soft 17.
    while (handTotal(dealer) < 17) {
      dealer.push(takeCard(session));
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

  if (!session || String(session.kickUserId) !== userId) {
    await setActiveBlackjackPointer(userId, null);
    return null;
  }

  if (!isPlayableBlackjackSession(session)) {
    await discardUnplayableBlackjack(session, userId);
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
  // Unplayable leftovers (common after deploys / expired Redis state) are cleared
  // inside getActiveBlackjack so a fresh deal can start.
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
  if (!session || String(session.kickUserId) !== String(kickUserId)) {
    await setActiveBlackjackPointer(kickUserId, null);
    throw new Error("Blackjack hand not found. Deal a new hand.");
  }
  if (!isPlayableBlackjackSession(session)) {
    await discardUnplayableBlackjack(session, kickUserId);
    throw new Error("That hand expired. Deal a new hand.");
  }
  if (session.resolved || session.status !== "player") {
    await setActiveBlackjackPointer(kickUserId, null);
    throw new Error("This hand is already finished.");
  }

  let hands = normalizeHands(session);
  session.hands = hands;
  let activeIdx = activeHandIndex(session);
  session.activeHand = activeIdx;
  let hand = hands[activeIdx];
  if (!hand || hand.done) {
    await discardUnplayableBlackjack(session, kickUserId);
    throw new Error("That hand expired. Deal a new hand.");
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
      cards: [leftCard, takeCard(session)],
      bet: hand.bet,
      doubled: false,
      fromSplit: true,
      done: false,
      result: null,
      payout: null,
    };
    const right = {
      cards: [rightCard, takeCard(session)],
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
    hand.cards.push(takeCard(session));
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
    hand.cards.push(takeCard(session));
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
  // Keep shuffle order so the UI reveals balls in random draw order.
  const drawn = shuffle(pool).slice(0, KENO_DRAW_COUNT);
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

const TOP_DOLLAR_STRIP = [
  "dollar",
  "blank",
  "bar",
  "bar2",
  "dollar",
  "seven",
  "blank",
  "bar3",
  "dollar",
  "bar",
  "blank",
  "bar2",
];
const TOP_DOLLAR_NOTES = [5, 10, 15, 20, 25, 50, 100, 250, 500, 1000];
const TOP_DOLLAR_NOTE_WEIGHTS = [28, 22, 16, 12, 9, 6, 4, 2, 1];
const TOP_DOLLAR_OFFERS = 4;
const TOP_DOLLAR_TTL_SEC = 30 * 60;
const memoryTopDollar = new Map();

function topDollarRedisKey(kickUserId) {
  return `bj:house-games:top-dollar:${String(kickUserId || "").trim()}`;
}

function weightedPick(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = cryptoInt(total);
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return index;
  }
  return weights.length - 1;
}

function topDollarLine(reels) {
  const [a, b, c] = reels;
  if (a === "dollar" && b === "dollar" && c === "dollar") {
    return { kind: "bonus", label: "Top Dollar", multiplier: 0 };
  }
  if (a === "seven" && b === "seven" && c === "seven") {
    return { kind: "sevens", label: "Three 7s", multiplier: 20 };
  }
  if (a === "bar3" && b === "bar3" && c === "bar3") {
    return { kind: "bar3", label: "Triple bar", multiplier: 10 };
  }
  if (a === "bar2" && b === "bar2" && c === "bar2") {
    return { kind: "bar2", label: "Double bar", multiplier: 6 };
  }
  if (a === "bar" && b === "bar" && c === "bar") {
    return { kind: "bar", label: "Bar", multiplier: 4 };
  }
  const bars = new Set(["bar", "bar2", "bar3"]);
  if (bars.has(a) && bars.has(b) && bars.has(c)) {
    return { kind: "bars", label: "Any bar", multiplier: 2 };
  }
  return { kind: "miss", label: "", multiplier: 0 };
}

function rollTopDollarOffer() {
  if (cryptoInt(1000) < 4) {
    return { notes: [1000], multiplier: 1000, jackpot: true };
  }

  const countRoll = cryptoInt(100);
  const count = countRoll < 74 ? 1 : countRoll < 94 ? 2 : 3;
  const available = TOP_DOLLAR_NOTES.slice(0, -1).map((value, index) => ({
    value,
    weight: TOP_DOLLAR_NOTE_WEIGHTS[index],
  }));
  const notes = [];
  for (let drawn = 0; drawn < count; drawn += 1) {
    const index = weightedPick(available.map((item) => item.weight));
    notes.push(available[index].value);
    available.splice(index, 1);
  }
  notes.sort((left, right) => left - right);
  return {
    notes,
    multiplier: notes.reduce((sum, value) => sum + value, 0),
    jackpot: false,
  };
}

function topDollarAdvice(offerNumber, multiplier, jackpot) {
  if (jackpot || offerNumber >= TOP_DOLLAR_OFFERS) return "take";
  const floor = offerNumber === 1 ? 50 : offerNumber === 2 ? 45 : 35;
  return multiplier >= floor ? "take" : "again";
}

function publicTopDollarBonus(bonus) {
  if (!bonus) return { active: false };
  const legacy = !Array.isArray(bonus.notes);
  const notes = legacy
    ? [[10, 18, 30, 48, 75, 120, 190, 300][bonus.rung] || 10]
    : bonus.notes;
  const multiplier = legacy
    ? notes[0]
    : Number(bonus.multiplier) || notes.reduce((sum, value) => sum + value, 0);
  const offerNumber = legacy ? TOP_DOLLAR_OFFERS : Number(bonus.offerNumber) || 1;
  const jackpot = !legacy && Boolean(bonus.jackpot);
  return {
    active: true,
    notes,
    noteValues: TOP_DOLLAR_NOTES,
    multiplier,
    offer: bonus.bet * multiplier,
    bet: bonus.bet,
    offerNumber,
    offersTotal: TOP_DOLLAR_OFFERS,
    jackpot,
    canTryAgain: !legacy && !jackpot && offerNumber < TOP_DOLLAR_OFFERS,
    advice: topDollarAdvice(offerNumber, multiplier, jackpot || legacy),
  };
}

async function readTopDollarBonus(kickUserId) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return null;
  const config = getRedisConfig();
  if (config) {
    const raw = await redisCommand(config, ["GET", topDollarRedisKey(userId)]);
    if (!raw) return null;
    try {
      const bonus = JSON.parse(raw);
      return bonus && (Array.isArray(bonus.notes) || Number.isInteger(bonus.rung))
        ? bonus
        : null;
    } catch {
      return null;
    }
  }
  if (process.env.VERCEL === "1") return null;
  return memoryTopDollar.get(userId) || null;
}

async function writeTopDollarBonus(kickUserId, bonus) {
  const userId = String(kickUserId || "").trim();
  if (!userId) return;
  const config = getRedisConfig();
  if (config) {
    if (!bonus) {
      await redisCommand(config, ["DEL", topDollarRedisKey(userId)]);
      return;
    }
    await redisCommand(config, [
      "SET",
      topDollarRedisKey(userId),
      JSON.stringify(bonus),
      "EX",
      TOP_DOLLAR_TTL_SEC,
    ]);
    return;
  }
  if (process.env.VERCEL === "1") {
    throw new Error("Top Dollar bonus could not be saved.");
  }
  if (!bonus) memoryTopDollar.delete(userId);
  else memoryTopDollar.set(userId, bonus);
}

export async function getTopDollarBonus({ kickUserId }) {
  const bonus = await readTopDollarBonus(kickUserId);
  return { game: "top-dollar", ...publicTopDollarBonus(bonus) };
}

export async function playTopDollar({ kickUserId, username, bet }) {
  const pending = await readTopDollarBonus(kickUserId);
  if (pending) {
    throw new Error("Take or try again on the Top Dollar offer before spinning again.");
  }

  const wager = normalizeBet(bet, username);
  await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Top Dollar wager",
  });

  const reels = [0, 1, 2].map(
    () => TOP_DOLLAR_STRIP[cryptoInt(TOP_DOLLAR_STRIP.length)]
  );
  const line = topDollarLine(reels);
  let balance = await getPointsBalance(kickUserId);
  let payout = 0;
  let jackpot = false;

  if (line.kind === "bonus") {
    const rolled = rollTopDollarOffer();
    try {
      if (rolled.jackpot) {
        jackpot = true;
        payout = wager * rolled.multiplier;
        balance = await creditPoints({
          kickUserId,
          username,
          amount: payout,
          note: "Top Dollar jackpot",
        });
      } else {
        await writeTopDollarBonus(kickUserId, {
          bet: wager,
          offerNumber: 1,
          notes: rolled.notes,
          multiplier: rolled.multiplier,
          jackpot: false,
        });
      }
    } catch {
      payout = wager * 5;
      balance = await creditPoints({
        kickUserId,
        username,
        amount: payout,
        note: "Top Dollar bonus",
      });
    }
  } else if (line.multiplier > 0) {
    payout = wager * line.multiplier;
    balance = await creditPoints({
      kickUserId,
      username,
      amount: payout,
      note: "Top Dollar win",
    });
  }

  const bonus = publicTopDollarBonus(
    line.kind === "bonus" ? await readTopDollarBonus(kickUserId) : null
  );
  return {
    game: "top-dollar",
    action: "spin",
    bet: wager,
    reels,
    label: line.label,
    kind: line.kind,
    multiplier: bonus.active ? bonus.multiplier : jackpot ? 1000 : line.multiplier,
    notes: bonus.active ? bonus.notes : jackpot ? [1000] : [],
    payout,
    jackpot,
    won: payout > 0 || bonus.active,
    result: bonus.active ? "bonus" : jackpot ? "jackpot" : payout > 0 ? "win" : "lose",
    bonus,
    balance,
  };
}

function topDollarMultiplier(bonus) {
  if (Array.isArray(bonus.notes)) {
    return Number(bonus.multiplier) || bonus.notes.reduce((sum, value) => sum + value, 0);
  }
  return [10, 18, 30, 48, 75, 120, 190, 300][bonus.rung] || 10;
}

export async function actTopDollar({ kickUserId, username, action }) {
  const bonus = await readTopDollarBonus(kickUserId);
  if (!bonus) throw new Error("No Top Dollar offer is waiting.");

  const choice = String(action || "").trim().toLowerCase();
  const legacy = !Array.isArray(bonus.notes);
  const mustTake =
    choice === "take" ||
    legacy ||
    bonus.jackpot ||
    Number(bonus.offerNumber) >= TOP_DOLLAR_OFFERS;

  if (mustTake) {
    const multiplier = topDollarMultiplier(bonus);
    const payout = bonus.bet * multiplier;
    const balance = await creditPoints({
      kickUserId,
      username,
      amount: payout,
      note: bonus.jackpot ? "Top Dollar jackpot" : "Top Dollar bonus",
    });
    await writeTopDollarBonus(kickUserId, null);
    return {
      game: "top-dollar",
      action: "take",
      bet: bonus.bet,
      multiplier,
      payout,
      jackpot: Boolean(bonus.jackpot),
      won: true,
      result: bonus.jackpot ? "jackpot" : "win",
      bonus: { active: false },
      balance,
    };
  }

  if (choice !== "again" && choice !== "try" && choice !== "climb") {
    throw new Error("Take the offer or try again.");
  }

  const rolled = rollTopDollarOffer();
  const offerNumber = Number(bonus.offerNumber) + 1;
  if (rolled.jackpot) {
    const payout = bonus.bet * rolled.multiplier;
    const balance = await creditPoints({
      kickUserId,
      username,
      amount: payout,
      note: "Top Dollar jackpot",
    });
    await writeTopDollarBonus(kickUserId, null);
    return {
      game: "top-dollar",
      action: "again",
      bet: bonus.bet,
      multiplier: rolled.multiplier,
      notes: rolled.notes,
      payout,
      jackpot: true,
      won: true,
      result: "jackpot",
      bonus: { active: false },
      balance,
    };
  }

  const next = {
    bet: bonus.bet,
    offerNumber,
    notes: rolled.notes,
    multiplier: rolled.multiplier,
    jackpot: false,
  };
  await writeTopDollarBonus(kickUserId, next);
  const balance = await getPointsBalance(kickUserId);
  return {
    game: "top-dollar",
    action: "again",
    bet: bonus.bet,
    multiplier: rolled.multiplier,
    notes: rolled.notes,
    payout: 0,
    jackpot: false,
    won: false,
    result: "again",
    bonus: publicTopDollarBonus(next),
    balance,
  };
}
