import { SignJWT, jwtVerify } from "jose";
import { cleanEnv } from "./config.js";
import {
  clearOAuthStateRecord,
  loadOAuthStateRecord,
  saveOAuthStateRecord,
} from "./oauth-state.js";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return new TextEncoder().encode(secret);
}

export async function signPayload(payload, expiresIn = "14d") {
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

/** Share cookies across www + apex when possible. */
export function resolveCookieDomain() {
  const explicit = cleanEnv(process.env.COOKIE_DOMAIN);
  if (explicit) return explicit;

  const redirectUri = cleanEnv(process.env.KICK_REDIRECT_URI);
  if (!redirectUri) return null;

  try {
    const host = new URL(redirectUri).hostname.toLowerCase();
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
  } catch {
    return null;
  }
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

export async function createOAuthCookie(data) {
  await saveOAuthStateRecord(data.state, {
    ...data,
    kind: data?.kind || "user",
  });
  const token = await signPayload(data, "10m");
  return buildCookie("kick_oauth", token, 60 * 10);
}

export async function createBotOAuthCookie(data) {
  await saveOAuthStateRecord(data.state, {
    ...data,
    kind: "bot",
  });
  const token = await signPayload(data, "10m");
  return buildCookie("kick_bot_oauth", token, 60 * 10);
}

export async function setSession(res, user) {
  const token = await signPayload(user);
  res.setHeader("Set-Cookie", buildCookie("session", token, 60 * 60 * 24 * 14));
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
  if (state) {
    const stored = await loadOAuthStateRecord(state);
    if (stored?.kind !== "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const token = getCookie(req, "kick_oauth");
  if (!token) return null;

  try {
    return await verifyPayload(token);
  } catch {
    return null;
  }
}

export async function getBotOAuthState(req, stateFromQuery = null) {
  const state = String(stateFromQuery || "").trim();
  if (state) {
    const stored = await loadOAuthStateRecord(state);
    if (stored?.kind === "bot" && stored?.codeVerifier) {
      return stored;
    }
  }

  const token = getCookie(req, "kick_bot_oauth");
  if (!token) return null;

  try {
    return await verifyPayload(token);
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
