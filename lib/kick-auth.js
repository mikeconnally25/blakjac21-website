import crypto from "crypto";

const KICK_AUTH_URL = "https://id.kick.com/oauth/authorize";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_USERS_URL = "https://api.kick.com/public/v1/users";

export async function requestKickToken(bodyParams, clientId, clientSecret) {
  const attempts = [
  {
    label: "body",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      ...bodyParams,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  },
  {
    label: "basic",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(bodyParams),
  },
  ];

  let lastError = "Token request failed";

  for (const attempt of attempts) {
    const response = await fetch(KICK_TOKEN_URL, {
      method: "POST",
      headers: attempt.headers,
      body: attempt.body,
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      return data;
    }

    lastError = data?.error_description || data?.error || lastError;
    if (data?.error !== "invalid_client") {
      break;
    }
  }

  throw new Error(lastError);
}

export function createPkcePair() {
  // 44 hex chars: PKCE-legal, and safe to embed in a dot-free OAuth state.
  const codeVerifier = crypto.randomBytes(22).toString("hex");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}

export function createState() {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(KICK_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForToken({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
}) {
  return requestKickToken(
    {
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      code,
    },
    clientId,
    clientSecret
  );
}

const KICK_EXCHANGE_DELEGATE_URL =
  "https://website-blakjac21.vercel.app/api/auth/exchange";

function exchangeSignature(code, codeVerifier) {
  const secret = cleanExchangeSecret();
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`${code}.${codeVerifier}`)
    .digest("hex");
}

function cleanExchangeSecret() {
  const secret = process.env.KICK_EXCHANGE_SECRET;
  return secret ? String(secret).trim() : "";
}

export function verifyExchangeSignature(code, codeVerifier, signature) {
  const expected = exchangeSignature(code, codeVerifier);
  const actual = String(signature || "");
  if (!expected || !actual) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function isClientAuthFailure(error) {
  const message = String(error?.message || "");
  return /client authentication failed|invalid_client/i.test(message);
}

async function delegateCodeExchange(code, codeVerifier) {
  const signature = exchangeSignature(code, codeVerifier);
  if (!signature) {
    throw new Error("Token request failed");
  }

  const response = await fetch(KICK_EXCHANGE_DELEGATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kick-Exchange-Signature": signature,
    },
    body: JSON.stringify({ code, codeVerifier }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error || "Token request failed");
  }
  return data;
}

/** Exchange on this host, or ask the project that holds the working Kick secret. */
export async function exchangeCodeForTokenWithFallback(args) {
  try {
    return await exchangeCodeForToken(args);
  } catch (error) {
    if (!isClientAuthFailure(error) || !cleanExchangeSecret()) {
      throw error;
    }
    return delegateCodeExchange(args.code, args.codeVerifier);
  }
}

export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  return requestKickToken(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    clientId,
    clientSecret
  );
}

export async function fetchKickUser(accessToken) {
  const response = await fetch(KICK_USERS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to fetch Kick user");
  }

  const user = payload?.data?.[0];
  if (!user) {
    throw new Error("Kick user not found");
  }

  return user;
}
