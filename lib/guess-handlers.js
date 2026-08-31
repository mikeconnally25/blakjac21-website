import { getSession } from "./session.js";
import { saveGuess } from "./guesses.js";
import {
  buildGameStateCookie,
  getGuessTheBalanceState,
  isGuessTheBalanceEnabled,
  setGuessTheBalanceEnabled,
} from "./game-state.js";

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

  sendJson(
    res,
    200,
    { enabled },
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

  const state = await setGuessTheBalanceEnabled(body.enabled);
  const enabled = isGuessTheBalanceEnabled(state);

  sendJson(
    res,
    200,
    { ok: true, enabled },
    buildGameStateCookie(enabled)
  );
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

  const guess = await saveGuess({
    kickUserId: session.kickUserId,
    username: session.username,
    amount,
  });

  sendJson(res, 200, { ok: true, guess }, buildGameStateCookie(true));
}
