import { getPointsBalance } from "./points.js";
import { getSession } from "./session.js";
import {
  clearOneVOneEntries,
  clearOneVOneMatchup,
  drawNewOneVOneOpponent,
  drawOneVOneWinners,
  getOneVOneState,
  placeOneVOneBet,
  removeOneVOneViewer,
  setOneVOneAccess,
  setOneVOneBetTimer,
  setOneVOneEntriesOpen,
  settleOneVOne,
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

function toPublicState(state, session) {
  return {
    isAdmin: Boolean(session?.isAdmin),
    signedIn: Boolean(session?.kickUserId),
    keyword: state.keyword,
    entriesOpen: Boolean(state.entriesOpen),
    affiliatesOnly: Boolean(state.affiliatesOnly),
    subscribersOnly: Boolean(state.subscribersOnly),
    entryCount: state.entryCount,
    pools: state.pools,
    bets: Array.isArray(state.bets) ? state.bets : [],
    myBet: state.myBet || null,
    winner: state.winner || null,
    betsCloseAt: Number(state.betsCloseAt) || 0,
    chat: Array.isArray(state.chat) ? state.chat : [],
    matchup: state.matchup,
  };
}

async function publicState(session) {
  const state = await getOneVOneState(session?.kickUserId || "");
  const payload = toPublicState(state, session);
  if (!session?.kickUserId) {
    payload.balance = null;
    return payload;
  }

  try {
    const balance = await getPointsBalance(session.kickUserId);
    payload.balance = Math.max(0, Math.floor(Number(balance?.points) || 0));
  } catch {
    payload.balance = null;
  }
  return payload;
}

export async function handleOneVOneStatus(req, res) {
  try {
    const session = await getSession(req);
    sendJson(res, 200, await publicState(session));
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
    await drawOneVOneWinners(count);
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not draw the 1v1.";
    const status = /Need |Remove a viewer|Reset the 1v1/.test(message) ? 400 : 500;
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
    await removeOneVOneViewer(side);
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not remove that viewer.";
    const status = /Choose side/.test(message) ? 400 : 500;
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
    const payload = await publicState(session);
    payload.announced = Boolean(state.announced);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not update entries." });
  }
}

export async function handleOneVOneAccess(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let affiliatesOnly;
  let subscribersOnly;
  try {
    const body = await readJsonBody(req);
    if (typeof body?.affiliatesOnly === "boolean") affiliatesOnly = body.affiliatesOnly;
    if (typeof body?.subscribersOnly === "boolean") subscribersOnly = body.subscribersOnly;
  } catch {
    sendJson(res, 400, { error: "Could not update that restriction." });
    return;
  }

  if (typeof affiliatesOnly !== "boolean" && typeof subscribersOnly !== "boolean") {
    sendJson(res, 400, { error: "Provide affiliatesOnly and/or subscribersOnly as true or false." });
    return;
  }

  try {
    await setOneVOneAccess({ affiliatesOnly, subscribersOnly });
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not update that restriction." });
  }
}

export async function handleOneVOneEntriesClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearOneVOneEntries();
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not clear entrants." });
  }
}

export async function handleOneVOneClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearOneVOneMatchup();
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not clear the 1v1." });
  }
}

export async function handleOneVOneBet(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in to bet UncCoins." });
    return;
  }

  let side = "";
  let amount = 0;
  try {
    const body = await readJsonBody(req);
    side = String(body?.side || "").trim();
    amount = body?.amount;
  } catch {
    sendJson(res, 400, { error: "Could not read that bet." });
    return;
  }

  try {
    await placeOneVOneBet({
      kickUserId: session.kickUserId,
      username: session.username,
      side,
      amount,
    });
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not place that bet.";
    const status = /Sign in|Bet at least|Max bet|Pick side|already bet|doesn't have|already has a winner|just closed|Not enough|aren't open/.test(message)
      ? 400
      : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneSettle(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let side = "";
  try {
    const body = await readJsonBody(req);
    side = String(body?.side || "").trim();
  } catch {
    sendJson(res, 400, { error: "Could not read that result." });
    return;
  }

  try {
    await settleOneVOne(side);
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not settle the 1v1.";
    const status = /Choose side|empty|already settled/.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneRematch(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await drawNewOneVOneOpponent();
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not draw a new opponent.";
    const status = /Set a winner|Need /.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

export async function handleOneVOneBetTimer(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let open = false;
  let seconds = 60;
  try {
    const body = await readJsonBody(req);
    open = Boolean(body?.open);
    seconds = body?.seconds;
  } catch {
    sendJson(res, 400, { error: "Could not update the bet timer." });
    return;
  }

  try {
    await setOneVOneBetTimer({ open, seconds });
    sendJson(res, 200, await publicState(session));
  } catch (error) {
    const message = error.message || "Could not update the bet timer.";
    const status = /Pick a|Seat both|already has a winner/.test(message) ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}
