import { getKickConfig } from "./config.js";
import { getSession } from "./session.js";

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

export async function handleKickCredentialsCheck(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }

  const config = getKickConfig(req);
  if (!config.clientId || !config.clientSecret) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "KICK_CLIENT_ID or KICK_CLIENT_SECRET is missing.",
      })
    );
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
    if (!response.ok) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          error: data?.error_description || data?.error || "Kick rejected client credentials.",
        })
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}
