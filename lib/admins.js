const DEFAULT_ADMIN_USERNAMES = ["blakjac21", "vzqie"];

function getAdminUsernames() {
  const fromEnv = String(process.env.ADMIN_KICK_USERNAMES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set([...DEFAULT_ADMIN_USERNAMES, ...fromEnv])];
}

function getAdminUserIds() {
  return (process.env.ADMIN_KICK_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isKickAdmin(kickProfile) {
  if (!kickProfile || typeof kickProfile !== "object") return false;

  const username = String(
    kickProfile.name || kickProfile.username || ""
  ).toLowerCase();
  const userId = String(
    kickProfile.user_id ||
      kickProfile.kickUserId ||
      kickProfile.id ||
      kickProfile.userId ||
      ""
  );

  return (
    (userId && getAdminUserIds().includes(userId)) ||
    (username && getAdminUsernames().includes(username))
  );
}
