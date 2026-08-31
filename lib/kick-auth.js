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
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
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
