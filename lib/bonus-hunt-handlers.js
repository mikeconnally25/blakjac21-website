import { getSession } from "./session.js";
import {
  addBonus,
  clearBonusHunt,
  endBonusHunt,
  getBonusHunt,
  listPastHunts,
  removeBonus,
  updateBonusPayout,
  updateHuntSettings,
} from "./bonuses.js";
import {
  clearSlotRequests,
  getSlotRequestForUser,
  listSlotRequests,
  removeSlotRequest,
  updateSlotRequestBet,
} from "./slot-requests.js";
import {
  getAllowedSlotCatalog,
  refreshAllowedSlotCatalog,
  importAllowedSlotCatalog,
  formatStakeCatalogError,
} from "./stake-slots.js";
import { submitSlotRequest } from "./slot-request-service.js";
import { subscribeToKickChatEvents, ensureKickChatSubscription, listKickChatSubscriptions } from "./kick-chat.js";
import { getKickBotTokenStatus } from "./kick-bot-tokens.js";
import {
  getSlotRequestState,
  setSlotRequestsOpen,
} from "./slot-request-state.js";
import {
  completeStakeSyncToken,
  consumeStakeSyncToken,
  createStakeSyncToken,
  getStakeSyncStatus,
} from "./stake-sync-token.js";

let lastAutoSlotRefreshAt = 0;

function hasChatMessageSubscription(subscriptions) {
  return (subscriptions || []).some(
    (entry) =>
      String(entry.event || entry.name || "").toLowerCase() === "chat.message.sent"
  );
}

function getKickWebhookUrl(req) {
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (host) {
    const protocol = req?.headers?.["x-forwarded-proto"] || "https";
    return `${protocol}://${host}/api/kick/webhook`;
  }

  return "https://website-blakjac21.vercel.app/api/kick/webhook";
}

const STAKE_SYNC_ORIGINS = new Set([
  "https://stake.com",
  "https://www.stake.com",
]);

function setStakeSyncCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && STAKE_SYNC_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

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

