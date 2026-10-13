import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { creditPoints, getPointsBalance, spendPoints } from "./points.js";
import { getHouseGamesMaxBet } from "./house-games.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "average-x.json");
const STATE_KEY = "bj:average-x";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Average X store failed (${response.status})`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error("Average X store failed.");
  }
  return data?.result ?? null;
}

export function defaultRanges() {
  return [
    { id: "under-1", label: "Under 1x", min: 0, max: 1 },
    { id: "1-1.5", label: "1x – 1.5x", min: 1, max: 1.5 },
    { id: "1.5-2", label: "1.5x – 2x", min: 1.5, max: 2 },
    { id: "2-2.5", label: "2x – 2.5x", min: 2, max: 2.5 },
    { id: "2.5-3", label: "2.5x – 3x", min: 2.5, max: 3 },
    { id: "3-3.5", label: "3x – 3.5x", min: 3, max: 3.5 },
    { id: "3.5-4", label: "3.5x – 4x", min: 3.5, max: 4 },
    { id: "4-5", label: "4x – 5x", min: 4, max: 5 },
    { id: "over-5", label: "Over 5x", min: 5, max: null },
  ];
}

function emptyRound() {
  return {
    id: "",
    status: "idle",
    slot: null,
    bonuses: [],
    ranges: defaultRanges(),
    bets: [],
    averageX: null,
    winningRangeId: "",
    settledAt: "",
  };
}

function emptySide() {
  return { slot: null, bonuses: [] };
}

function emptyHead() {
  return {
    id: "",
    status: "idle",
    left: emptySide(),
    right: emptySide(),
    bets: [],
    winner: "",
    settledAt: "",
  };
}

export function headWinner(leftAverage, rightAverage) {
  if (leftAverage == null || rightAverage == null) return null;
  if (Number(leftAverage) === Number(rightAverage)) return "tie";
  return Number(leftAverage) > Number(rightAverage) ? "left" : "right";
}

function money(raw, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} needs to be above 0.`);
  }
  return Math.round(value * 100) / 100;
}

function winTotal(raw) {
  if (raw === "" || raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Win totals can't be negative.");
  }
  return Math.round(value * 100) / 100;
}

export function averageOf(bonuses, { filledOnly = false } = {}) {
  const rows = filledOnly
    ? bonuses.filter((bonus) => bonus.win != null)
    : bonuses;
  const cost = rows.reduce((sum, bonus) => sum + Number(bonus.cost || 0), 0);
  const win = rows.reduce((sum, bonus) => sum + Number(bonus.win || 0), 0);
  if (!rows.length || cost <= 0) return null;
  return Math.round((win / cost) * 100) / 100;
}

export function rangeForAverage(ranges, average) {
  if (average == null || !Number.isFinite(Number(average))) return null;
  const value = Number(average);
  return (
    ranges.find(
      (range) =>
        value >= range.min && (range.max == null || value < range.max)
    ) || null
  );
}

export function splitPool(bets, winningRangeId) {
  const pool = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const winners = bets.filter((bet) => bet.rangeId === winningRangeId);
  const winningStake = winners.reduce((sum, bet) => sum + bet.amount, 0);

  if (!winners.length || pool < 1) {
    return bets.map((bet) => ({
      kickUserId: bet.kickUserId,
      payout: bet.amount,
      refund: true,
    }));
  }

  let remainder = pool;
  const shares = winners.map((bet) => {
    const payout = Math.floor((pool * bet.amount) / winningStake);
    remainder -= payout;
    return { kickUserId: bet.kickUserId, amount: bet.amount, payout, refund: false };
  });
  shares.sort((a, b) => b.amount - a.amount || a.kickUserId.localeCompare(b.kickUserId));
  let index = 0;
  while (remainder > 0 && shares.length && index < pool + shares.length) {
    shares[index % shares.length].payout += 1;
    remainder -= 1;
    index += 1;
  }

  const winnerIds = new Set(shares.map((share) => share.kickUserId));
  const losers = bets
    .filter((bet) => !winnerIds.has(bet.kickUserId))
    .map((bet) => ({
      kickUserId: bet.kickUserId,
      payout: 0,
      refund: false,
    }));

  return [...shares.map(({ kickUserId, payout, refund }) => ({ kickUserId, payout, refund })), ...losers];
}

function normalizeSlot(raw) {
  const name = String(raw?.name || "").trim();
  const slug = String(raw?.slug || "").trim().toLowerCase();
  if (!name) throw new Error("Pick a slot.");
  return {
    name,
    slug,
    provider: String(raw?.provider || "").trim(),
    thumbnailUrl: String(raw?.thumbnailUrl || "").trim(),
  };
}

