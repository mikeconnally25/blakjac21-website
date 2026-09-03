export function getClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return normalizeIp(first);
    }
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return normalizeIp(String(forwarded[0]).split(",")[0].trim());
  }

  const realIp = req?.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return normalizeIp(realIp.trim());
  }

  const socketIp =
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    req?.ip ||
    "";

  return normalizeIp(String(socketIp || "").trim());
}

export function getUserAgent(req) {
  const value = req?.headers?.["user-agent"];
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim().slice(0, 240) || null;
}

export function normalizeIp(value) {
  let ip = String(value || "").trim();
  if (!ip) {
    return "";
  }

  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  return ip;
}

export function isIgnoredLoginIp(ip) {
  const value = normalizeIp(ip);
  if (!value) {
    return true;
  }

  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "0.0.0.0" ||
    value === "unknown" ||
    value === "localhost"
  );
}
