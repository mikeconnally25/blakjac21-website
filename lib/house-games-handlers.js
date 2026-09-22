import { getSession } from "./session.js";
import { getPointsBalance } from "./points.js";
import {
  actBlackjack,
  playKeno,
  playRoulette,
  startBlackjack,
} from "./house-games.js";

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
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load points balance.",
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
      if (action === "start") {
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