function normalizeBonuses(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error("Add at least one bonus buy.");
  }
  if (raw.length > 200) {
    throw new Error("A round can hold up to 200 bonuses.");
  }
  return raw.map((row, index) => ({
    id: String(row?.id || `b${index + 1}`),
    cost: money(row?.cost, `Bonus ${index + 1} cost`),
    win: winTotal(row?.win),
  }));
}

function withCurrentRanges(round) {
  if (round.status !== "settled" && !round.bets.length) {
    round.ranges = defaultRanges();
  }
  return round;
}

function ensureState(round) {
  const next = withCurrentRanges({ ...emptyRound(), ...round });
  const storedHead = round?.head || {};
  next.head = {
    ...emptyHead(),
    ...storedHead,
    left: { ...emptySide(), ...(storedHead.left || {}) },
    right: { ...emptySide(), ...(storedHead.right || {}) },
    bets: Array.isArray(storedHead.bets) ? storedHead.bets : [],
  };
  return next;
}

async function readState() {
  const stored = await redisCommand(["GET", STATE_KEY]);
  if (stored) {
    try {
      return ensureState(JSON.parse(stored));
    } catch {
      return ensureState(emptyRound());
    }
  }

  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return ensureState(JSON.parse(raw));
  } catch {
    return ensureState(emptyRound());
  }
}

async function writeState(round) {
  const payload = JSON.stringify(round);
  if (getRedisConfig()) {
    await redisCommand(["SET", STATE_KEY, payload]);
    return round;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, payload);
  return round;
}

function poolRows(round) {
  return round.ranges.map((range, index) => {
    const bets = round.bets.filter((bet) => bet.rangeId === range.id);
    return {
      ...range,
      team: index + 1,
      stake: bets.reduce((sum, bet) => sum + bet.amount, 0),
      count: bets.length,
    };
  });
}

