import crypto from "crypto";
import { submitSlotRequest } from "./slot-request-service.js";
import { areSlotRequestsOpen } from "./slot-request-state.js";
import {
  ensureKickChatSubscription,
  sendKickChatMessage,
  getKickChannelSlug,
} from "./kick-chat.js";

const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

let cachedPublicKey = process.env.KICK_WEBHOOK_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;

function getHeader(req, name) {
  const headers = req.headers || {};
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct) {
    return Array.isArray(direct) ? direct[0] : direct;
  }

  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) {
      return Array.isArray(value) ? value[0] : value;
    }
  }

  return undefined;
}

async function readRawBody(req) {
  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (req.body !== undefined && req.body !== null) {
    throw new Error("Webhook body was parsed before signature verification.");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function verifyKickWebhookSignature({
  messageId,
  timestamp,
  rawBody,
  signatureHeader,
}) {
  if (process.env.KICK_WEBHOOK_SKIP_VERIFY === "1") {
    return true;
  }

  if (!messageId || !timestamp || !signatureHeader) {
    return false;
  }

  const signedPayload = `${messageId}.${timestamp}.${rawBody}`;
  const signature = Buffer.from(signatureHeader, "base64");

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signedPayload);
  verifier.end();

  return verifier.verify(cachedPublicKey, signature);
}

function cleanChatContent(content) {
  return String(content || "")
    .replace(/\[emote:\d+:[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const KICK_SLOT_COMMAND = "!s";

export function parseSlotRequestCommand(content) {
  const text = cleanChatContent(content);

  if (!/^!(?:s(?:\s|$)|slot(?:\s|$))/i.test(text)) {
    return null;
  }

  const match = text.match(/^!(?:s|slot)(?:\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  return {
    slotQuery: match[1]?.trim() || "",
  };
}

export function normalizeKickChatSender(sender) {
  if (!sender || typeof sender !== "object") {
    return null;
  }

  const userId = sender.user_id ?? sender.id ?? sender.userId;
  if (userId === undefined || userId === null || userId === "") {
    return null;
  }

  return {
    ...sender,
    user_id: userId,
    username: sender.username || sender.slug || sender.name || "viewer",
  };
}

export function normalizeKickChatEvent(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const event =
    raw.content !== undefined || raw.sender !== undefined
      ? raw
      : raw.data && typeof raw.data === "object"
        ? raw.data
        : raw;

  return {
    content: event.content ?? event.message ?? "",
    sender: normalizeKickChatSender(event.sender ?? event.user),
    broadcaster: event.broadcaster ?? null,
  };
}

async function replyToChat(username, message) {
  const mention = username ? `@${username} ` : "";
  await sendKickChatMessage(`${mention}${message}`);
}

async function handleSlotRequestCommand({ sender, slotQuery }) {
  const username = sender?.username || "viewer";
  const kickUserId = sender?.user_id;

  if (!kickUserId) {
    return;
  }

  if (!slotQuery) {
    await replyToChat(
      username,
      "Use: !s <slot name> — New Releases or Only on Stake slots only."
    );
    return;
  }

  if (!(await areSlotRequestsOpen())) {
    await replyToChat(username, "Slot requests are closed right now.");
    return;
  }

  try {
    const request = await submitSlotRequest({
      kickUserId,
      username,
      slotQuery,
    });

    const suffix =
      request.groupSlug === "pending"
        ? " (queued — streamer is syncing the slot list)"
        : ` (${request.groupLabel})`;

    await replyToChat(username, `Requested ${request.slotName}${suffix}.`);
  } catch (error) {
    await replyToChat(username, error.message);
  }
}

async function handleChatMessage(rawEvent) {
  const event = normalizeKickChatEvent(rawEvent);
  if (!event) {
    return;
  }

  const broadcasterSlug = event.broadcaster?.channel_slug?.toLowerCase();
  const expectedSlug = getKickChannelSlug();

  if (broadcasterSlug && broadcasterSlug !== expectedSlug) {
    return;
  }

  const sender = event.sender;
  const content = event.content;
  const command = parseSlotRequestCommand(content);

  if (!command) {
    return;
  }

  await handleSlotRequestCommand({
    sender,
    slotQuery: command.slotQuery,
  });
}

export async function handleKickWebhook(req, res) {
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    console.error("Kick webhook body read failed:", error.message);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid webhook body." }));
    return;
  }

  const messageId = getHeader(req, "kick-event-message-id");
  const timestamp = getHeader(req, "kick-event-message-timestamp");
  const signature = getHeader(req, "kick-event-signature");
  const eventType = getHeader(req, "kick-event-type");

  const verified = verifyKickWebhookSignature({
    messageId,
    timestamp,
    rawBody,
    signatureHeader: signature,
  });

  if (!verified) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid webhook signature." }));
    return;
  }

  if (eventType?.toLowerCase() !== "chat.message.sent") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  let rawEvent;
  try {
    rawEvent = JSON.parse(rawBody);
  } catch {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  try {
    await ensureKickChatSubscription();
    await handleChatMessage(rawEvent);
  } catch (error) {
    console.error("Kick chat command failed:", error.message);
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
