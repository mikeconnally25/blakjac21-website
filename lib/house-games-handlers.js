import { getSession } from "./session.js";
import { creditPoints, getPointsBalance } from "./points.js";
import {
  actBlackjack,
  canSelfCreditHousePoints,
  getActiveBlackjack,
  getHouseGamesMaxBet,
  playKeno,
  playRoulette,
  startBlackjack,
} from "./house-games.js";

const MAX_SELF_CREDIT = 1_000_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function handleHouseGamesBalance(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick to play house games." });
    return;
  }

  try {
    const balance = await getPointsBalance(session.kickUserId);
    sendJson(res, 200, {
      points: balance.points,
      username: balance.username || session.username,
      maxBet: getHouseGamesMaxBet(session.username),
      canSelfCredit: canSelfCreditHousePoints(session.username),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load points balance.",
    });
  }
}

export async function handleHouseGamesSelfCredit(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick to add points." });
    return;
  }

  if (!canSelfCreditHousePoints(session.username)) {
    sendJson(res, 403, { error: "Your account cannot self-credit house points." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1) {
    sendJson(res, 400, { error: "Enter at least 1 point." });
    return;
  }
  if (amount > MAX_SELF_CREDIT) {
    sendJson(res, 400, {
      error: `Max ${MAX_SELF_CREDIT.toLocaleString("en-US")} points per add.`,
    });
    return;
  }

  try {
    const balance = await creditPoints({
      kickUserId: session.kickUserId,
      username: session.username,
      amount,
      note: "House games self-credit",
    });
    sendJson(res, 200, {
      ok: true,
      points: balance.points,
      added: amount,
      maxBet: getHouseGamesMaxBet(session.username),
      canSelfCredit: true,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not add points.",
    });
  }
}

export async function handleHouseGamesPlay(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick to play house games." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const game = String(body.game || "").trim().toLowerCase();

  try {
    let result;
    if (game === "blackjack") {
      const action = String(body.action || "start").trim().toLowerCase();
      if (action === "resume" || action === "status") {
        result = await getActiveBlackjack({
          kickUserId: session.kickUserId,
        });
        if (!result) {
          sendJson(res, 200, { ok: true, active: false, game: "blackjack" });
          return;
        }
      } else if (action === "start") {
        result = await startBlackjack({
          kickUserId: session.kickUserId,
          username: session.username,
          bet: body.bet,
        });
      } else {
        result = await actBlackjack({
          kickUserId: session.kickUserId,
          username: session.username,
          sessionId: body.sessionId,
          action,
        });
      }
    } else if (game === "roulette") {
      result = await playRoulette({
        kickUserId: session.kickUserId,
        username: session.username,
        bet: body.bet,
        choice: body.choice,
        picks: body.picks,
      });
    } else if (game === "keno") {
      result = await playKeno({
        kickUserId: session.kickUserId,
        username: session.username,
        bet: body.bet,
        picks: body.picks,
        risk: body.risk,
      });
    } else {
      sendJson(res, 400, {
        error: "Choose blackjack, roulette, or keno.",
      });
      return;
    }

    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not play house game.",
    });
  }
}
