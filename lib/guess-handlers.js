import { getSession } from "./session.js";
import { saveGuess } from "./guesses.js";

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

export async function handleGuessSubmit(req, res) {
  const session = await getSession(req);

  if (!session) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Sign in with Kick to submit a guess." }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid request body." }));
    return;
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Enter a valid balance amount." }));
    return;
  }

  const guess = await saveGuess({
    kickUserId: session.kickUserId,
    username: session.username,
    amount,
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, guess }));
}
