import { getSession } from "./session.js";
import { clearGuesses, getClosestGuesses, listGuesses, saveGuess } from "./guesses.js";
import {
  buildGameStateCookie,
  getGuessTheBalanceState,
  getTimeRemainingMs,
  isGuessTheBalanceEnabled,
  setGuessTheBalanceAffiliatesOnly,
  setGuessTheBalanceEnabled,
  setGuessTheBalanceEndingBalance,
  setGuessTheBalanceSubscribersOnly,
} from "./game-state.js";
import { getUserByKickId, withLiveUserBadges } from "./users.js";
import { isActiveKickSubscriber } from "./kick-subscribers.js";

function buildStatusPayload(state, session) {
  const endsAt = state.endsAt;
  const endsAtMs = endsAt ? Date.parse(endsAt) : 0;
  const isActive = Boolean(
    state.enabled && endsAt && endsAtMs > Date.now()
  );

  const payload = {
    enabled: isActive,
    endsAt: isActive ? endsAt : null,
    secondsRemaining: isActive ? Math.ceil((endsAtMs - Date.now()) / 1000) : 0,
    roundMinutes: state.roundMinutes,
    affiliatesOnly: Boolean(state.affiliatesOnly),
    subscribersOnly: Boolean(state.subscribersOnly),
  };

  if (session?.isAdmin) {
    payload.endingBalance = state.endingBalance ?? null;
  }

  return payload;
}

function restrictionMessage({ affiliatesOnly, subscribersOnly }) {
  if (affiliatesOnly && subscribersOnly) {
    return "Guessing is AFF/SUB only — verify Stake with code BLAKJAC21 or be an active Kick subscriber.";
  }
  if (affiliatesOnly) {
    return "Guessing is AFF only — sign in, link Stake, and verify on code BLAKJAC21 first.";
  }
  return "Guessing is SUB only — you need an active Kick subscription.";
}

async function assertGuessEligibility({ kickUserId, username, gameState }) {
  const affiliatesOnly = Boolean(gameState.affiliatesOnly);
  const subscribersOnly = Boolean(gameState.subscribersOnly);

  if (!affiliatesOnly && !subscribersOnly) {
    return;
  }

  const storedUser = await getUserByKickId(kickUserId);
  const user = await withLiveUserBadges({
    kickUserId,
    username: storedUser?.username || username || null,
    stakeUsername: storedUser?.stakeUsername ?? null,
    stakeLinkedAt: storedUser?.stakeLinkedAt ?? null,
    stakeCodeVerified: storedUser?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: storedUser?.stakeCodeVerifiedAt ?? null,
  });

  const isAffiliate = Boolean(user.stakeCodeVerified);
  const isSubscriber =
    Boolean(user.kickSubActive) ||
    (await isActiveKickSubscriber(kickUserId, username));

  if (affiliatesOnly && subscribersOnly) {
    if (isAffiliate || isSubscriber) {
      return;
    }
  } else if (affiliatesOnly) {
    if (isAffiliate) {
      return;
    }
  } else if (subscribersOnly) {
    if (isSubscriber) {
      return;
    }
  }

  throw new Error(restrictionMessage({ affiliatesOnly, subscribersOnly }));
}

function sendJson(res, statusCode, payload, cookies) {
  if (cookies) {
    res.setHeader("Set-Cookie", cookies);
  }
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

export async function handleGuessStatus(req, res) {
  const state = await getGuessTheBalanceState();
  const enabled = isGuessTheBalanceEnabled(state);
  const session = await getSession(req);

  sendJson(
    res,
    200,
    buildStatusPayload(state, session),
    buildGameStateCookie(enabled)
  );
}

export async function handleGuessToggle(req, res) {
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

  if (typeof body.enabled !== "boolean") {
    sendJson(res, 400, { error: "Provide enabled as true or false." });
    return;
  }

  if (body.enabled) {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
      sendJson(res, 400, {
        error: "Round length must be between 1 and 120 minutes.",
      });
      return;
    }
  }

  try {
    const state = await setGuessTheBalanceEnabled(body.enabled, body.minutes);
    const enabled = isGuessTheBalanceEnabled(state);

    await clearGuesses();

    sendJson(
      res,
      200,
      {
        ok: true,
        ...buildStatusPayload(state, session),
        enabled,
        endsAt: state.endsAt,
        secondsRemaining: Math.ceil(getTimeRemainingMs(state) / 1000),
        roundMinutes: state.roundMinutes,
      },
      buildGameStateCookie(enabled)
    );
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGuessAffiliatesOnly(req, res) {
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
    const state = await setGuessTheBalanceAffiliatesOnly(body.affiliatesOnly);
    const enabled = isGuessTheBalanceEnabled(state);
    sendJson(res, 200, {
      ok: true,
      ...buildStatusPayload(state, session),
    }, buildGameStateCookie(enabled));
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGuessSubscribersOnly(req, res) {
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
    const state = await setGuessTheBalanceSubscribersOnly(body.subscribersOnly);
    const enabled = isGuessTheBalanceEnabled(state);
    sendJson(res, 200, {
      ok: true,
      ...buildStatusPayload(state, session),
    }, buildGameStateCookie(enabled));
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGuessSetEndingBalance(req, res) {
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

  if (body.amount === null || body.amount === undefined || body.amount === "") {
    try {
      const state = await setGuessTheBalanceEndingBalance(null);
      sendJson(res, 200, { ok: true, endingBalance: state.endingBalance });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    sendJson(res, 400, { error: "Enter a valid balance amount." });
    return;
  }

  try {
    const state = await setGuessTheBalanceEndingBalance(amount);
    sendJson(res, 200, { ok: true, endingBalance: state.endingBalance });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGuessList(req, res) {
  try {
    const guesses = await listGuesses();
    const state = await getGuessTheBalanceState();
    const payload = { guesses };

    if (state.endingBalance !== null && state.endingBalance !== undefined) {
      payload.results = {
        endingBalance: state.endingBalance,
        winners: getClosestGuesses(guesses, state.endingBalance, 3),
      };
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleGuessSubmit(req, res) {
  const gameState = await getGuessTheBalanceState();

  if (!isGuessTheBalanceEnabled(gameState)) {
    sendJson(
      res,
      403,
      { error: "Guessing is currently closed." },
      buildGameStateCookie(false)
    );
    return;
  }

  const session = await getSession(req);

  if (!session) {
    sendJson(res, 401, { error: "Sign in with Kick to submit a guess." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    sendJson(res, 400, { error: "Enter a valid balance amount." });
    return;
  }

  try {
    await assertGuessEligibility({
      kickUserId: session.kickUserId,
      username: session.username,
      gameState,
    });
  } catch (error) {
    sendJson(res, 403, { error: error.message }, buildGameStateCookie(true));
    return;
  }

  const guess = await saveGuess({
    kickUserId: session.kickUserId,
    username: session.username,
    amount,
  });

  sendJson(res, 200, { ok: true, guess }, buildGameStateCookie(true));
}
