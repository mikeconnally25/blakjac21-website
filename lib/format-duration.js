/**
 * Formats a duration in milliseconds as a short human string.
 * @param {number} ms
 */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours && (seconds || !parts.length)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ") || "0s";
}

/**
 * Formats watch minutes as a human string.
 * @param {number} minutes
 */
export function formatWatchMinutes(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  return formatDuration(total * 60 * 1000);
}
