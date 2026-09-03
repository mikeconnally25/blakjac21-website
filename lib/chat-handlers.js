import { getSession } from "./session.js";
import {
  addChatMessage,
  getLastMessageAtForUser,
  listChatMessages,
  removeChatMessage,
} from "./site-chat.js";

const RATE_LIMIT_MS = 2000;
const MAX_TEXT_LENGTH = 280;

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

function sanitizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export async function handleChatList(req, res) {
  try {
    const messages = await listChatMessages();
    sendJson(res, 200, { messages });
  } catch {
    sendJson(res, 500, { error: "Could not load chat." });
  }
}

export async function handleChatSend(req, res) {
  const session = await getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Sign in with Kick to chat." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const text = sanitizeText(body.text);
  if (!text) {
    sendJson(res, 400, { error: "Enter a message." });
    return;
  }

  try {
    const lastAt = await getLastMessageAtForUser(session.kickUserId);
    if (lastAt && Date.now() - Date.parse(lastAt) < RATE_LIMIT_MS) {
      sendJson(res, 429, { error: "Slow down — wait a second before sending again." });
      return;
    }

    const message = await addChatMessage({
      kickUserId: session.kickUserId,
      username: session.username,
      profilePicture: session.profilePicture || null,
      isAdmin: Boolean(session.isAdmin),
      text,
    });

    sendJson(res, 200, { message });
  } catch (error) {
    sendJson(res, 500, {
      error: error?.message || "Could not send message.",
    });
  }
}

export async function handleChatRemove(req, res) {
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

  const id = String(body.id || "").trim();
  if (!id) {
    sendJson(res, 400, { error: "Message id required." });
    return;
  }

  try {
    const removed = await removeChatMessage(id);
    if (!removed) {
      sendJson(res, 404, { error: "Message not found." });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch {
    sendJson(res, 500, { error: "Could not remove message." });
  }
}
