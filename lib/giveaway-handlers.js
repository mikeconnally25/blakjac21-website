import { getSession } from "./session.js";
import { getGiveawayState, setGiveawaysOpen } from "./giveaway-state.js";

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

export async function handleGiveawayStatus(req, res) {
  try {
    const state = await getGiveawayState();
    sendJson(res, 200, { open: Boolean(state.open) });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load giveaway status." });
  }
}

export async function handleGiveawayToggle(req, res) {
  const session = await getSession(req);

  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (typeof body.open !== "boolean") {
    sendJson(res, 400, { error: "Provide open as true or false." });
    return;
  }

  try {
    const state = await setGiveawaysOpen(body.open);
    sendJson(res, 200, { ok: true, open: Boolean(state.open) });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
