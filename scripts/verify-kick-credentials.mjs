import "dotenv/config";
import { cleanEnv } from "../lib/config.js";

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

async function requestToken(body, clientId, clientSecret, useBasicAuth = false) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (useBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  const clientId = cleanEnv(process.env.KICK_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.KICK_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    console.error("Set KICK_CLIENT_ID and KICK_CLIENT_SECRET in .env first.");
    process.exit(1);
  }

  console.log(`Client ID: ${clientId}`);
  console.log(`Secret length: ${clientSecret.length} characters`);
  console.log("Testing Kick client credentials...\n");

  const body = new URLSearchParams({ grant_type: "client_credentials" });

  for (const mode of ["body", "basic"]) {
    const useBasicAuth = mode === "basic";
    const { response, data } = await requestToken(
      new URLSearchParams(body),
      clientId,
      clientSecret,
      useBasicAuth
    );

    console.log(`${useBasicAuth ? "Basic auth" : "Body params"}: HTTP ${response.status}`);
    if (response.ok) {
      console.log("SUCCESS - these credentials work with Kick.");
      console.log("Update Vercel KICK_CLIENT_SECRET with this exact value, then redeploy.");
      process.exit(0);
    }

    console.log(JSON.stringify(data, null, 2));
    console.log("");
  }

  console.error("FAILED - Kick rejected this client ID + secret pair.");
  console.error("Regenerate the secret in Kick Developer Portal and paste the NEW one into .env.");
  console.error("Do not update Vercel until this script prints SUCCESS.");
  process.exit(1);
}

main();
