import { isKickAdmin } from "./admins.js";

/** Trusted accounts that should never be treated as similar-IP alts. */
const DEFAULT_ALT_IMMUNE_USERNAMES = [
  "vzqie",
  "reachaces",
  "captainbonk",
  "holden",
];

function getAltImmuneUsernames() {
  const fromEnv = String(process.env.ALT_IMMUNE_KICK_USERNAMES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...DEFAULT_ALT_IMMUNE_USERNAMES, ...fromEnv]);
}

export function isAltImmune(user) {
  if (!user || typeof user !== "object") return false;
  if (isKickAdmin(user)) return true;

  const username = String(user.username || user.name || "")
    .trim()
    .toLowerCase();
  return Boolean(username && getAltImmuneUsernames().has(username));
}
