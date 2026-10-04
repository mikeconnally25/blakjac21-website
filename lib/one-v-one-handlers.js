import { getSession } from "./session.js";
import {
  clearOneVOneMatchup,
  getOneVOneState,
  setOneVOneMatchup,
} from "./one-v-one.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

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

function toPublicState(state, isAdmin) {
  return {
    isAdmin,
    matchup: state.matchup,
    chatters: isAdmin ? state.chatters : [],
    selection: isAdmin ? state.selection : null,
  };
}

export async function handleOneVOneStatus(req, res) {
  try {
    const session = await getSession(req);
    const state = await getOneVOneState();
    sendJson(res, 200, toPublicState(state, Boolean(session?.isAdmin)));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load the 1v1." });
  }
}

export async function handleOneVOneSet(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const body = await readJsonBody(req);
    const state = await setOneVOneMatchup(body.leftKickUserId, body.rightKickUserId);
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    const message = error.message || "Could not set the 1v1.";
    const status = /Pick two|different chatters|slot call/.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const state = await clearOneVOneMatchup();
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not clear the 1v1." });
  }
}
