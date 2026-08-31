import { cleanEnv, getKickConfig } from "./config.js";
import { requestKickToken } from "./kick-auth.js";

export async function handleKickSetupStatus(req, res) {
  try {
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

    const body = new URLSearchParams({ grant_type: "client_credentials" });

    try {
      await requestKickToken(
        Object.fromEntries(body),
        config.clientId,
        config.clientSecret
      );
      payload.credentialsValid = true;
    } catch (error) {
      payload.hint =
        "Kick rejected the client secret. Run npm run verify:kick locally with the new secret before updating Vercel.";
      payload.error = error.message;
    }

    sendJson(res, payload);
  } catch (error) {
    sendJson(res, {
      clientId: cleanEnv(process.env.KICK_CLIENT_ID) || null,
      redirectUri: cleanEnv(process.env.KICK_REDIRECT_URI) || null,
      credentialsConfigured: false,
      credentialsValid: false,
      hint: error.message,
    });
  }
}

function sendJson(res, payload) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
