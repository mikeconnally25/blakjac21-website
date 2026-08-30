import { SignJWT, jwtVerify } from "jose";

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

export function buildCookie(name, value, maxAgeSeconds) {
  const secure = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
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

  return parts.join("; ");
}

export function clearCookie(name) {
  const secure = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const parts = [`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export async function createOAuthCookie(data) {
  const token = await signPayload(data, "10m");
  return buildCookie("kick_oauth", token, 60 * 10);
}

export async function setSession(res, user) {
  const token = await signPayload(user);
  res.setHeader("Set-Cookie", buildCookie("session", token, 60 * 60 * 24 * 14));
}

export async function getSession(req) {
  const token = getCookie(req, "session");
  if (!token) return null;

  try {
    return await verifyPayload(token);
  } catch {
    return null;
  }
}

export async function setOAuthState(res, data) {
  const cookie = await createOAuthCookie(data);
  res.setHeader("Set-Cookie", cookie);
  return cookie;
}

export async function getOAuthState(req) {
  const token = getCookie(req, "kick_oauth");
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

export function clearSession(res) {
  res.setHeader("Set-Cookie", clearCookie("session"));
}
