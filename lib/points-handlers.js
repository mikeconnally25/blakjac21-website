import { getSession } from "./session.js";
import {
  awardPoints,
  awardPointsBulk,
  cancelRedemption,
  deleteRedemption,
  fulfillRedemption,
  getPointsBalance,
  listCatalog,
  listRedemptions,
  redeemCatalogItem,
  setCatalogItemActive,
  upsertCatalogItem,
} from "./points.js";
import { findUserByUsername, getUserByKickId, listUsers } from "./users.js";
import { listRecentChatters } from "./kick-chat-archive.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

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

export async function handlePointsMe(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
    return;
  }

  try {
    const balance = await getPointsBalance(session.kickUserId);
    const redemptions = await listRedemptions({
      kickUserId: session.kickUserId,
    });
    sendJson(res, 200, {
      balance: {
        points: balance.points,
        username: balance.username || session.username,
        updatedAt: balance.updatedAt,
      },
      redemptions,
    });
  } catch {
    sendJson(res, 500, { error: "Could not load points." });
  }
}

export async function handlePointsCatalogGet(req, res) {
  const session = await getSession(req);

  try {
    const catalog = await listCatalog({
      includeInactive: Boolean(session?.isAdmin),
    });
    sendJson(res, 200, {
      catalog,
      isAdmin: Boolean(session?.isAdmin),
    });
  } catch {
    sendJson(res, 500, { error: "Could not load catalog." });
  }
}

export async function handlePointsAward(req, res) {
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
    let kickUserId = String(body.kickUserId || "").trim();
    let username = String(body.username || "").trim();

    if (!kickUserId && username) {
      const found = await findUserByUsername(username);
      if (!found) {
        sendJson(res, 404, { error: "User not found." });
        return;
      }
      kickUserId = found.kickUserId;
      username = found.username;
    }

    if (!kickUserId) {
      sendJson(res, 400, { error: "Provide kickUserId or username." });
      return;
    }

    if (!username) {
      const user = await getUserByKickId(kickUserId);
      username = user?.username || "viewer";
    }

    const balance = await awardPoints({
      kickUserId,
      username,
      amount: body.amount,
      note: body.note || "Admin award",
      actorKickUserId: session.kickUserId,
      actorUsername: session.username,
    });

    const { users, altClusters } = await listUsers();
    sendJson(res, 200, {
      ok: true,
      balance,
      users,
      altClusters,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not award points." });
  }
}

export async function handlePointsAwardChat(req, res) {
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
    const withinMinutes = Math.max(
      1,
      Math.min(120, Number(body.withinMinutes) || 15)
    );
    const chatters = await listRecentChatters({ withinMinutes });
    const result = await awardPointsBulk({
      users: chatters,
      amount: body.amount,
      note: body.note || `Awarded to chatters active in last ${withinMinutes}m`,
      actorKickUserId: session.kickUserId,
      actorUsername: session.username,
    });

    sendJson(res, 200, {
      ok: true,
      awarded: result.awarded,
      amount: result.amount,
      withinMinutes,
      chatters: chatters.map((entry) => ({
        kickUserId: entry.kickUserId,
        username: entry.username,
        lastSeenAt: entry.lastSeenAt,
      })),
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not award points to chat.",
    });
  }
}

export async function handlePointsRedeem(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
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
    const result = await redeemCatalogItem({
      kickUserId: session.kickUserId,
      username: session.username,
      itemId: body.itemId,
    });
    const redemptions = await listRedemptions({
      kickUserId: session.kickUserId,
    });
    sendJson(res, 200, {
      ok: true,
      balance: result.balance,
      redemption: result.redemption,
      redemptions,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not redeem item." });
  }
}

export async function handlePointsCatalogUpsert(req, res) {
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
    if (typeof body.active === "boolean" && body.id && body.title === undefined) {
      const item = await setCatalogItemActive(body.id, body.active);
      const catalog = await listCatalog({ includeInactive: true });
      sendJson(res, 200, { ok: true, item, catalog });
      return;
    }

    const item = await upsertCatalogItem({
      id: body.id,
      title: body.title,
      description: body.description,
      cost: body.cost,
      active: body.active,
    });
    const catalog = await listCatalog({ includeInactive: true });
    sendJson(res, 200, { ok: true, item, catalog });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update catalog item.",
    });
  }
}

export async function handlePointsRedemptionsList(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    let status = null;
    try {
      const url = new URL(req.url || "/", "http://localhost");
      status = url.searchParams.get("status");
    } catch {
      status = null;
    }

    const redemptions = await listRedemptions({ status });
    sendJson(res, 200, { redemptions });
  } catch {
    sendJson(res, 500, { error: "Could not load redemptions." });
  }
}

export async function handlePointsRedemptionFulfill(req, res) {
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
    const redemption = await fulfillRedemption(body.id);
    const redemptions = await listRedemptions();
    sendJson(res, 200, { ok: true, redemption, redemptions });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not fulfill redemption.",
    });
  }
}

export async function handlePointsRedemptionCancel(req, res) {
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
    const result = await cancelRedemption(body.id);
    const redemptions = await listRedemptions();
    sendJson(res, 200, {
      ok: true,
      redemption: result.redemption,
      balance: result.balance,
      redemptions,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not cancel redemption.",
    });
  }
}

export async function handlePointsRedemptionDelete(req, res) {
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
    const redemption = await deleteRedemption(body.id);
    const redemptions = await listRedemptions();
    sendJson(res, 200, { ok: true, redemption, redemptions });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not delete redemption.",
    });
  }
}
