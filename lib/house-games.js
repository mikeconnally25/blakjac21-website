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
const SESSION_TTL_MS = 15 * 60 * 1000;
const MIN_BET = 1;
const MAX_BET = 5000;

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const KENO_PAYTABLE = {
  1: { 1: 3 },
  2: { 2: 12 },
  3: { 2: 2, 3: 42 },
  4: { 2: 1, 3: 4, 4: 100 },
  5: { 3: 2, 4: 20, 5: 400 },
  6: { 3: 1, 4: 5, 5: 50, 6: 1000 },
  7: { 3: 1, 4: 3, 5: 15, 6: 100, 7: 2000 },
  8: { 4: 2, 5: 10, 6: 50, 7: 500, 8: 5000 },
  9: { 4: 1, 5: 5, 6: 20, 7: 100, 8: 1000, 9: 5000 },
  10: { 5: 2, 6: 10, 7: 40, 8: 200, 9: 1000, 10: 5000 },
};

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

function normalizeBet(raw) {
  const bet = Math.floor(Number(raw));
  if (!Number.isFinite(bet) || bet < MIN_BET) {
    throw new Error(`Bet at least ${MIN_BET} point.`);
  }
  if (bet > MAX_BET) {
    throw new Error(`Max bet is ${MAX_BET} points.`);
  }
  return bet;
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
  const pruned = { sessions: {} };
  const now = Date.now();
  for (const [id, session] of Object.entries(store.sessions || {})) {
    const created = Date.parse(session?.createdAt || "") || 0;
    if (created && now - created > SESSION_TTL_MS) continue;
    pruned.sessions[id] = session;
  }

  const config = getRedisConfig();
  if (config) {
    const value = JSON.stringify(pruned);
    const response = await fetch(`${config.url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", SESSIONS_KEY, value]),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Could not save house game session.");
    }
    return pruned;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("House games need shared storage (Upstash Redis).");
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(pruned, null, 2));
  return pruned;
}

function publicBlackjackState(session, { revealDealer = false } = {}) {
  const done = Boolean(session.resolved);
  const showDealer = revealDealer || done;
  return {
    sessionId: session.id,
    game: "blackjack",
    status: session.status,
    bet: session.bet,
    player: {
      cards: publicCards(session.player),
      total: handTotal(session.player),
    },
    dealer: {
      cards: publicCards(session.dealer, !showDealer),
      total: showDealer ? handTotal(session.dealer) : null,
    },
    result: session.result || null,
    payout: session.payout ?? null,
    canHit: !done && session.status === "player",
    canStand: !done && session.status === "player",
    canDouble:
      !done &&
      session.status === "player" &&
      session.player.length === 2 &&
      !session.doubled,
  };
}

async function resolveBlackjack(session, username) {
  let dealer = [...session.dealer];
  while (handTotal(dealer) < 17) {
    dealer.push(session.deck.shift());
  }

  const playerTotal = handTotal(session.player);
  const dealerTotal = handTotal(dealer);
  let result = "lose";
  let payout = 0;

  if (playerTotal > 21) {
    result = "bust";
    payout = 0;
  } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
    result = "win";
    payout = session.bet * 2;
  } else if (playerTotal === dealerTotal) {
    result = "push";
    payout = session.bet;
  } else {
    result = "lose";
    payout = 0;
  }

  session.dealer = dealer;
  session.status = "resolved";
  session.resolved = true;
  session.result = result;
  session.payout = payout;

  let balance = await getPointsBalance(session.kickUserId);
  if (payout > 0) {
    balance = await creditPoints({
      kickUserId: session.kickUserId,
      username,
      amount: payout,
      note: `Blackjack ${result}`,
    });
  }

  return { session, balance };
}

export async function startBlackjack({ kickUserId, username, bet }) {
  const wager = normalizeBet(bet);
  const balanceBefore = await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Blackjack wager",
  });

  const deck = buildDeck();
  const player = [deck.shift(), deck.shift()];
  const dealer = [deck.shift(), deck.shift()];
  const session = {
    id: crypto.randomUUID(),
    game: "blackjack",
    kickUserId: String(kickUserId),
    bet: wager,
    doubled: false,
    deck,
    player,
    dealer,
    status: "player",
    resolved: false,
    result: null,
    payout: null,
    createdAt: new Date().toISOString(),
  };

  const playerBj = isBlackjack(player);
  const dealerBj = isBlackjack(dealer);

  let balance = balanceBefore;
  if (playerBj || dealerBj) {
    session.status = "resolved";
    session.resolved = true;
    if (playerBj && dealerBj) {
      session.result = "push";
      session.payout = wager;
    } else if (playerBj) {
      session.result = "blackjack";
      session.payout = Math.floor(wager * 2.5);
    } else {
      session.result = "lose";
      session.payout = 0;
    }
    if (session.payout > 0) {
      balance = await creditPoints({
        kickUserId,
        username,
        amount: session.payout,
        note: `Blackjack ${session.result}`,
      });
    }
  }

  const store = await readSessions();
  store.sessions[session.id] = session;
  await writeSessions(store);

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
  if (!["hit", "stand", "double"].includes(act)) {
    throw new Error("Choose hit, stand, or double.");
  }

  const store = await readSessions();
  const session = store.sessions[id];
  if (!session || session.kickUserId !== String(kickUserId)) {
    throw new Error("Blackjack hand not found.");
  }
  if (session.resolved || session.status !== "player") {
    throw new Error("This hand is already finished.");
  }

  let balance = await getPointsBalance(kickUserId);

  if (act === "double") {
    if (session.player.length !== 2 || session.doubled) {
      throw new Error("You can only double on your first two cards.");
    }
    balance = await spendPoints({
      kickUserId,
      username,
      amount: session.bet,
      note: "Blackjack double",
    });
    session.bet *= 2;
    session.doubled = true;
    session.player.push(session.deck.shift());
    if (handTotal(session.player) > 21) {
      session.status = "resolved";
      session.resolved = true;
      session.result = "bust";
      session.payout = 0;
    } else {
      const settled = await resolveBlackjack(session, username);
      Object.assign(session, settled.session);
      balance = settled.balance;
    }
  } else if (act === "hit") {
    session.player.push(session.deck.shift());
    if (handTotal(session.player) > 21) {
      session.status = "resolved";
      session.resolved = true;
      session.result = "bust";
      session.payout = 0;
    }
  } else if (act === "stand") {
    const settled = await resolveBlackjack(session, username);
    Object.assign(session, settled.session);
    balance = settled.balance;
  }

  store.sessions[id] = session;
  await writeSessions(store);

  return {
    ...publicBlackjackState(session, { revealDealer: session.resolved }),
    balance,
  };
}

function rouletteColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export async function playRoulette({ kickUserId, username, bet, choice }) {
  const wager = normalizeBet(bet);
  const pick = String(choice || "").trim().toLowerCase();
  const allowed = new Set([
    "red",
    "black",
    "even",
    "odd",
    "low",
    "high",
    ...Array.from({ length: 37 }, (_, i) => String(i)),
  ]);
  if (!allowed.has(pick)) {
    throw new Error("Pick red, black, even, odd, low, high, or a number 0–36.");
  }

  await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Roulette wager",
  });

  const spin = cryptoInt(37);
  const color = rouletteColor(spin);
  let won = false;
  let multiplier = 0;

  if (/^\d+$/.test(pick)) {
    won = Number(pick) === spin;
    multiplier = 36;
  } else if (pick === "red" || pick === "black") {
    won = spin !== 0 && color === pick;
    multiplier = 2;
  } else if (pick === "even") {
    won = spin !== 0 && spin % 2 === 0;
    multiplier = 2;
  } else if (pick === "odd") {
    won = spin !== 0 && spin % 2 === 1;
    multiplier = 2;
  } else if (pick === "low") {
    won = spin >= 1 && spin <= 18;
    multiplier = 2;
  } else if (pick === "high") {
    won = spin >= 19 && spin <= 36;
    multiplier = 2;
  }

  const payout = won ? wager * multiplier : 0;
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
    bet: wager,
    choice: pick,
    spin,
    color,
    won,
    payout,
    result: won ? "win" : "lose",
    balance,
  };
}

export async function playKeno({ kickUserId, username, bet, picks }) {
  const wager = normalizeBet(bet);
  const selected = [
    ...new Set(
      (Array.isArray(picks) ? picks : [])
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 80)
    ),
  ].sort((a, b) => a - b);

  if (selected.length < 1 || selected.length > 10) {
    throw new Error("Pick between 1 and 10 keno numbers (1–80).");
  }

  await spendPoints({
    kickUserId,
    username,
    amount: wager,
    note: "Keno wager",
  });

  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  const drawn = shuffle(pool).slice(0, 20).sort((a, b) => a - b);
  const hits = selected.filter((n) => drawn.includes(n));
  const hitCount = hits.length;
  const table = KENO_PAYTABLE[selected.length] || {};
  const multiplier = Number(table[hitCount] || 0);
  const payout = multiplier > 0 ? wager * multiplier : 0;

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
