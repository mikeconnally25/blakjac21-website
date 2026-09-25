import { SignJWT, jwtVerify } from "jose";
import { cleanEnv } from "./config.js";
import {
  clearOAuthStateRecord,
  loadOAuthStateRecord,
  saveOAuthStateRecord,
} from "./oauth-state.js";

/** Keep users signed in for 90 days; refreshed on each /api/auth/me. */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 90;
export const SESSION_JWT_EXPIRES = "90d";
export const OAUTH_MAX_AGE_SEC = 60 * 30;
export const OAUTH_JWT_EXPIRES = "30m";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return new TextEncoder().encode(secret);
}

export async function signPayload(payload, expiresIn = SESSION_JWT_EXPIRES) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

export async function verifyPayload(token) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function getCookie(req, name) {
  return parseCookies(req)[name] || null;
}

function hostnameToCookieDomain(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".vercel.app")
  ) {
    return null;
  }

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return `.${parts.slice(-2).join(".")}`;
}

/** Share cookies across www + apex when possible. */
export function resolveCookieDomain() {
  const explicit = cleanEnv(process.env.COOKIE_DOMAIN);
  if (explicit) return explicit;

  for (const candidate of [
    cleanEnv(process.env.SITE_URL),
    cleanEnv(process.env.KICK_REDIRECT_URI),
  ]) {
    if (!candidate) continue;
    try {
      const domain = hostnameToCookieDomain(new URL(candidate).hostname);
      if (domain) return domain;
    } catch {
      /* try next */
    }
  }

  return null;
}

export function buildCookie(name, value, maxAgeSeconds) {
  const secure =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  const domain = resolveCookieDomain();
  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  return parts.join("; ");
}

export function clearCookie(name) {
  const secure =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const parts = [`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
  if (secure) {
    parts.push("Secure");
  }
  const domain = resolveCookieDomain();
  if (domain) {
    parts.push(`Domain=${domain}`);
  }
  return parts.join("; ");
}

/**
 * Self-contained OAuth state (signed JWT). Kick echoes it back, so login
 * works even when cookies are dropped across www/apex or Redis is unavailable.
 */
export async function createSignedOAuthState({
  codeVerifier,
  returnTo = "/",
  kind = "user",
} = {}) {
  return signPayload(
    {
      purpose: "kick_oauth",
      codeVerifier: String(codeVerifier || ""),
      returnTo: String(returnTo || "/").slice(0, 200),
      kind: kind || "user",
    },
    OAUTH_JWT_EXPIRES
  );
}

async function parseSignedOAuthState(state, { expectKind } = {}) {
  const token = String(state || "").trim();
  if (!token || token.split(".").length < 3) return null;

  try {
    const payload = await verifyPayload(token);
    if (payload?.purpose !== "kick_oauth" || !payload?.codeVerifier) {
      return null;
    }
    const kind = payload.kind || "user";
    if (expectKind === "bot" && kind !== "bot") return null;
    if (expectKind === "user" && kind === "bot") return null;
    return {
      state: token,
      codeVerifier: String(payload.codeVerifier),
      returnTo: payload.returnTo || "/",
      kind,
    };
  } catch {
    return null;
  }
}

export async function createOAuthCookie(data) {
  await saveOAuthStateRecord(data.state, {
    ...data,
    kind: data?.kind || "user",
  });
  const token = await signPayload(
    {
      state: data.state,
      codeVerifier: data.codeVerifier,
      returnTo: data.returnTo || "/",
      kind: data?.kind || "user",
    },
    OAUTH_JWT_EXPIRES
  );
  return buildCookie("kick_oauth", token, OAUTH_MAX_AGE_SEC);
}

export async function createBotOAuthCookie(data) {
  await saveOAuthStateRecord(data.state, {
    ...data,
    kind: "bot",
  });
  const token = await signPayload(
    {
      state: data.state,
      codeVerifier: data.codeVerifier,
      kind: "bot",
    },
    OAUTH_JWT_EXPIRES
  );
  return buildCookie("kick_bot_oauth", token, OAUTH_MAX_AGE_SEC);
}

export async function setSession(res, user) {
  const token = await signPayload(user, SESSION_JWT_EXPIRES);
  res.setHeader(
    "Set-Cookie",
    buildCookie("session", token, SESSION_MAX_AGE_SEC)
  );
}

export function appendSetCookies(res, cookies) {
  const list = (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean);
  if (!list.length) return;

  if (typeof res.appendHeader === "function") {
    for (const cookie of list) {
      res.appendHeader("Set-Cookie", cookie);
    }
    return;
  }

  const existing = res.getHeader?.("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", list.length === 1 ? list[0] : list);
    return;
  }
  const merged = [
    ...(Array.isArray(existing) ? existing : [existing]),
    ...list,
  ];
  res.setHeader("Set-Cookie", merged);
}

export async function getRawSession(req) {
  const token = getCookie(req, "session");
  if (!token) return null;

  try {
    return await verifyPayload(token);
  } catch {
    return null;
  }
}

export async function getSession(req) {
  const session = await getRawSession(req);
  const kickUserId = session?.kickUserId;
  if (!kickUserId) {
    return session;
  }

  try {
    const { isParticipationBlocked } = await import("./users.js");
    if (await isParticipationBlocked(kickUserId)) {
      return null;
    }
  } catch (error) {
    console.error("Session participation check failed:", error.message);
  }

  return session;
}

export async function setOAuthState(res, data) {
  const cookie = await createOAuthCookie(data);
  res.setHeader("Set-Cookie", cookie);
  return cookie;
}

export async function getOAuthState(req, stateFromQuery = null) {
  const state = String(stateFromQuery || "").trim();

  // Prefer signed state from Kick (no cookie/Redis required).
  if (state) {
    const signed = await parseSignedOAuthState(state, { expectKind: "user" });
    if (signed) return signed;

    const stored = await loadOAuthStateRecord(state);
    if (stored?.kind !== "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const token = getCookie(req, "kick_oauth");
  if (!token) return null;

  try {
    const payload = await verifyPayload(token);
    if (!payload?.codeVerifier) return null;
    return {
      state: payload.state || state || "",
      codeVerifier: String(payload.codeVerifier),
      returnTo: payload.returnTo || "/",
      kind: payload.kind || "user",
    };
  } catch {
    return null;
  }
}

export async function getBotOAuthState(req, stateFromQuery = null) {
  const state = String(stateFromQuery || "").trim();

  if (state) {
    const signed = await parseSignedOAuthState(state, { expectKind: "bot" });
    if (signed) return signed;

    const stored = await loadOAuthStateRecord(state);
    if (stored?.kind === "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const token = getCookie(req, "kick_bot_oauth");
  if (!token) return null;

  try {
    const payload = await verifyPayload(token);
    if (!payload?.codeVerifier || payload?.kind !== "bot") return null;
    return {
      state: payload.state || state || "",
      codeVerifier: String(payload.codeVerifier),
      returnTo: payload.returnTo || "/",
      kind: "bot",
    };
  } catch {
    return null;
  }
}

export function clearOAuthState(res) {
  res.setHeader("Set-Cookie", clearCookie("kick_oauth"));
}

export async function consumeOAuthState(state) {
  await clearOAuthStateRecord(state);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", clearCookie("session"));
}

export async function buildSessionCookie(user) {
  const token = await signPayload(user, SESSION_JWT_EXPIRES);
  return buildCookie("session", token, SESSION_MAX_AGE_SEC);
}
