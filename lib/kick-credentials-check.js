import { getKickConfig } from "./config.js";
import { requestKickToken } from "./kick-auth.js";
import { getSession } from "./session.js";

export async function handleKickCredentialsCheck(req, res) {
  let session = null;
  try {
    session = await getSession(req);
  } catch {
    session = null;
  }

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

  const body = new URLSearchParams({ grant_type: "client_credentials" });

  try {
    await requestKickToken(
      Object.fromEntries(body),
      config.clientId,
      config.clientSecret
    );

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
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        error: error.message,
        hint:
          "Kick rejected the client secret. Run npm run verify:kick locally with the new secret before updating Vercel.",
      })
    );
  }
}
