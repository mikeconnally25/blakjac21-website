import { getSession } from "./session.js";
import {
  clearOneVOneEntries,
  clearOneVOneMatchup,
  drawOneVOneWinners,
  getOneVOneState,
  removeOneVOneViewer,
  setOneVOneEntriesOpen,
} from "./one-v-one.js";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

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

function toPublicState(state, isAdmin) {
  return {
    isAdmin,
    keyword: state.keyword,
    entriesOpen: Boolean(state.entriesOpen),
    entryCount: state.entryCount,
    chat: Array.isArray(state.chat) ? state.chat : [],
    matchup: state.matchup,
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

  let count = 2;
  try {
    const body = await readJsonBody(req);
    count = Number(body?.count) === 1 ? 1 : 2;
  } catch {
    sendJson(res, 400, { error: "Could not read that draw." });
    return;
  }

  try {
    const state = await drawOneVOneWinners(count);
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    const message = error.message || "Could not draw the 1v1.";
    const status = /Need |Remove a viewer/.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneRemove(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let side = "";
  try {
    const body = await readJsonBody(req);
    side = String(body?.side || "").trim();
  } catch {
    sendJson(res, 400, { error: "Could not read that removal." });
    return;
  }

  try {
    const state = await removeOneVOneViewer(side);
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    const message = error.message || "Could not remove that viewer.";
    const status = /Choose the left or right/.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneEntries(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let open = false;
  try {
    const body = await readJsonBody(req);
    open = Boolean(body?.open);
  } catch {
    sendJson(res, 400, { error: "Could not update entries." });
    return;
  }

  try {
    const state = await setOneVOneEntriesOpen(open);
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not update entries." });
  }
}

export async function handleOneVOneEntriesClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const state = await clearOneVOneEntries();
    sendJson(res, 200, toPublicState(state, true));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not clear entrants." });
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
