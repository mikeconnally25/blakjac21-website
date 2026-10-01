import { getKickConfig, ensureKickConfig } from "../../lib/config.js";
import {
  exchangeCodeForToken,
  verifyExchangeSignature,
} from "../../lib/kick-auth.js";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid request body." }));
    return;
  }

  const code = String(body?.code || "");
  const codeVerifier = String(body?.codeVerifier || "");
  const signature = req.headers["x-kick-exchange-signature"];
  if (
    !code ||
    !codeVerifier ||
    code.length > 512 ||
    codeVerifier.length > 128 ||
    !verifyExchangeSignature(code, codeVerifier, signature)
  ) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Token request failed" }));
    return;
  }

  try {
    const config = getKickConfig(req);
    ensureKickConfig(config);
    const tokens = await exchangeCodeForToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      })
    );
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Token request failed" }));
  }
}