export async function handleBonusHuntSettings(req, res) {
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
    const result = await updateHuntSettings(body);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
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

export async function handleBonusHuntEnd(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const result = await endBonusHunt();
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntHistory(req, res) {
  try {
    const pastHunts = await listPastHunts();
    sendJson(res, 200, { pastHunts });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlots(req, res) {
  try {
    let catalog = await getAllowedSlotCatalog();

    if (
      !catalog.slots?.length &&
      Date.now() - lastAutoSlotRefreshAt > 60_000
    ) {
      lastAutoSlotRefreshAt = Date.now();
      try {
        catalog = await refreshAllowedSlotCatalog();
      } catch {
        // Keep the last known catalog state.
      }
    }

    sendJson(res, 200, {
      updatedAt: catalog.updatedAt,
      groups: catalog.groups.map((group) => ({
        slug: group.slug,
        label: group.label,
        url: group.url,
      })),
      slots: catalog.slots,
    });
  } catch (error) {
    sendJson(res, 500, { error: formatStakeCatalogError(error) });
  }
}

export async function handleBonusHuntSlotsRefresh(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const catalog = await refreshAllowedSlotCatalog();
    sendJson(res, 200, {
      ok: true,
      updatedAt: catalog.updatedAt,
      count: catalog.slots.length,
    });
  } catch (error) {
    sendJson(res, 500, { error: formatStakeCatalogError(error) });
  }
}

export async function handleBonusHuntSlotsImport(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const payload = body.payload ?? body.graphql ?? body.imports ?? body;

  try {
    const catalog = await importAllowedSlotCatalog(payload);
    sendJson(res, 200, {
      ok: true,
      updatedAt: catalog.updatedAt,
      count: catalog.slots.length,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRequestsList(req, res) {
  try {
    const session = await getSession(req);
    const [requests, requestState, catalog] = await Promise.all([
      listSlotRequests(),
      getSlotRequestState(),
      getAllowedSlotCatalog(),
    ]);
    const payload = {
      requests,
      acceptingRequests: Boolean(requestState.accepting),
      slotCatalogCount: catalog.slots?.length || 0,
    };

    if (session?.isAdmin) {
      const { subscriptions, error } = await listKickChatSubscriptions();
      payload.kickChatSubscribed = hasChatMessageSubscription(subscriptions);
      if (error) {
        payload.kickChatSubscriptionError = error;
      }
    }

    if (session) {
      payload.myRequest = await getSlotRequestForUser(session.kickUserId);
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntRequestSubmit(req, res) {
  const session = await getSession(req);

  if (!session) {
    sendJson(res, 401, { error: "Sign in with Kick to request a slot." });
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
    const request = await submitSlotRequest({
      kickUserId: session.kickUserId,
      username: session.username,
      slotSlug: body.slotSlug,
      slotName: body.slotName,
    });

    sendJson(res, 200, { ok: true, request });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleKickChatStatus(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const [botStatus, subscriptionResult] = await Promise.all([
      getKickBotTokenStatus(),
      listKickChatSubscriptions(),
    ]);

    const subscriptions = subscriptionResult.subscriptions || [];
    sendJson(res, 200, {
      ok: true,
      webhookUrl: getKickWebhookUrl(req),
      bot: botStatus,
      chatRepliesReady:
        botStatus.connected &&
        ["env", "env-refresh", "stored"].includes(botStatus.source),
      kickChatSubscribed: hasChatMessageSubscription(subscriptions),
      subscriptions,
      subscriptionError: subscriptionResult.error || null,
      broadcasterUserId: process.env.KICK_BROADCASTER_USER_ID || null,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleKickChatSubscribe(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const data = await ensureKickChatSubscription();
    await setSlotRequestsOpen(true);

    let catalog = await getAllowedSlotCatalog();
    if (!catalog.slots?.length) {
      catalog = await refreshAllowedSlotCatalog();
    }

    const { subscriptions, error: subscriptionError } =
      await listKickChatSubscriptions();

    sendJson(res, 200, {
      ok: true,
      data,
      acceptingRequests: true,
      slotCount: catalog.slots.length,
      kickChatSubscribed: hasChatMessageSubscription(subscriptions),
      subscriptionError,
      webhookUrl: getKickWebhookUrl(req),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntRequestRemove(req, res) {
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
    sendJson(res, 400, { error: "Request id is required." });
    return;
  }

  try {
    await removeSlotRequest(body.id);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRequestBet(req, res) {
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
    sendJson(res, 400, { error: "Request id is required." });
    return;
  }

  try {
    const request = await updateSlotRequestBet(body.id, body.bet);
    sendJson(res, 200, { ok: true, request });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRequestsClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearSlotRequests();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntRequestsToggle(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (typeof body.accepting !== "boolean") {
    sendJson(res, 400, { error: "Provide accepting as true or false." });
    return;
  }

  try {
    const state = await setSlotRequestsOpen(body.accepting);
    let kickChatSubscribed = false;
    let kickChatError = null;

    if (state.accepting) {
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
      acceptingRequests: Boolean(state.accepting),
      kickChatSubscribed,
      kickChatError,
      webhookUrl: getKickWebhookUrl(req),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlotsSyncToken(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const record = await createStakeSyncToken();
    sendJson(res, 200, {
      ok: true,
      token: record.token,
      expiresAt: record.expiresAt,
      stakeUrl: `https://stake.com/casino/group/new-releases#bj21sync=${record.token}`,
      syncPageUrl: `/stake-sync.html?token=${record.token}`,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlotsSyncStatus(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  const query = req.query || {};
  const token = String(query.token || "").trim();
  if (!token) {
    sendJson(res, 400, { error: "Sync token is required." });
    return;
  }

  try {
    const status = await getStakeSyncStatus(token);
    sendJson(res, 200, status);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlotsImportSync(req, res) {
  setStakeSyncCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const token = String(body.token || "").trim();
  if (!token) {
    sendJson(res, 400, { error: "Sync token is required." });
    return;
  }

  try {
    await consumeStakeSyncToken(token);
    const payload = body.payload ?? body.graphql ?? body.imports ?? body;
    const catalog = await importAllowedSlotCatalog(payload);
    await completeStakeSyncToken(token, { count: catalog.slots.length });
    sendJson(res, 200, {
      ok: true,
      updatedAt: catalog.updatedAt,
      count: catalog.slots.length,
    });
  } catch (error) {
    await completeStakeSyncToken(token, { count: 0, error: error.message }).catch(
      () => {}
    );
    sendJson(res, 400, { error: error.message });
  }
}