export function parseAverageXBetCommand(content) {
  const text = String(content || "")
    .replace(/\[emote:\d+:[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^!bet\b/i.test(text)) return null;
  const match = text.match(/^!bet\s+(\d+)\s+team\s*(\d+)\s*$/i);
  if (!match) return { invalid: true };
  return { amount: Number(match[1]), team: Number(match[2]) };
}

export function rangeForTeam(ranges, team) {
  const index = Number(team) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= ranges.length) return null;
  return ranges[index] || null;
}

export function averageXTeamList(ranges) {
  return (ranges || [])
    .map((range, index) => `${index + 1} ${range.label}`)
    .join(", ");
}

export async function publicAverageX(session) {
  const round = await readState();
  const userId = String(session?.kickUserId || "");
  const yourBet = round.bets.find((bet) => bet.kickUserId === userId) || null;
  let balance = null;
  let maxBet = null;
  if (userId) {
    const points = await getPointsBalance(userId);
    balance = points?.points ?? 0;
    maxBet = getHouseGamesMaxBet(session?.username);
  }

  const filled = round.bonuses.filter((bonus) => bonus.win != null);
  return {
    id: round.id,
    status: round.status,
    slot: round.slot,
    bonuses: round.bonuses.map((bonus) => ({
      ...bonus,
      x:
        bonus.win == null || !bonus.cost
          ? null
          : Math.round((bonus.win / bonus.cost) * 100) / 100,
    })),
    ranges: poolRows(round),
    bets: round.bets.map((bet) => ({
      kickUserId: bet.kickUserId,
      username: bet.username,
      rangeId: bet.rangeId,
      amount: bet.amount,
      payout: bet.payout ?? null,
      refund: Boolean(bet.refund),
    })),
    averageX: round.status === "settled" ? round.averageX : averageOf(round.bonuses, { filledOnly: true }),
    final: round.status === "settled",
    filledCount: filled.length,
    bonusCount: round.bonuses.length,
    winningRangeId: round.winningRangeId || "",
    settledAt: round.settledAt || "",
    yourBet,
    balance,
    maxBet,
    isAdmin: Boolean(session?.isAdmin),
    pool: round.bets.reduce((sum, bet) => sum + bet.amount, 0),
    head: publicHead(round.head, userId),
  };
}

function bonusView(bonus) {
  return {
    ...bonus,
    x:
      bonus.win == null || !bonus.cost
        ? null
        : Math.round((bonus.win / bonus.cost) * 100) / 100,
  };
}

function publicSide(side, final) {
  const bonuses = side?.bonuses || [];
  const filled = bonuses.filter((bonus) => bonus.win != null);
  return {
    slot: side?.slot || null,
    bonuses: bonuses.map(bonusView),
    averageX: final ? averageOf(bonuses) : averageOf(bonuses, { filledOnly: true }),
    filledCount: filled.length,
    bonusCount: bonuses.length,
  };
}

function publicHead(head, userId) {
  const match = head || emptyHead();
  const final = match.status === "settled";
  const yourBet = match.bets.find((bet) => bet.kickUserId === userId) || null;
  const sides = ["left", "right"].map((side) => {
    const bets = match.bets.filter((bet) => bet.side === side);
    return {
      side,
      team: side === "left" ? 1 : 2,
      ...publicSide(match[side], final),
      stake: bets.reduce((sum, bet) => sum + bet.amount, 0),
      count: bets.length,
    };
  });
  return {
    id: match.id,
    status: match.status,
    left: sides[0],
    right: sides[1],
    winner: match.winner || "",
    settledAt: match.settledAt || "",
    final,
    yourBet,
    pool: match.bets.reduce((sum, bet) => sum + bet.amount, 0),
    bets: match.bets.map((bet) => ({
      kickUserId: bet.kickUserId,
      username: bet.username,
      side: bet.side,
      amount: bet.amount,
      payout: bet.payout ?? null,
      refund: Boolean(bet.refund),
    })),
  };
}

export async function saveAverageXSetup({ slot, bonuses }) {
  const current = await readState();
  if (current.status === "open" || current.status === "locked") {
    throw new Error("Close and settle the current round before starting another.");
  }
  if (current.bets.some((bet) => bet.payout == null && current.status !== "idle" && current.status !== "settled")) {
    throw new Error("Refund the open bets before changing the round.");
  }

  const round = {
    ...emptyRound(),
    id: crypto.randomUUID(),
    status: "setup",
    slot: normalizeSlot(slot),
    bonuses: normalizeBonuses(bonuses).map((bonus) => ({ ...bonus, win: null })),
    ranges: defaultRanges(),
    head: current.head,
  };
  await writeState(round);
  return round;
}

export async function openAverageXBets() {
  const round = await readState();
  if (round.status !== "setup") {
    throw new Error("Set the slot and bonus buys before opening bets.");
  }
  if (!round.slot || !round.bonuses.length) {
    throw new Error("Add a slot and at least one bonus buy.");
  }
  round.status = "open";
  await writeState(round);
  return round;
}

export async function closeAverageXBets() {
  const round = await readState();
  if (round.status !== "open") {
    throw new Error("Bets are not open.");
  }
  round.status = "locked";
  await writeState(round);
  return round;
}

export async function saveAverageXTotals(wins) {
  const round = await readState();
  if (round.status !== "locked" && round.status !== "setup") {
    throw new Error("Close bets before entering win totals.");
  }
  if (round.status === "setup") {
    round.status = "locked";
  }
  if (!Array.isArray(wins) || wins.length !== round.bonuses.length) {
    throw new Error("Enter a total for every bonus.");
  }
  round.bonuses = round.bonuses.map((bonus, index) => ({
    ...bonus,
    win: winTotal(wins[index]),
  }));
  await writeState(round);
  return round;
}

async function payBet(round, bet, payout, refund) {
  if (bet.paid) return;
  if (payout > 0) {
    await creditPoints({
      kickUserId: bet.kickUserId,
      username: bet.username,
      amount: payout,
      note: refund ? "Average X refund" : "Average X win",
    });
  }
  bet.paid = true;
  bet.payout = payout;
  bet.refund = refund;
  await writeState(round);
}

export async function settleAverageX() {
  const round = await readState();
  if (round.status !== "locked" && round.status !== "settled") {
    throw new Error("Close bets before settling.");
  }
  if (round.bonuses.some((bonus) => bonus.win == null)) {
    throw new Error("Enter a win total for every bonus before settling.");
  }

  if (round.status !== "settled") {
    const averageX = averageOf(round.bonuses);
    const winning = rangeForAverage(round.ranges, averageX);
    if (!winning) throw new Error("That average does not match a range.");
    round.averageX = averageX;
    round.winningRangeId = winning.id;
    round.status = "settled";
    round.settledAt = new Date().toISOString();
    const shares = splitPool(round.bets, winning.id);
    const byId = new Map(shares.map((share) => [share.kickUserId, share]));
    await writeState(round);
    for (const bet of round.bets) {
      const share = byId.get(bet.kickUserId);
      await payBet(round, bet, share?.payout || 0, Boolean(share?.refund));
    }
  } else {
    for (const bet of round.bets) {
      if (!bet.paid) {
        await payBet(round, bet, bet.payout || 0, Boolean(bet.refund));
      }
    }
  }

  return round;
}

export async function placeAverageXBet({ kickUserId, username, rangeId, amount }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) throw new Error("Sign in to bet.");

  const round = await readState();
  if (round.status !== "open") throw new Error("Bets are closed.");
  const range = round.ranges.find((item) => item.id === rangeId);
  if (!range) throw new Error("Pick a range.");

  const maxBet = getHouseGamesMaxBet(username);
  const stake = Math.floor(Number(amount));
  if (!Number.isFinite(stake) || stake < 1) throw new Error("Bet at least 1 UncCoin.");
  if (stake > maxBet) throw new Error(`The max bet is ${maxBet} UncCoins.`);

  const existing = round.bets.find((bet) => bet.kickUserId === userId);
  if (existing) {
    if (existing.rangeId === rangeId && existing.amount === stake) {
      return round;
    }
    await creditPoints({
      kickUserId: userId,
      username,
      amount: existing.amount,
      note: "Average X bet change",
    });
    round.bets = round.bets.filter((bet) => bet.kickUserId !== userId);
    await writeState(round);
  }

  try {
    await spendPoints({
      kickUserId: userId,
      username,
      amount: stake,
      note: "Average X bet",
    });
  } catch (error) {
    if (existing) {
      try {
        await spendPoints({
          kickUserId: userId,
          username,
          amount: existing.amount,
          note: "Average X bet restore",
        });
        round.bets.push(existing);
      } catch {
        // The new bet was rejected and the old stake stays refunded.
      }
      await writeState(round);
    }
    throw error;
  }

  round.bets.push({
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    rangeId,
    amount: stake,
    payout: null,
    refund: false,
    paid: false,
  });
  await writeState(round);
  return round;
}

