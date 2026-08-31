import { getKickConfig } from "./config.js";

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

export async function handleKickSetupStatus(req, res) {
  const config = getKickConfig(req);

  const payload = {
    clientId: config.clientId || null,
    redirectUri: config.redirectUri || null,
    credentialsConfigured: Boolean(config.clientId && config.clientSecret),
    credentialsValid: false,
    hint: null,
  };

  if (!payload.credentialsConfigured) {
    payload.hint =
      "Set KICK_CLIENT_ID and KICK_CLIENT_SECRET in Vercel, then redeploy.";
    sendJson(res, payload);
    return;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  try {
    const response = await fetch(KICK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await response.json().catch(() => ({}));
    payload.credentialsValid = response.ok;

    if (!response.ok) {
      payload.hint =
        "Kick rejected the client secret. Regenerate it in the Kick Developer Portal, update KICK_CLIENT_SECRET in Vercel, and redeploy.";
      payload.error = data?.error_description || data?.error || "invalid_client";
    }
  } catch (error) {
    payload.hint = error.message;
  }

  sendJson(res, payload);
}

function sendJson(res, payload) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
