import crypto from "crypto";
import { submitSlotRequest } from "./slot-request-service.js";
import { areSlotRequestsOpen } from "./slot-request-state.js";
import { sendKickChatMessage, getKickChannelSlug } from "./kick-chat.js";
import { getAllowedSlotCatalog } from "./stake-slots.js";

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
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(req) {
  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
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

export const KICK_SLOT_COMMAND = "!slot";

export function parseSlotRequestCommand(content) {
  const text = cleanChatContent(content);
  const match = text.match(/^!slot(?:\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  return {
    slotQuery: match[1]?.trim() || "",
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
      "Use: !slot <slot name> from stake.bet New Releases or Only on Stake."
    );
    return;
  }

  if (!(await areSlotRequestsOpen())) {
    await replyToChat(username, "Slot requests are closed right now.");
    return;
  }

  const catalog = await getAllowedSlotCatalog();
  if (!catalog.slots?.length) {
    await replyToChat(
      username,
      "Slot list is not ready yet. Try again in a minute."
    );
    return;
  }

  try {
    const request = await submitSlotRequest({
      kickUserId,
      username,
      slotQuery,
    });

    await replyToChat(
      username,
      `Requested ${request.slotName} (${request.groupLabel}).`
    );
  } catch (error) {
    await replyToChat(username, error.message);
  }
}

async function handleChatMessage(event) {
  const broadcasterSlug = event?.broadcaster?.channel_slug?.toLowerCase();
  const expectedSlug = getKickChannelSlug();

  if (broadcasterSlug && broadcasterSlug !== expectedSlug) {
    return;
  }

  const sender = event?.sender;
  const content = event?.content;
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
  const rawBody = await readRawBody(req);
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

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));

  if (eventType !== "chat.message.sent") {
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return;
  }

  handleChatMessage(event).catch((error) => {
    console.error("Kick chat command failed:", error.message);
  });
}