export async function resetAverageX() {
  const round = await readState();
  if (round.status === "open" || round.status === "locked" || round.status === "setup") {
    for (const bet of round.bets) {
      if (!bet.paid) {
        await payBet(round, bet, bet.amount, true);
      }
    }
  }
  const next = emptyRound();
  next.head = round.head;
  await writeState(next);
  return next;
}

function freshSide(slot, bonuses) {
  return {
    slot: normalizeSlot(slot),
    bonuses: normalizeBonuses(bonuses).map((bonus) => ({ ...bonus, win: null })),
  };
}

export async function saveHeadSetup({ left, right }) {
  const round = await readState();
  const head = round.head;
  if (head.status === "open" || head.status === "locked") {
    throw new Error("Close and settle the head to head before starting another.");
  }
  round.head = {
    ...emptyHead(),
    id: crypto.randomUUID(),
    status: "setup",
    left: freshSide(left?.slot, left?.bonuses),
    right: freshSide(right?.slot, right?.bonuses),
  };
  await writeState(round);
  return round;
}

export async function openHeadBets() {
  const round = await readState();
  const head = round.head;
  if (head.status !== "setup") {
    throw new Error("Set both slots and their bonus buys before opening bets.");
  }
  if (!head.left.slot || !head.right.slot || !head.left.bonuses.length || !head.right.bonuses.length) {
    throw new Error("Each slot needs at least one bonus buy.");
  }
  head.status = "open";
  await writeState(round);
  return round;
}

export async function closeHeadBets() {
  const round = await readState();
  if (round.head.status !== "open") throw new Error("Head to head bets are not open.");
  round.head.status = "locked";
  await writeState(round);
  return round;
}

export async function saveHeadTotals({ leftWins, rightWins }) {
  const round = await readState();
  const head = round.head;
  if (head.status !== "locked" && head.status !== "setup") {
    throw new Error("Close head to head bets before entering win totals.");
  }
  if (head.status === "setup") head.status = "locked";
  if (!Array.isArray(leftWins) || leftWins.length !== head.left.bonuses.length) {
    throw new Error("Enter a total for every bonus on slot 1.");
  }
  if (!Array.isArray(rightWins) || rightWins.length !== head.right.bonuses.length) {
    throw new Error("Enter a total for every bonus on slot 2.");
  }
  head.left.bonuses = head.left.bonuses.map((bonus, index) => ({
    ...bonus,
    win: winTotal(leftWins[index]),
  }));
  head.right.bonuses = head.right.bonuses.map((bonus, index) => ({
    ...bonus,
    win: winTotal(rightWins[index]),
  }));
  await writeState(round);
  return round;
}

