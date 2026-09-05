import { getSession } from "./session.js";
import {
  clearGiveawayWinner,
  getGiveawayState,
  revealGiveawayWinner,
  setGiveawayAffiliatesOnly,
  setGiveawaySubscribersOnly,
  setGiveawayKeyword,
  setGiveawaysOpen,
} from "./giveaway-state.js";
import {
  clearGiveawayEntries,
  listGiveawayEntries,
} from "./giveaway-entries.js";
import {
  ensureKickChatSubscription,
  listKickChatSubscriptions,
} from "./kick-chat.js";
import { listWinnerChatMessages } from "./giveaway-winner-chat.js";

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

function hasChatMessageSubscription(subscriptions) {
  return (subscriptions || []).some(
    (entry) =>
      String(entry.event || entry.name || "").toLowerCase() === "chat.message.sent"
  );
}

function getKickWebhookUrl(req) {
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
  const proto =
    req.headers?.["x-forwarded-proto"] ||
    (host?.includes("localhost") ? "http" : "https");

  if (!host) {
    return "/api/kick/webhook";
  }

  return `${proto}://${host}/api/kick/webhook`;
}

function toPublicWinner(winner) {
  if (!winner) return null;
  return {
    id: winner.id,
    username: winner.username,
    revealedAt: winner.revealedAt || null,
  };
}

function isViewerWinner(session, winner) {
  if (!session || !winner) return false;

  const sessionKickId = String(session.kickUserId || "").trim();
  const winnerKickId = String(winner.kickUserId || "").trim();
  if (sessionKickId && winnerKickId) {
    return sessionKickId === winnerKickId;
  }

  const sessionName = String(session.username || "").trim().toLowerCase();
  const winnerName = String(winner.username || "").trim().toLowerCase();
  return Boolean(sessionName && winnerName && sessionName === winnerName);
}

async function buildStatusPayload(session, extras = {}) {
  const state = await getGiveawayState();
  const entries = await listGiveawayEntries();
  const open = Boolean(state.open);
  const keyword = state.keyword || "";
  const viewerWins = isViewerWinner(session, state.winner);
  const canSeeWinnerChat = Boolean(viewerWins || session?.isAdmin);

  return {
    open,
    keyword: open || session?.isAdmin ? keyword : "",
    affiliatesOnly: Boolean(state.affiliatesOnly),
    subscribersOnly: Boolean(state.subscribersOnly),
    entryCount: entries.length,
    entries,
    winner: toPublicWinner(state.winner),
    viewerIsWinner: viewerWins,
    canSeeWinnerChat,
    winnerMessages:
      canSeeWinnerChat && state.winner ? await listWinnerChatMessages() : [],
    ...extras,
  };
}

export async function handleGiveawayStatus(req, res) {
  try {
    const session = await getSession(req);
    const payload = await buildStatusPayload(session);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load giveaway status.",
    });
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
    let kickChatSubscribed = false;
    let kickChatError = null;

    if (state.open) {
      await clearGiveawayEntries();

      try {
        await ensureKickChatSubscription();
        const { subscriptions, error } = await listKickChatSubscriptions();
        kickChatSubscribed = hasChatMessageSubscription(subscriptions);
        kickChatError = error || null;
      } catch (error) {
        kickChatError = error.message;
        console.error("Kick chat subscription failed:", error.message);
      }
    }

    const entries = await listGiveawayEntries();

    sendJson(res, 200, {
      ...(await buildStatusPayload(session, {
        ok: true,
        kickChatSubscribed,
        kickChatError,
        webhookUrl: getKickWebhookUrl(req),
      })),
      // Prefer freshly cleared/opened counts from this mutation path.
      entryCount: entries.length,
      entries,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGiveawayAffiliatesOnly(req, res) {
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

  if (typeof body.affiliatesOnly !== "boolean") {
    sendJson(res, 400, { error: "Provide affiliatesOnly as true or false." });
    return;
  }

  try {
    const state = await setGiveawayAffiliatesOnly(body.affiliatesOnly);
    sendJson(
      res,
      200,
      await buildStatusPayload(session, {
        ok: true,
        // Keep mutation echo explicit.
        affiliatesOnly: Boolean(state.affiliatesOnly),
      })
    );
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGiveawaySubscribersOnly(req, res) {
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

  if (typeof body.subscribersOnly !== "boolean") {
    sendJson(res, 400, { error: "Provide subscribersOnly as true or false." });
    return;
  }

  try {
    const state = await setGiveawaySubscribersOnly(body.subscribersOnly);
    sendJson(
      res,
      200,
      await buildStatusPayload(session, {
        ok: true,
        subscribersOnly: Boolean(state.subscribersOnly),
      })
    );
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGiveawayKeyword(req, res) {
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

  try {
    const state = await setGiveawayKeyword(body.keyword);
    let kickChatSubscribed = false;
    let kickChatError = null;

    if (state.open && state.keyword) {
      try {
        await ensureKickChatSubscription();
        const { subscriptions, error } = await listKickChatSubscriptions();
        kickChatSubscribed = hasChatMessageSubscription(subscriptions);
        kickChatError = error || null;
      } catch (error) {
        kickChatError = error.message;
        console.error("Kick chat subscription failed:", error.message);
      }
    }

    sendJson(
      res,
      200,
      await buildStatusPayload(session, {
        ok: true,
        kickChatSubscribed,
        kickChatError,
        webhookUrl: getKickWebhookUrl(req),
      })
    );
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleGiveawayEntriesClear(req, res) {
  const session = await getSession(req);

  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    await clearGiveawayEntries();
    await clearGiveawayWinner();
    sendJson(
      res,
      200,
      await buildStatusPayload(session, {
        ok: true,
        entryCount: 0,
        entries: [],
      })
    );
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGiveawayReveal(req, res) {
  const session = await getSession(req);

  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    await revealGiveawayWinner();

    sendJson(res, 200, await buildStatusPayload(session, { ok: true }));
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}
