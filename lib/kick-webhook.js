import crypto from "crypto";
import { submitSlotRequest } from "./slot-request-service.js";
import { areSlotRequestsOpen } from "./slot-request-state.js";
import { addGiveawayEntry } from "./giveaway-entries.js";
import { getGiveawayState } from "./giveaway-state.js";
import {
  ensureKickChatSubscription,
  sendKickChatMessage,
  getKickChannelSlug,
} from "./kick-chat.js";
import { appendKickWebhookLog } from "./kick-webhook-log.js";

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
let cachedPublicKeyFetchedAt = 0;

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

function readStreamBody(req) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== "function") {
      resolve("");
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function readRawBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return {
      rawBody: JSON.stringify(req.body),
      preParsed: true,
      parsedBody: req.body,
    };
  }

  if (Buffer.isBuffer(req.body)) {
    return { rawBody: req.body.toString("utf8"), preParsed: false, parsedBody: null };
  }

  if (typeof req.body === "string" && req.body.length) {
    return { rawBody: req.body, preParsed: false, parsedBody: null };
  }

  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
  } catch {
    // Stream may already be consumed on some serverless runtimes.
  }

  let streamed = Buffer.concat(chunks).toString("utf8");
  if (!streamed) {
    streamed = await readStreamBody(req);
  }

  if (streamed) {
    return { rawBody: streamed, preParsed: false, parsedBody: null };
  }

  throw new Error("Missing webhook body.");
}

async function refreshKickPublicKey() {
  if (process.env.KICK_WEBHOOK_PUBLIC_KEY) {
    return cachedPublicKey;
  }

  if (Date.now() - cachedPublicKeyFetchedAt < 60 * 60 * 1000) {
    return cachedPublicKey;
  }

  try {
    const response = await fetch("https://api.kick.com/public/v1/public-key", {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    const key = data?.data?.public_key || data?.public_key;
    if (response.ok && key) {
      cachedPublicKey = key;
      cachedPublicKeyFetchedAt = Date.now();
    }
  } catch {
    // Keep the default key.
  }

  return cachedPublicKey;
}

function verifyKickWebhookSignature({
  messageId,
  timestamp,
  rawBody,
  signatureHeader,
  publicKey,
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

  return verifier.verify(publicKey, signature);
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
  try {
    await sendKickChatMessage(`${mention}${message}`);
  } catch (error) {
    console.error("Kick chat reply failed:", error.message);
  }
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

function matchesGiveawayKeyword(content, keyword) {
  const cleaned = cleanChatContent(content).toLowerCase();
  const target = String(keyword || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return Boolean(cleaned && target && cleaned === target);
}

async function handleGiveawayKeywordEntry({ sender, content }) {
  const username = sender?.username || "viewer";
  const kickUserId = sender?.user_id;

  if (!kickUserId) {
    return { handled: false, reason: "missing-sender" };
  }

  const state = await getGiveawayState();
  if (!state.open || !state.keyword) {
    return { handled: false, reason: "giveaway-closed" };
  }

  if (!matchesGiveawayKeyword(content, state.keyword)) {
    return { handled: false, reason: "keyword-mismatch" };
  }

  try {
    const result = await addGiveawayEntry({ kickUserId, username });

    if (result.alreadyEntered) {
      await replyToChat(username, "You're already entered in the giveaway.");
      return {
        handled: true,
        reason: "giveaway-already-entered",
        username,
      };
    }

    await replyToChat(username, "You're entered in the giveaway!");
    return {
      handled: true,
      reason: "giveaway-entered",
      username,
    };
  } catch (error) {
    await replyToChat(username, error.message);
    return {
      handled: true,
      reason: "giveaway-error",
      username,
      error: error.message,
    };
  }
}

async function handleChatMessage(rawEvent) {
  const event = normalizeKickChatEvent(rawEvent);
  if (!event) {
    return { handled: false, reason: "unrecognized-event" };
  }

  const broadcasterSlug = event.broadcaster?.channel_slug?.toLowerCase();
  const expectedSlug = getKickChannelSlug();

  if (broadcasterSlug && broadcasterSlug !== expectedSlug) {
    return { handled: false, reason: "wrong-channel", broadcasterSlug };
  }

  const sender = event.sender;
  const content = event.content;
  const command = parseSlotRequestCommand(content);

  if (command) {
    await handleSlotRequestCommand({
      sender,
      slotQuery: command.slotQuery,
    });

    return {
      handled: true,
      reason: "command-processed",
      slotQuery: command.slotQuery,
      username: sender?.username || null,
    };
  }

  return handleGiveawayKeywordEntry({ sender, content });
}

export async function processKickChatWebhookEvent(rawEvent) {
  return handleChatMessage(rawEvent);
}

export async function handleKickWebhook(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("ok");
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  let rawBody;
  let preParsed = false;
  let parsedBody = null;
  try {
    const body = await readRawBody(req);
    rawBody = body.rawBody;
    preParsed = body.preParsed;
    parsedBody = body.parsedBody;
  } catch (error) {
    console.error("Kick webhook body read failed:", error.message);
    await appendKickWebhookLog({
      stage: "read-body",
      ok: false,
      error: error.message,
    });
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid webhook body." }));
    return;
  }

  const messageId = getHeader(req, "kick-event-message-id");
  const timestamp = getHeader(req, "kick-event-message-timestamp");
  const signature = getHeader(req, "kick-event-signature");
  const eventType = getHeader(req, "kick-event-type");
  const publicKey = await refreshKickPublicKey();

  const verified =
    preParsed ||
    verifyKickWebhookSignature({
      messageId,
      timestamp,
      rawBody,
      signatureHeader: signature,
      publicKey,
    });

  if (!verified) {
    await appendKickWebhookLog({
      stage: "verify",
      ok: false,
      eventType: eventType || null,
      preParsed,
      error: "Invalid webhook signature.",
    });
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid webhook signature." }));
    return;
  }

  if (eventType?.toLowerCase() !== "chat.message.sent") {
    await appendKickWebhookLog({
      stage: "ignored",
      ok: true,
      eventType: eventType || null,
      preParsed,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  let rawEvent;
  if (parsedBody && typeof parsedBody === "object") {
    rawEvent = parsedBody;
  } else {
    try {
      rawEvent = JSON.parse(rawBody);
    } catch {
      await appendKickWebhookLog({
        stage: "parse",
        ok: false,
        eventType,
        preParsed,
        error: "Invalid JSON body.",
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  let result = { handled: false, reason: "unknown" };
  try {
    result = await handleChatMessage(rawEvent);
  } catch (error) {
    console.error("Kick chat command failed:", error.message);
    await appendKickWebhookLog({
      stage: "command",
      ok: false,
      eventType,
      preParsed,
      error: error.message,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  await appendKickWebhookLog({
    stage: "command",
    ok: true,
    eventType,
    preParsed,
    ...result,
  });

  ensureKickChatSubscription().catch((error) => {
    console.error("Kick chat subscription refresh failed:", error.message);
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
