import { getSession } from "./session.js";
import {
  getHouseLossRafflePublic,
  resetHouseLossRaffleWeek,
  revealHouseLossRaffleWinner,
} from "./house-loss-raffle.js";

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

function toPublicWinner(winner) {
  if (!winner) return null;
  return {
    id: winner.id,
    kickUsername: winner.kickUsername,
    stakeUsername: winner.stakeUsername,
    amount: winner.amount,
    revealedAt: winner.revealedAt,
  };
}

async function buildPayload() {
  const data = await getHouseLossRafflePublic();
  return {
    pool: data.pool,
    weekDurationMs: data.weekDurationMs,
    week: data.week,
    lastWinner: toPublicWinner(data.lastWinner),
    history: (data.history || []).map(toPublicWinner).filter(Boolean),
    eligibleNote: data.eligibleNote,
  };
}

export async function handleHouseLossRaffleStatus(req, res) {
  try {
    sendJson(res, 200, await buildPayload());
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load the house games raffle.",
    });
  }
}

export async function handleHouseLossRaffleReveal(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await revealHouseLossRaffleWinner({ force: true });
    sendJson(res, 200, await buildPayload());
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not draw the house games raffle.",
    });
  }
}

export async function handleHouseLossRaffleResetWeek(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await resetHouseLossRaffleWeek({ clearPool: false });
    sendJson(res, 200, await buildPayload());
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not reset the house games raffle week.",
    });
  }
}
