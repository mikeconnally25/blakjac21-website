export function getAppBaseUrl(req) {
  if (process.env.KICK_REDIRECT_URI) {
    const redirect = new URL(process.env.KICK_REDIRECT_URI);
    return `${redirect.protocol}//${redirect.host}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host = req.headers.host || `localhost:${process.env.PORT || 3000}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export function getKickConfig(req) {
  const baseUrl = getAppBaseUrl(req);

  return {
    clientId: process.env.KICK_CLIENT_ID,
    clientSecret: process.env.KICK_CLIENT_SECRET,
    redirectUri: process.env.KICK_REDIRECT_URI || `${baseUrl}/api/auth/callback`,
    baseUrl,
  };
}

export function ensureKickConfig(config) {
  if (!config.clientId || !config.clientSecret || !process.env.SESSION_SECRET) {
    throw new Error("Kick auth is not configured on the server");
  }
}
