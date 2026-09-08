import { getSession } from "./session.js";
import {
  getBotReplies,
  listBotReplyFields,
  saveBotReplies,
} from "./bot-replies.js";

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

export async function handleBotRepliesGet(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const replies = await getBotReplies();
    sendJson(res, 200, {
      replies,
      fields: listBotReplyFields(),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load replies." });
  }
}

export async function handleBotRepliesSave(req, res) {
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
    const replies = await saveBotReplies(body.replies || body);
    sendJson(res, 200, {
      ok: true,
      replies,
      fields: listBotReplyFields(),
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not save replies." });
  }
}
