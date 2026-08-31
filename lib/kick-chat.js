const KICK_CHAT_URL = "https://api.kick.com/public/v1/chat";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

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
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Kick client credentials are not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || "Kick token failed.");
  }

  return data;
}

export async function getKickAccessToken() {
  if (process.env.KICK_BOT_ACCESS_TOKEN) {
    return process.env.KICK_BOT_ACCESS_TOKEN;
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
  const accessToken = await getKickAccessToken();
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
    throw new Error(data?.message || "Could not subscribe to Kick chat events.");
  }

  return data;
}
