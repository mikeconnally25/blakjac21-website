import { getSession } from "./session.js";
import {
  ackOverlayAlert,
  enqueueOverlayAlert,
  getDefaultOverlayConfig,
  getOverlayConfig,
  listPendingOverlayAlerts,
  saveOverlayConfig,
} from "./stream-overlay.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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

export async function handleStreamOverlayGet(req, res) {
  try {
    const config = await getOverlayConfig();
    sendJson(res, 200, { config });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load overlay config." });
  }
}

export async function handleStreamOverlaySave(req, res) {
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
    const config = await saveOverlayConfig(body.config || body);
    sendJson(res, 200, { config, defaults: getDefaultOverlayConfig() });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not save overlay config." });
  }
}

export async function handleStreamOverlayAlertsGet(req, res) {
  try {
    const alerts = await listPendingOverlayAlerts();
    sendJson(res, 200, { alerts });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load alerts." });
  }
}

export async function handleStreamOverlayAlertsAck(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const ok = await ackOverlayAlert(body.id || body.alertId);
    if (!ok) {
      sendJson(res, 404, { error: "Alert not found." });
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not acknowledge alert." });
  }
}

export async function handleStreamOverlayAlertsTest(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const type = String(body.type || "sub").toLowerCase();
  const username = String(body.username || session.username || "TestUser");
  const count = Number(body.count) || 5;

  try {
    const alert = await enqueueOverlayAlert({
      type: type === "gift" ? "gift" : type === "resub" ? "resub" : type === "test" ? "test" : "sub",
      username,
      count: type === "gift" ? count : null,
      message: type === "test" ? `${username} triggered a test alert` : null,
    });
    sendJson(res, 200, { alert });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not enqueue test alert." });
  }
}
