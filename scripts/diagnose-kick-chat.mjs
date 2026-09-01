import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { cleanEnv } from "../lib/config.js";
import { requestKickToken } from "../lib/kick-auth.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env"), override: true });

async function main() {
  const clientId = cleanEnv(process.env.KICK_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.KICK_CLIENT_SECRET);
  const broadcasterUserId = cleanEnv(process.env.KICK_BROADCASTER_USER_ID);

  console.log("Kick chat diagnostics\n");

  if (!clientId || !clientSecret) {
    console.error("Missing KICK_CLIENT_ID or KICK_CLIENT_SECRET.");
    process.exit(1);
  }

  if (!broadcasterUserId) {
    console.error("Missing KICK_BROADCASTER_USER_ID.");
    process.exit(1);
  }

  const token = await requestKickToken(
    { grant_type: "client_credentials" },
    clientId,
    clientSecret
  );

  const response = await fetch(
    `https://api.kick.com/public/v1/events/subscriptions?broadcaster_user_id=${broadcasterUserId}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json().catch(() => ({}));
  console.log(`Subscriptions HTTP ${response.status}`);
  console.log(JSON.stringify(data, null, 2));

  const webhookResponse = await fetch(
    "https://website-blakjac21.vercel.app/api/kick/webhook"
  );
  console.log(`\nWebhook GET HTTP ${webhookResponse.status}`);
  console.log(await webhookResponse.text());
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
