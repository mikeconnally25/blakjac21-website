import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeForToken,
  fetchKickUser,
} from "./kick-auth.js";
import { ensureKickConfig, getKickConfig } from "./config.js";
import { saveKickBotTokens } from "./kick-bot-tokens.js";
import {
  buildCookie,
  clearCookie,
  createBotOAuthCookie,
  getBotOAuthState,
  getSession,
} from "./session.js";

// chat:write is required for bot replies. Event subscriptions use the app token.
const BOT_SCOPES = ["user:read", "chat:write"];

function redirect(res, location, cookies) {
  if (cookies) {
    res.setHeader("Set-Cookie", cookies);
  }
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function buildBonusHuntRedirect(params) {
  const url = new URL("/bonus-hunt/", "http://local");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

export async function handleKickBotLogin(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }

  const config = getKickConfig(req);
  ensureKickConfig(config);

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = createState();
  const oauthCookie = await createBotOAuthCookie({ state, codeVerifier });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: BOT_SCOPES,
    state,
    codeChallenge,
  });

  redirect(res, authorizeUrl, [oauthCookie, clearCookie("kick_oauth")]);
}

export async function handleKickBotCallback(req, res, { code, state, oauth }) {
  const config = getKickConfig(req);
  ensureKickConfig(config);

  if (!code || !state || !oauth) {
    redirect(
      res,
      buildBonusHuntRedirect({
        kickBot: "error",
        message: "Missing authorization data.",
      }),
      clearCookie("kick_bot_oauth")
    );
    return;
  }

  if (state !== oauth.state) {
    redirect(
      res,
      buildBonusHuntRedirect({
        kickBot: "error",
        message: "Invalid OAuth state.",
      }),
      clearCookie("kick_bot_oauth")
    );
    return;
  }

  try {
    const tokens = await exchangeCodeForToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier: oauth.codeVerifier,
    });

    const kickUser = await fetchKickUser(tokens.access_token);
    await saveKickBotTokens({
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
      username: kickUser.username,
    });

    redirect(
      res,
      buildBonusHuntRedirect({
        kickBot: "connected",
        username: kickUser.username,
      }),
      clearCookie("kick_bot_oauth")
    );
  } catch (error) {
    console.error("Kick bot OAuth callback failed:", error);
    redirect(
      res,
      buildBonusHuntRedirect({
        kickBot: "error",
        message: error.message,
      }),
      clearCookie("kick_bot_oauth")
    );
  }
}

export async function handleKickBotStatus(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }

  const { getKickBotTokenStatus } = await import("./kick-bot-tokens.js");
  const status = await getKickBotTokenStatus();

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(status));
}
