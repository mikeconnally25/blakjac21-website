import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeForToken,
  fetchKickUser,
} from "../lib/kick-auth.js";
import { ensureKickConfig, getKickConfig } from "../lib/config.js";
import { isKickAdmin } from "../lib/admins.js";
import {
  buildCookie,
  clearCookie,
  clearSession,
  createOAuthCookie,
  getBotOAuthState,
  getOAuthState,
  getSession,
  signPayload,
} from "../lib/session.js";

import { ensureUserRecord, getUserByKickId, upsertKickUser, withLiveStakeCodeVerification } from "../lib/users.js";
import { handleKickBotCallback } from "./kick-bot-auth-handlers.js";

function buildBonusHuntBotRedirect(params) {
  const url = new URL("/bonus-hunt/", "http://local");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

function redirect(res, location, cookies) {
  if (cookies) {
    res.setHeader("Set-Cookie", cookies);
  }
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function authErrorMessage({ code, state, oauth }) {
  if (!code) {
    return "Kick did not return an authorization code. Check that your redirect URI matches exactly in Kick developer settings.";
  }
  if (!state) {
    return "Kick did not return OAuth state. Try signing in again.";
  }
  if (!oauth) {
    return "OAuth session expired or cookies were blocked. Try signing in again.";
  }
  return "Missing authorization data";
}

function sanitizeReturnTo(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function buildAuthRedirect(returnTo, params) {
  const path = sanitizeReturnTo(returnTo);
  const url = new URL(path, "http://local");
  Object.entries(params).forEach(([key, val]) => {
    url.searchParams.set(key, val);
  });
  return `${url.pathname}${url.search}`;
}

export async function handleLogin(req, res) {
  const config = getKickConfig(req);
  ensureKickConfig(config);

  const loginUrl = new URL(req.url, config.baseUrl);
  const returnTo = sanitizeReturnTo(loginUrl.searchParams.get("returnTo"));

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = createState();

  const oauthCookie = await createOAuthCookie({ state, codeVerifier, returnTo });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: ["user:read"],
    state,
    codeChallenge,
  });

  redirect(res, authorizeUrl, [oauthCookie, clearCookie("kick_bot_oauth")]);
}

export async function handleCallback(req, res) {
  const config = getKickConfig(req);
  ensureKickConfig(config);

  const url = new URL(req.url, config.baseUrl);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const oauth = await getOAuthState(req);
  const botOAuth = await getBotOAuthState(req);

  const returnTo = sanitizeReturnTo(oauth?.returnTo);

  if (error) {
    if (botOAuth) {
      redirect(
        res,
        buildBonusHuntBotRedirect({
          kickBot: "error",
          message: errorDescription || error,
        }),
        clearCookie("kick_bot_oauth")
      );
      return;
    }

    redirect(
      res,
      buildAuthRedirect(returnTo, {
        auth: "error",
        message: errorDescription || error,
      })
    );
    return;
  }

  if (botOAuth && state === botOAuth.state) {
    return handleKickBotCallback(req, res, { code, state, oauth: botOAuth });
  }

  if (!code || !state || !oauth) {
    redirect(
      res,
      buildAuthRedirect(returnTo, {
        auth: "error",
        message: authErrorMessage({ code, state, oauth }),
      })
    );
    return;
  }

  if (state !== oauth.state) {
    redirect(
      res,
      buildAuthRedirect(returnTo, {
        auth: "error",
        message: "Invalid OAuth state",
      })
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
    const user = await upsertKickUser(kickUser);
    const sessionToken = await signPayload({
      kickUserId: user.kickUserId,
      username: user.username,
      profilePicture: user.profilePicture,
      isNew: user.isNew,
      isAdmin: isKickAdmin(kickUser),
    });

    const redirectFlag = user.isNew ? "created" : "signed-in";
    redirect(res, buildAuthRedirect(oauth.returnTo, { auth: redirectFlag }), [
      buildCookie("session", sessionToken, 60 * 60 * 24 * 14),
      clearCookie("kick_oauth"),
    ]);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    redirect(
      res,
      buildAuthRedirect(oauth.returnTo, {
        auth: "error",
        message: err.message,
      })
    );
  }
}

export async function handleMe(req, res) {
  const session = await getSession(req);

  if (!session) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }

  try {
    await ensureUserRecord({
      kickUserId: session.kickUserId,
      username: session.username,
      profilePicture: session.profilePicture,
    });
  } catch (err) {
    console.error("Could not persist user record:", err);
  }

  const storedUser = await getUserByKickId(session.kickUserId);
  const user = await withLiveStakeCodeVerification({
    ...session,
    stakeUsername: storedUser?.stakeUsername ?? null,
    stakeLinkedAt: storedUser?.stakeLinkedAt ?? null,
    stakeCodeVerified: storedUser?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: storedUser?.stakeCodeVerifiedAt ?? null,
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      authenticated: true,
      user,
    })
  );
}

export async function handleLogout(req, res) {
  clearSession(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
