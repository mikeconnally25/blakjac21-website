import { isIgnoredLoginIp, normalizeIp } from "./client-ip.js";

const VPN_BLOCK_MESSAGE =
  "VPNs aren't allowed. Disable your VPN and try again.";

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;

function cacheGet(ip) {
  const hit = cache.get(ip);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(ip);
    return null;
  }
  return hit.result;
}

function cacheSet(ip, result) {
  cache.set(ip, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithProxycheck(ip) {
  const key = String(process.env.PROXYCHECK_API_KEY || "").trim();
  const url = new URL(`https://proxycheck.io/v2/${encodeURIComponent(ip)}`);
  url.searchParams.set("vpn", "1");
  url.searchParams.set("asn", "1");
  if (key) {
    url.searchParams.set("key", key);
  }

  const data = await fetchJson(url.toString());
  if (String(data?.status || "").toLowerCase() !== "ok") {
    throw new Error(data?.message || "proxycheck lookup failed");
  }

  const entry = data?.[ip];
  if (!entry || typeof entry !== "object") {
    return { blocked: false, source: "proxycheck", type: null };
  }

  const proxy = String(entry.proxy || "").toLowerCase() === "yes";
  const type = String(entry.type || "").trim().toUpperCase() || null;
  const blocked =
    proxy ||
    type === "VPN" ||
    type === "TOR" ||
    type === "SOCKS" ||
    type === "SOCKS4" ||
    type === "SOCKS5" ||
    type === "HTTP" ||
    type === "HTTPS" ||
    type === "COMP";

  return {
    blocked,
    source: "proxycheck",
    type: type || (proxy ? "PROXY" : null),
  };
}

async function checkWithIpApi(ip) {
  // Free endpoint is HTTP-only; Vercel can still reach it outbound.
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,proxy,hosting,query`;
  const data = await fetchJson(url);
  if (String(data?.status || "").toLowerCase() !== "success") {
    throw new Error(data?.message || "ip-api lookup failed");
  }

  const proxy = Boolean(data.proxy);
  const hosting = Boolean(data.hosting);
  return {
    blocked: proxy || hosting,
    source: "ip-api",
    type: proxy ? "PROXY" : hosting ? "HOSTING" : null,
  };
}

/**
 * Detect VPN / proxy / anonymizer IPs used at login.
 * Fail-open on lookup errors so an outage does not lock everyone out.
 */
export async function detectVpnOrProxy(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized || isIgnoredLoginIp(normalized)) {
    return { blocked: false, skipped: true, message: null };
  }

  const cached = cacheGet(normalized);
  if (cached) {
    return cached;
  }

  let lastError = null;

  try {
    const result = await checkWithProxycheck(normalized);
    return cacheSet(normalized, {
      ...result,
      message: result.blocked ? VPN_BLOCK_MESSAGE : null,
    });
  } catch (error) {
    lastError = error;
  }

  try {
    const result = await checkWithIpApi(normalized);
    return cacheSet(normalized, {
      ...result,
      message: result.blocked ? VPN_BLOCK_MESSAGE : null,
    });
  } catch (error) {
    lastError = error;
  }

  console.error(
    "VPN check failed; allowing login:",
    lastError?.message || lastError
  );
  return cacheSet(normalized, {
    blocked: false,
    source: "unavailable",
    type: null,
    message: null,
  });
}

export function getVpnBlockMessage() {
  return VPN_BLOCK_MESSAGE;
}
