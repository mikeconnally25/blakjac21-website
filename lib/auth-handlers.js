import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeForToken,
  fetchKickUser,
} from "../lib/kick-auth.js";
import { ensureKickConfig, getKickConfig } from "../lib/config.js";
import {
  buildCookie,
  clearCookie,
  clearSession,
  getOAuthState,
  getSession,
  setOAuthState,
  signPayload,
} from "../lib/session.js";
import { upsertKickUser } from "../lib/users.js";

export async function handleLogin(req, res) {
  const config = getKickConfig(req);
  ensureKickConfig(config);

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = createState();

  await setOAuthState(res, { state, codeVerifier });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: ["user:read"],
    state,
    codeChallenge,
  });

  res.writeHead(302, { Location: authorizeUrl });
  res.end();
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

  if (error) {
    res.writeHead(302, {
      Location: `/?auth=error&message=${encodeURIComponent(errorDescription || error)}`,
    });
    return res.end();
  }

  if (!code || !state || !oauth) {
    res.writeHead(302, {
      Location: "/?auth=error&message=Missing%20authorization%20data",
    });
    return res.end();
  }

  if (state !== oauth.state) {
    res.writeHead(302, {
      Location: "/?auth=error&message=Invalid%20OAuth%20state",
    });
    return res.end();
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
    });

    res.setHeader("Set-Cookie", [
      buildCookie("session", sessionToken, 60 * 60 * 24 * 14),
      clearCookie("kick_oauth"),
    ]);

    const redirectFlag = user.isNew ? "created" : "signed-in";
    res.writeHead(302, { Location: `/?auth=${redirectFlag}` });
    res.end();
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.writeHead(302, {
      Location: `/?auth=error&message=${encodeURIComponent(err.message)}`,
    });
    res.end();
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

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      authenticated: true,
      user: session,
    })
  );
}

export async function handleLogout(req, res) {
  clearSession(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
