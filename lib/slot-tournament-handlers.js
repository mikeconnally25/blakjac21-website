import { getSession } from "./session.js";
import {
  getSlotTournamentState,
  setSlotTournamentAffiliatesOnly,
  setSlotTournamentOpen,
  setSlotTournamentPhase,
  setSlotTournamentResults,
  setSlotTournamentSettings,
  setSlotTournamentSubscribersOnly,
} from "./slot-tournament-state.js";
import {
  addSlotTournamentEntry,
  clearSlotTournamentEntries,
  countSlotTournamentEntries,
  findSlotTournamentEntryById,
  listSlotTournamentEntries,
} from "./slot-tournament-entries.js";
import {
  ensureKickChatSubscription,
  listKickChatSubscriptions,
} from "./kick-chat.js";
import { isActiveKickSubscriber } from "./kick-subscribers.js";
import { getUserByKickId, withLiveUserBadges } from "./users.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function assertTournamentAccess(state, session) {
  if (!state.affiliatesOnly && !state.subscribersOnly) {
    return;
  }

  const storedUser = await getUserByKickId(session.kickUserId);
  const user = await withLiveUserBadges({
    kickUserId: session.kickUserId,
    username: storedUser?.username || session.username,
    stakeUsername: storedUser?.stakeUsername ?? null,
    stakeLinkedAt: storedUser?.stakeLinkedAt ?? null,
    stakeCodeVerified: storedUser?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: storedUser?.stakeCodeVerifiedAt ?? null,
    affGranted: Boolean(storedUser?.affGranted),
  });

  const isAffiliate = Boolean(user.stakeCodeVerified);
  const isSubscriber =
    Boolean(user.kickSubActive) ||
    (await isActiveKickSubscriber(session.kickUserId, session.username));

  let allowed = false;
  if (state.affiliatesOnly && state.subscribersOnly) {
    allowed = isAffiliate || isSubscriber;
  } else if (state.affiliatesOnly) {
    allowed = isAffiliate;
  } else {
    allowed = isSubscriber;
  }

  if (allowed) return;

  if (state.affiliatesOnly && !state.subscribersOnly) {
    throw new Error(
      "AFF only — link Stake with code BLAKJAC21 before claiming a spot."
    );
  }
  if (state.subscribersOnly && !state.affiliatesOnly) {
    throw new Error("SUB only — you need an active Kick subscription.");
  }
  throw new Error(
    "This tournament is restricted to verified AFF or active Kick subs."
  );
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

function hasChatMessageSubscription(subscriptions) {
  return (subscriptions || []).some(
    (entry) =>
      String(entry.event || entry.name || "").toLowerCase() === "chat.message.sent"
  );
}

async function buildStatusPayload(session, extras = {}) {
  const state = await getSlotTournamentState();
  const isAdmin = Boolean(session?.isAdmin);
  const allEntries = await listSlotTournamentEntries({ includePrivate: true });
  const entries = isAdmin
    ? allEntries
    : allEntries.map((entry) => ({
        id: entry.id,
        username: entry.username,
        enteredAt: entry.enteredAt,
      }));

  const viewerKickId = String(session?.kickUserId || "").trim();
  const viewerEntered = Boolean(
    viewerKickId &&
      allEntries.some((entry) => entry.kickUserId === viewerKickId)
  );

  return {
    open: Boolean(state.open),
    phase: state.phase,
    title: state.title,
    slotName: state.slotName,
    buyIn: state.buyIn,
    capacity: Number(state.capacity) || 0,
    spotsLeft: Math.max(0, (Number(state.capacity) || 0) - allEntries.length),
    affiliatesOnly: Boolean(state.affiliatesOnly),
    subscribersOnly: Boolean(state.subscribersOnly),
    entryCount: allEntries.length,
    entries,
    results: state.results || [],
    viewerEntered,
    updatedAt: state.updatedAt,
    ...extras,
  };
}

export async function handleSlotTournamentStatus(req, res) {
  try {
    const session = await getSession(req);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load tournament status.",
    });
  }
}

export async function handleSlotTournamentToggle(req, res) {
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
    const state = await setSlotTournamentOpen(body.open);
    let kickChatSubscribed = false;
    let kickChatError = null;

    if (state.open) {
      await clearSlotTournamentEntries();
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
      ...(await buildStatusPayload(session)),
      kickChatSubscribed,
      kickChatError,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update tournament signups.",
    });
  }
}

export async function handleSlotTournamentSettings(req, res) {
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
    await setSlotTournamentSettings({
      title: body.title,
      slotName: body.slotName,
      buyIn: body.buyIn,
      capacity: body.capacity,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save tournament settings.",
    });
  }
}

export async function handleSlotTournamentPhase(req, res) {
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
    await setSlotTournamentPhase(body.phase);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update tournament phase.",
    });
  }
}

export async function handleSlotTournamentAffiliatesOnly(req, res) {
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
    await setSlotTournamentAffiliatesOnly(Boolean(body.affiliatesOnly));
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update AFF setting.",
    });
  }
}

export async function handleSlotTournamentSubscribersOnly(req, res) {
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
    await setSlotTournamentSubscribersOnly(Boolean(body.subscribersOnly));
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update SUB setting.",
    });
  }
}

export async function handleSlotTournamentEntriesClear(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    await clearSlotTournamentEntries();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not clear entries.",
    });
  }
}

export async function handleSlotTournamentResults(req, res) {
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
    const rows = Array.isArray(body.results) ? body.results : [];
    const resolved = [];

    for (const row of rows) {
      let username = String(row?.username || "").trim();
      let kickUserId = String(row?.kickUserId || "").trim() || null;
      const entryId = String(row?.entryId || "").trim();

      if (entryId) {
        const entry = await findSlotTournamentEntryById(entryId);
        if (entry) {
          username = entry.username || username;
          kickUserId = entry.kickUserId || kickUserId;
        }
      }

      resolved.push({
        place: row?.place,
        entryId: entryId || null,
        kickUserId,
        username,
        score: row?.score,
        note: row?.note,
      });
    }

    await setSlotTournamentResults(resolved);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save results.",
    });
  }
}

export async function handleSlotTournamentJoin(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick to claim a spot." });
    return;
  }

  try {
    const state = await getSlotTournamentState();
    if (!state.open) {
      sendJson(res, 400, { error: "Tournament signups are closed." });
      return;
    }

    if (!state.capacity) {
      sendJson(res, 400, { error: "Tournament capacity is not set." });
      return;
    }

    await assertTournamentAccess(state, session);

    const currentCount = await countSlotTournamentEntries();
    if (currentCount >= state.capacity) {
      await setSlotTournamentOpen(false);
      sendJson(res, 400, { error: "Tournament is full." });
      return;
    }

    const result = await addSlotTournamentEntry({
      kickUserId: session.kickUserId,
      username: session.username,
    });

    if (!result.alreadyEntered) {
      const nextCount = await countSlotTournamentEntries();
      if (nextCount >= state.capacity) {
        await setSlotTournamentOpen(false);
      }
    }

    sendJson(res, 200, {
      ...(await buildStatusPayload(session)),
      alreadyEntered: result.alreadyEntered,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not claim a spot.",
    });
  }
}
