import { getSession } from "./session.js";
import {
  buildWeeklyRaffleEntries,
  clearWeeklyRaffleWinner,
  getWeeklyRaffleState,
  revealWeeklyRaffleWinner,
  TICKETS_PER_DOLLARS,
} from "./weekly-raffle.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function requireAdmin(session, res) {
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

function toPublicEntry(entry) {
  return {
    id: entry.id,
    stakeUsername: entry.stakeUsername,
    kickUsername: entry.kickUsername,
    wagered: entry.wagered,
    wageredLabel: entry.wageredLabel,
    tickets: entry.tickets,
    rank: entry.rank,
    eligible: entry.eligible,
  };
}

function toPublicWinner(winner) {
  if (!winner) return null;
  return {
    id: winner.id,
    stakeUsername: winner.stakeUsername,
    kickUsername: winner.kickUsername,
    tickets: winner.tickets,
    wagered: winner.wagered,
    revealedAt: winner.revealedAt,
  };
}

async function buildStatusPayload() {
  const [board, state] = await Promise.all([
    buildWeeklyRaffleEntries(),
    getWeeklyRaffleState(),
  ]);

  return {
    ticketsPerDollars: board.ticketsPerDollars || TICKETS_PER_DOLLARS,
    periodStart: board.periodStart,
    periodEnd: board.periodEnd,
    updatedAt: board.updatedAt,
    totalTickets: board.totalTickets,
    eligibleTickets: board.eligibleTickets,
    eligibleCount: board.eligibleCount,
    entries: board.entries.map(toPublicEntry),
    winner: toPublicWinner(state.winner),
    history: (state.history || []).map(toPublicWinner).filter(Boolean),
  };
}

export async function handleWeeklyRaffleStatus(req, res) {
  try {
    const payload = await buildStatusPayload();
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load weekly raffle.",
    });
  }
}

export async function handleWeeklyRaffleReveal(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await revealWeeklyRaffleWinner();
    const payload = await buildStatusPayload();
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not draw a raffle winner.",
    });
  }
}

export async function handleWeeklyRaffleClearWinner(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearWeeklyRaffleWinner();
    const payload = await buildStatusPayload();
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not clear raffle winner.",
    });
  }
}
