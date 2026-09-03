import { getSession } from "./session.js";
import {
  clearGiveawayWinner,
  getGiveawayState,
  revealGiveawayWinner,
  setGiveawayAffiliatesOnly,
  setGiveawayKeyword,
  setGiveawaysOpen,
} from "./giveaway-state.js";
import {
  clearGiveawayEntries,
  countGiveawayEntries,
  listGiveawayEntries,
} from "./giveaway-entries.js";
import {
  ensureKickChatSubscription,
  listKickChatSubscriptions,
} from "./kick-chat.js";

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

async function buildStatusPayload(session) {
  const state = await getGiveawayState();
  const entries = await listGiveawayEntries();
  const open = Boolean(state.open);
  const keyword = state.keyword || "";

  return {
    open,
    keyword: open || session?.isAdmin ? keyword : "",
    affiliatesOnly: Boolean(state.affiliatesOnly),
    entryCount: entries.length,
    entries,
    winner: state.winner || null,
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
      ok: true,
      open: Boolean(state.open),
      keyword: state.keyword || "",
      affiliatesOnly: Boolean(state.affiliatesOnly),
      entryCount: entries.length,
      entries,
      winner: state.winner || null,
      kickChatSubscribed,
      kickChatError,
      webhookUrl: getKickWebhookUrl(req),
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
    const entries = await listGiveawayEntries();

    sendJson(res, 200, {
      ok: true,
      open: Boolean(state.open),
      keyword: state.keyword || "",
      affiliatesOnly: Boolean(state.affiliatesOnly),
      entryCount: entries.length,
      entries,
      winner: state.winner || null,
    });
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

    sendJson(res, 200, {
      ok: true,
      open: Boolean(state.open),
      keyword: state.keyword || "",
      affiliatesOnly: Boolean(state.affiliatesOnly),
      entryCount: await countGiveawayEntries(),
      winner: state.winner || null,
      kickChatSubscribed,
      kickChatError,
      webhookUrl: getKickWebhookUrl(req),
    });
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
    const state = await clearGiveawayWinner();
    sendJson(res, 200, {
      ok: true,
      entryCount: 0,
      entries: [],
      winner: state.winner || null,
    });
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
    const entries = await listGiveawayEntries();
    const state = await revealGiveawayWinner(entries);

    sendJson(res, 200, {
      ok: true,
      open: Boolean(state.open),
      keyword: state.keyword || "",
      affiliatesOnly: Boolean(state.affiliatesOnly),
      entryCount: entries.length,
      entries,
      winner: state.winner || null,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}
