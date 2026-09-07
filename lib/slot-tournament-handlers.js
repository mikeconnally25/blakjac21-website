import { getSession } from "./session.js";
import {
  clearSlotTournamentBracket,
  clearSlotTournamentSlotAssignments,
  generateSlotTournamentBracket,
  getSlotTournamentState,
  setSlotTournamentAffiliatesOnly,
  setSlotTournamentBracketScore,
  setSlotTournamentOpen,
  setSlotTournamentPhase,
  setSlotTournamentResults,
  setSlotTournamentSettings,
  setSlotTournamentSlots,
  setSlotTournamentSubscribersOnly,
} from "./slot-tournament-state.js";
import {
  addSlotTournamentBotEntries,
  addSlotTournamentEntry,
  clearSlotTournamentEntries,
  countSlotTournamentEntries,
  findSlotTournamentEntryById,
  listSlotTournamentEntries,
} from "./slot-tournament-entries.js";
import {
  clearSlotTournamentPredictions,
  findSlotTournamentPrediction,
  getSlotTournamentPredictionsState,
  saveSlotTournamentPrediction,
  setSlotTournamentPredictionsOpen,
  toPublicPrediction,
} from "./slot-tournament-predictions.js";
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
  const predictionState = await getSlotTournamentPredictionsState();
  const entries = isAdmin
    ? allEntries
    : allEntries.map((entry) => ({
        id: entry.id,
        username: entry.username,
        enteredAt: entry.enteredAt,
        isBot: Boolean(entry.isBot),
      }));

  const viewerKickId = String(session?.kickUserId || "").trim();
  const viewerEntered = Boolean(
    viewerKickId &&
      allEntries.some((entry) => entry.kickUserId === viewerKickId)
  );
  const viewerPredictionRecord = viewerKickId
    ? await findSlotTournamentPrediction(viewerKickId)
    : null;

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
    slots: Array.isArray(state.slots) ? state.slots : [],
    bracket: state.bracket || { generatedAt: null, entrantIds: [], matches: [] },
    results: state.results || [],
    predictionsOpen: Boolean(predictionState.open),
    viewerPrediction: toPublicPrediction(viewerPredictionRecord),
    predictionCount: isAdmin ? predictionState.predictions.length : undefined,
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
      await clearSlotTournamentPredictions();
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
    await clearSlotTournamentSlotAssignments();
    await clearSlotTournamentBracket();
    await clearSlotTournamentPredictions();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not clear entries.",
    });
  }
}

export async function handleSlotTournamentEntriesBots(req, res) {
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
    const state = await getSlotTournamentState();
    const currentCount = await countSlotTournamentEntries();
    const capacity = Number(state.capacity) || 0;
    const spotsLeft = capacity
      ? Math.max(0, capacity - currentCount)
      : 100;

    if (capacity && spotsLeft <= 0) {
      sendJson(res, 400, { error: "Tournament is already full." });
      return;
    }

    let count = Math.floor(Number(body.count));
    if (body.fillRemaining) {
      count = spotsLeft;
    }

    if (!Number.isFinite(count) || count < 1) {
      sendJson(res, 400, {
        error: capacity
          ? "Enter how many bots to add, or fill remaining spots."
          : "Enter how many bots to add.",
      });
      return;
    }

    if (capacity) {
      count = Math.min(count, spotsLeft);
    }

    const result = await addSlotTournamentBotEntries(count);

    if (capacity) {
      const nextCount = await countSlotTournamentEntries();
      if (nextCount >= capacity && state.open) {
        await setSlotTournamentOpen(false);
      }
    }

    sendJson(res, 200, {
      ...(await buildStatusPayload(session)),
      botsAdded: result.count,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not add bots.",
    });
  }
}

export async function handleSlotTournamentBracketGenerate(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const entries = await listSlotTournamentEntries({ includePrivate: true });
    await generateSlotTournamentBracket(entries, {
      force: Boolean(body.force),
    });
    await clearSlotTournamentPredictions();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not generate bracket.",
    });
  }
}

export async function handleSlotTournamentBracketScore(req, res) {
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
    await setSlotTournamentBracketScore({
      matchId: body.matchId,
      scoreA: body.scoreA,
      scoreB: body.scoreB,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save match score.",
    });
  }
}

export async function handleSlotTournamentBracketClear(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    await clearSlotTournamentBracket();
    await clearSlotTournamentPredictions();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not clear bracket.",
    });
  }
}

export async function handleSlotTournamentPredictionsToggle(req, res) {
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
    if (body.open) {
      const state = await getSlotTournamentState();
      if (!state.bracket?.matches?.length) {
        sendJson(res, 400, {
          error: "Generate a bracket before enabling predictions.",
        });
        return;
      }
    }

    await setSlotTournamentPredictionsOpen(body.open);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update predictions.",
    });
  }
}

export async function handleSlotTournamentPredictionsSave(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick to submit predictions." });
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
    const state = await getSlotTournamentState();
    const matches = Array.isArray(state.bracket?.matches)
      ? state.bracket.matches
      : [];
    if (!matches.length) {
      sendJson(res, 400, { error: "No bracket is available to predict." });
      return;
    }

    const matchById = new Map(matches.map((match) => [match.id, match]));
    const rawPicks =
      body.picks && typeof body.picks === "object" && !Array.isArray(body.picks)
        ? body.picks
        : {};
    const picks = {};

    for (const [matchId, winnerEntryId] of Object.entries(rawPicks)) {
      const match = matchById.get(String(matchId || "").trim());
      const winner = String(winnerEntryId || "").trim();
      if (!match || !winner) {
        continue;
      }
      if (!match.entryAId || !match.entryBId) {
        throw new Error("Wait until both players are set before picking.");
      }
      if (winner !== match.entryAId && winner !== match.entryBId) {
        throw new Error("Pick must be one of the matchup players.");
      }
      picks[match.id] = winner;
    }

    await saveSlotTournamentPrediction({
      kickUserId: session.kickUserId,
      username: session.username,
      picks,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save predictions.",
    });
  }
}

export async function handleSlotTournamentSlots(req, res) {
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
    const entries = await listSlotTournamentEntries({ includePrivate: true });
    await setSlotTournamentSlots(body.slots, {
      validEntryIds: entries.map((entry) => entry.id),
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save slot assignments.",
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
