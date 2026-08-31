import { getSession } from "./session.js";
import {
  addBonus,
  clearBonusHunt,
  getBonusHunt,
  removeBonus,
  updateBonusPayout,
} from "./bonuses.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
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

function requireAdmin(session, res) {
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }

  return true;
}

export async function handleBonusHuntGet(req, res) {
  try {
    const hunt = await getBonusHunt();
    sendJson(res, 200, hunt);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntAdd(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const bonus = await addBonus(body);
    sendJson(res, 200, { ok: true, bonus });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntUpdate(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { error: "Bonus id is required." });
    return;
  }

  try {
    const bonus = await updateBonusPayout(body);
    sendJson(res, 200, { ok: true, bonus });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRemove(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { error: "Bonus id is required." });
    return;
  }

  try {
    await removeBonus(body.id);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearBonusHunt();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
