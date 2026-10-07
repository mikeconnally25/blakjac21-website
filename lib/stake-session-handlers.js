import { getSession } from "./session.js";
import {
  clearStakeSession,
  getStakeSession,
  importStakeSessionBets,
  isStakeSessionContext,
  startStakeSession,
} from "./stake-session.js";

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

function contextFrom(req, body) {
  if (body?.context) return String(body.context).trim();
  if (req.query?.context) return String(req.query.context).trim();
  try {
    const host = req.headers?.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    return String(url.searchParams.get("context") || "").trim();
  } catch {
    return "";
  }
}

function isStakeOrigin(origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "stake.com" ||
      host.endsWith(".stake.com") ||
      host === "stake.bet" ||
      host.endsWith(".stake.bet") ||
      host === "stake.us" ||
      host.endsWith(".stake.us") ||
      host === "stake.ac" ||
      host.endsWith(".stake.ac") ||
      host === "stake.games" ||
      host.endsWith(".stake.games")
    );
  } catch {
    return false;
  }
}

function setStakeCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && isStakeOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

export async function handleStakeSessionStart(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const context = contextFrom(req, body);
  if (!isStakeSessionContext(context)) {
    sendJson(res, 400, { error: "Choose a hunt or 1v1 session." });
    return;
  }

  try {
    const started = await startStakeSession(context);
    sendJson(res, 200, { ok: true, ...started });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not start tracking." });
  }
}

export async function handleStakeSessionStatus(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  const context = contextFrom(req, {});
  if (!isStakeSessionContext(context)) {
    sendJson(res, 400, { error: "Choose a hunt or 1v1 session." });
    return;
  }

  try {
    sendJson(res, 200, await getStakeSession(context));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load the session." });
  }
}

export async function handleStakeSessionImport(req, res) {
  setStakeCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const result = await importStakeSessionBets(body.token, body.bets);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not save bets." });
  }
}

export async function handleStakeSessionClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const context = contextFrom(req, body);
  if (!isStakeSessionContext(context)) {
    sendJson(res, 400, { error: "Choose a hunt or 1v1 session." });
    return;
  }

  try {
    sendJson(res, 200, await clearStakeSession(context));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not clear the session." });
  }
}
