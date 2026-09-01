import { getKickBotAccessToken } from "./kick-bot-tokens.js";
import { cleanEnv } from "./config.js";
import { requestKickToken } from "./kick-auth.js";

const KICK_CHAT_URL = "https://api.kick.com/public/v1/chat";

let cachedAppToken = null;
let cachedAppTokenExpiresAt = 0;

export function getKickChannelSlug() {
  return (process.env.KICK_CHANNEL_SLUG || "blakjac21").toLowerCase();
}

export function getKickBroadcasterUserId() {
  const value = process.env.KICK_BROADCASTER_USER_ID;
  return value ? Number(value) : null;
}

async function fetchAppAccessToken() {
  const clientId = cleanEnv(process.env.KICK_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.KICK_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error("Kick client credentials are not configured.");
  }

  return requestKickToken({ grant_type: "client_credentials" }, clientId, clientSecret);
}

export async function getKickAccessToken() {
  const botToken = await getKickBotAccessToken();
  if (botToken) {
    return botToken;
  }

  if (cachedAppToken && Date.now() < cachedAppTokenExpiresAt) {
    return cachedAppToken;
  }

  const data = await fetchAppAccessToken();
  cachedAppToken = data.access_token;
  cachedAppTokenExpiresAt =
    Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;

  return cachedAppToken;
}

export async function sendKickChatMessage(content) {
  const accessToken = await getKickAccessToken();
  const broadcasterUserId = getKickBroadcasterUserId();

  const payload = {
    content: String(content).slice(0, 500),
    type: "bot",
  };

  if (broadcasterUserId) {
    payload.broadcaster_user_id = broadcasterUserId;
  }

  const response = await fetch(KICK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "Could not send Kick chat message.");
  }

  return data;
}

export async function subscribeToKickChatEvents() {
  const tokenData = await fetchAppAccessToken();
  const accessToken = tokenData.access_token;
  const broadcasterUserId = getKickBroadcasterUserId();

  if (!broadcasterUserId) {
    throw new Error("Set KICK_BROADCASTER_USER_ID to subscribe to chat events.");
  }

  const response = await fetch("https://api.kick.com/public/v1/events/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      broadcaster_user_id: broadcasterUserId,
      method: "webhook",
      events: [{ name: "chat.message.sent", version: 1 }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || "Could not subscribe to Kick chat events.";
    if (/unauthorized/i.test(message)) {
      throw new Error(
        "Kick rejected the event subscription. Enable webhooks in your Kick app settings and set the URL to https://website-blakjac21.vercel.app/api/kick/webhook"
      );
    }
    throw new Error(message);
  }

  return data;
}

export async function ensureKickChatSubscription() {
  try {
    return await subscribeToKickChatEvents();
  } catch (error) {
    if (/already|exist|duplicate|subscribed/i.test(error.message)) {
      return { ok: true, alreadySubscribed: true };
    }
    throw error;
  }
}

export async function listKickChatSubscriptions() {
  const tokenData = await fetchAppAccessToken();
  const broadcasterUserId = getKickBroadcasterUserId();

  if (!broadcasterUserId) {
    return { subscriptions: [], error: "KICK_BROADCASTER_USER_ID is not set." };
  }

  const response = await fetch(
    `https://api.kick.com/public/v1/events/subscriptions?broadcaster_user_id=${broadcasterUserId}`,
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      subscriptions: [],
      error: data?.message || "Could not list Kick chat subscriptions.",
    };
  }

  const subscriptions = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
      ? data
      : [];

  return { subscriptions };
}