async function payHeadBet(round, bet, payout, refund) {
  if (bet.paid) return;
  if (payout > 0) {
    await creditPoints({
      kickUserId: bet.kickUserId,
      username: bet.username,
      amount: payout,
      note: refund ? "Head to head refund" : "Head to head win",
    });
  }
  bet.paid = true;
  bet.payout = payout;
  bet.refund = refund;
  await writeState(round);
}

export async function settleHead() {
  const round = await readState();
  const head = round.head;
  if (head.status !== "locked" && head.status !== "settled") {
    throw new Error("Close head to head bets before settling.");
  }
  if (head.left.bonuses.some((bonus) => bonus.win == null) || head.right.bonuses.some((bonus) => bonus.win == null)) {
    throw new Error("Enter a win total for every bonus on both slots.");
  }

  if (head.status !== "settled") {
    const winner = headWinner(averageOf(head.left.bonuses), averageOf(head.right.bonuses));
    if (!winner) throw new Error("Both slots need a finished average.");
    head.winner = winner;
    head.status = "settled";
    head.settledAt = new Date().toISOString();
    const tagged = head.bets.map((bet) => ({ ...bet, rangeId: bet.side }));
    const shares = splitPool(tagged, winner === "tie" ? "tie" : winner);
    const byId = new Map(shares.map((share) => [share.kickUserId, share]));
    await writeState(round);
    for (const bet of head.bets) {
      const share = byId.get(bet.kickUserId);
      await payHeadBet(round, bet, share?.payout || 0, Boolean(share?.refund));
    }
  } else {
    for (const bet of head.bets) {
      if (!bet.paid) await payHeadBet(round, bet, bet.payout || 0, Boolean(bet.refund));
    }
  }
  return round;
}

export async function placeHeadBet({ kickUserId, username, side, amount }) {
  const userId = String(kickUserId || "").trim();
  if (!userId) throw new Error("Sign in to bet.");
  const pick = side === "left" || side === "1" ? "left" : side === "right" || side === "2" ? "right" : "";
  if (!pick) throw new Error("Pick slot 1 or slot 2.");

  const round = await readState();
  const head = round.head;
  if (head.status !== "open") throw new Error("Head to head bets are closed.");

  const maxBet = getHouseGamesMaxBet(username);
  const stake = Math.floor(Number(amount));
  if (!Number.isFinite(stake) || stake < 1) throw new Error("Bet at least 1 UncCoin.");
  if (stake > maxBet) throw new Error(`The max bet is ${maxBet} UncCoins.`);

  const existing = head.bets.find((bet) => bet.kickUserId === userId);
  if (existing) {
    if (existing.side === pick && existing.amount === stake) return round;
    await creditPoints({
      kickUserId: userId,
      username,
      amount: existing.amount,
      note: "Head to head bet change",
    });
    head.bets = head.bets.filter((bet) => bet.kickUserId !== userId);
    await writeState(round);
  }

  try {
    await spendPoints({
      kickUserId: userId,
      username,
      amount: stake,
      note: "Head to head bet",
    });
  } catch (error) {
    if (existing) {
      try {
        await spendPoints({
          kickUserId: userId,
          username,
          amount: existing.amount,
          note: "Head to head bet restore",
        });
        head.bets.push(existing);
      } catch {
        // The new bet was rejected and the old stake stays refunded.
      }
      await writeState(round);
    }
    throw error;
  }

  head.bets.push({
    kickUserId: userId,
    username: String(username || "viewer").trim() || "viewer",
    side: pick,
    amount: stake,
    payout: null,
    refund: false,
    paid: false,
  });
  await writeState(round);
  return round;
}

export async function resetHead() {
  const round = await readState();
  const head = round.head;
  if (head.status === "open" || head.status === "locked" || head.status === "setup") {
    for (const bet of head.bets) {
      if (!bet.paid) await payHeadBet(round, bet, bet.amount, true);
    }
  }
  round.head = emptyHead();
  await writeState(round);
  return round;
}

export function parseHeadBetCommand(content) {
  const text = String(content || "")
    .replace(/\[emote:\d+:[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/^!h2h(?:\s+(\d+)\s+([12]))?\s*$/i);
  if (!match) return null;
  if (!match[1]) return { help: true };
  return { amount: Number(match[1]), side: match[2] === "1" ? "left" : "right" };
}
