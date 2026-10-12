import { getSession } from "./session.js";
import {
  closeAverageXBets,
  openAverageXBets,
  placeAverageXBet,
  publicAverageX,
  resetAverageX,
  saveAverageXSetup,
  saveAverageXTotals,
  settleAverageX,
} from "./average-x.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireAdmin(session, res) {
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

export async function handleAverageX(req, res) {
  if (req.method === "GET") {
    try {
      const session = await getSession(req);
      sendJson(res, 200, await publicAverageX(session));
    } catch (error) {
      sendJson(res, 500, { error: "Could not load Average X." });
    }
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  const session = await getSession(req);
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request." });
    return;
  }

  const action = String(body.action || "");

  try {
    if (action === "bet") {
      if (!session?.kickUserId) {
        sendJson(res, 401, { error: "Sign in to bet." });
        return;
      }
      await placeAverageXBet({
        kickUserId: session.kickUserId,
        username: session.username,
        rangeId: body.rangeId,
        amount: body.amount,
      });
      sendJson(res, 200, await publicAverageX(session));
      return;
    }

    if (!requireAdmin(session, res)) return;

    if (action === "setup") {
      await saveAverageXSetup({ slot: body.slot, bonuses: body.bonuses });
    } else if (action === "open") {
      await openAverageXBets();
    } else if (action === "close") {
      await closeAverageXBets();
    } else if (action === "totals") {
      await saveAverageXTotals(body.wins);
    } else if (action === "settle") {
      await settleAverageX();
    } else if (action === "reset") {
      await resetAverageX();
    } else {
      sendJson(res, 400, { error: "Unknown action." });
      return;
    }

    sendJson(res, 200, await publicAverageX(session));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Average X.";
    sendJson(res, 400, { error: message });
  }
}
