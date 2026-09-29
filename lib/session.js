import crypto from "crypto";
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

// Fixed-width hex so Kick can echo state without dots or a long JWT.
const OAUTH_VERIFIER_LEN = 44;
const OAUTH_EXP_LEN = 10;
const OAUTH_SIG_LEN = 12;
const OAUTH_RETURN_HEX_MAX = 56;

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
        const raw = part.slice(index + 1);
        try {
          return [part.slice(0, index), decodeURIComponent(raw)];
        } catch {
          return [part.slice(0, index), raw];
        }
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

function oauthStateMac(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, OAUTH_SIG_LEN);
}

function packReturnTo(returnTo) {
  const path = String(returnTo || "/");
  const hex = Buffer.from(path, "utf8").toString("hex");
  if (!hex || hex.length > OAUTH_RETURN_HEX_MAX) {
    return Buffer.from("/").toString("hex");
  }
  return hex;
}

function unpackReturnTo(hex) {
  if (!hex || hex.length % 2 !== 0) return "/";
  try {
    const path = Buffer.from(hex, "hex").toString("utf8");
    if (!path.startsWith("/") || path.startsWith("//")) return "/";
    return path;
  } catch {
    return "/";
  }
}

/**
 * Short signed OAuth state. Kick echoes it back, so login still works when
 * the browser drops the kick_oauth cookie or Redis is unavailable.
 * Layout: version + verifier + exp + kind + returnTo + mac, all hex.
 */
export async function createSignedOAuthState({
  codeVerifier,
  returnTo = "/",
  kind = "user",
} = {}) {
  const verifier = String(codeVerifier || "");
  if (!/^[0-9a-f]{44}$/.test(verifier)) {
    return signPayload(
      {
        purpose: "kick_oauth",
        codeVerifier: verifier,
        returnTo: String(returnTo || "/").slice(0, 200),
        kind: kind || "user",
      },
      OAUTH_JWT_EXPIRES
    );
  }

  const exp = String(Math.floor(Date.now() / 1000) + OAUTH_MAX_AGE_SEC).padStart(
    OAUTH_EXP_LEN,
    "0"
  );
  const kindChar = kind === "bot" ? "b" : "a";
  const payload = `1${verifier}${exp}${kindChar}${packReturnTo(returnTo)}`;
  return `${payload}${oauthStateMac(payload)}`;
}

function parseCompactOAuthState(state, expectKind) {
  const raw = String(state || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  const token = raw.toLowerCase();
  const minLen = 1 + OAUTH_VERIFIER_LEN + OAUTH_EXP_LEN + 1 + OAUTH_SIG_LEN;
  if (!token.startsWith("1") || token.length < minLen) return null;

  const sig = token.slice(-OAUTH_SIG_LEN);
  const payload = token.slice(0, -OAUTH_SIG_LEN);
  const expected = oauthStateMac(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let offset = 1;
  const codeVerifier = payload.slice(offset, offset + OAUTH_VERIFIER_LEN);
  offset += OAUTH_VERIFIER_LEN;
  const expRaw = payload.slice(offset, offset + OAUTH_EXP_LEN);
  offset += OAUTH_EXP_LEN;
  const kindChar = payload.slice(offset, offset + 1);
  offset += 1;
  const returnHex = payload.slice(offset);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() - 5000) return null;
  if (!/^[0-9a-f]{44}$/.test(codeVerifier)) return null;

  const kind = kindChar === "b" ? "bot" : kindChar === "a" ? "user" : null;
  if (!kind) return null;
  if (expectKind === "bot" && kind !== "bot") return null;
  if (expectKind === "user" && kind !== "user") return null;

  return {
    state: raw,
    codeVerifier,
    returnTo: unpackReturnTo(returnHex),
    kind,
  };
}

async function parseSignedOAuthState(state, { expectKind } = {}) {
  const token = String(state || "").trim();
  if (!token) return null;

  const compact = parseCompactOAuthState(token, expectKind);
  if (compact) return compact;

  if (token.split(".").length < 3) return null;

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

async function readOAuthCookie(req, name) {
  const token = getCookie(req, name);
  if (!token) return null;
  try {
    const payload = await verifyPayload(token);
    if (!payload?.codeVerifier) return null;
    return {
      state: String(payload.state || ""),
      codeVerifier: String(payload.codeVerifier),
      returnTo: payload.returnTo || "/",
      kind: payload.kind || "user",
    };
  } catch {
    return null;
  }
}

async function withStoredReturnTo(req, signed) {
  if (!signed) return null;
  const state = String(signed.state || "");
  const stored =
    (await loadOAuthStateRecord(state)) ||
    (state.toLowerCase() !== state
      ? await loadOAuthStateRecord(state.toLowerCase())
      : null);
  if (stored?.returnTo) {
    signed.returnTo = stored.returnTo;
    return signed;
  }

  const cookieName = signed.kind === "bot" ? "kick_bot_oauth" : "kick_oauth";
  const cookie = await readOAuthCookie(req, cookieName);
  if (
    cookie?.returnTo &&
    cookie.state &&
    cookie.state.toLowerCase() === state.toLowerCase()
  ) {
    signed.returnTo = cookie.returnTo;
  }
  return signed;
}

function cookieMatchesState(cookieState, queryState) {
  if (!queryState) return true;
  if (cookieState === queryState) return true;
  return queryState.length >= 32 && String(cookieState).startsWith(queryState);
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
    if (signed) return withStoredReturnTo(req, signed);

    const stored =
      (await loadOAuthStateRecord(state)) ||
      (state.toLowerCase() !== state
        ? await loadOAuthStateRecord(state.toLowerCase())
        : null);
    if (stored?.kind !== "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const cookie = await readOAuthCookie(req, "kick_oauth");
  if (!cookie?.codeVerifier || cookie.kind === "bot") return null;
  if (!cookieMatchesState(cookie.state, state)) return null;

  const parsed = await parseSignedOAuthState(cookie.state, { expectKind: "user" });
  if (parsed) {
    const fullState = parsed.state;
    const resolved = await withStoredReturnTo(req, parsed);
    if (state && resolved.state !== state && cookieMatchesState(fullState, state)) {
      resolved.state = state;
    }
    return resolved;
  }
  if (state) cookie.state = state;
  return cookie;
}

export async function getBotOAuthState(req, stateFromQuery = null) {
  const state = String(stateFromQuery || "").trim();

  if (state) {
    const signed = await parseSignedOAuthState(state, { expectKind: "bot" });
    if (signed) return withStoredReturnTo(req, signed);

    const stored =
      (await loadOAuthStateRecord(state)) ||
      (state.toLowerCase() !== state
        ? await loadOAuthStateRecord(state.toLowerCase())
        : null);
    if (stored?.kind === "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const cookie = await readOAuthCookie(req, "kick_bot_oauth");
  if (!cookie?.codeVerifier || cookie.kind !== "bot") return null;
  if (!cookieMatchesState(cookie.state, state)) return null;

  const parsed = await parseSignedOAuthState(cookie.state, { expectKind: "bot" });
  if (parsed) {
    const fullState = parsed.state;
    const resolved = await withStoredReturnTo(req, parsed);
    if (state && resolved.state !== state && cookieMatchesState(fullState, state)) {
      resolved.state = state;
    }
    return resolved;
  }
  if (state) cookie.state = state;
  return cookie;
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
