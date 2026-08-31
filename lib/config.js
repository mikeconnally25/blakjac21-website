export function cleanEnv(value) {
  if (!value) return undefined;
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed || undefined;
}

export function getAppBaseUrl(req) {
  const redirectUri = cleanEnv(process.env.KICK_REDIRECT_URI);
  if (redirectUri) {
    try {
      const redirect = new URL(redirectUri);
      return `${redirect.protocol}//${redirect.host}`;
    } catch {
      // Fall through to host-based detection.
    }
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host = req?.headers?.host || `localhost:${process.env.PORT || 3000}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export function getKickConfig(req) {
  const baseUrl = getAppBaseUrl(req);

  return {
    clientId: cleanEnv(process.env.KICK_CLIENT_ID),
    clientSecret: cleanEnv(process.env.KICK_CLIENT_SECRET),
    redirectUri:
      cleanEnv(process.env.KICK_REDIRECT_URI) || `${baseUrl}/api/auth/callback`,
    baseUrl,
  };
}

export function ensureKickConfig(config) {
  if (!config.clientId || !config.clientSecret || !process.env.SESSION_SECRET) {
    throw new Error("Kick auth is not configured on the server");
  }
}
