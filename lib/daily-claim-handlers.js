import { claimDailyUncCoins, getDailyClaimStatus } from "./daily-claim.js";
import { getSession } from "./session.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export async function handleDailyClaim(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
    return;
  }

  try {
    if (req.method === "GET") {
      const status = await getDailyClaimStatus(session.kickUserId);
      status.serverNow = Date.now();
      sendJson(res, 200, status);
      return;
    }

    const result = await claimDailyUncCoins({
      kickUserId: session.kickUserId,
      username: session.username,
    });
    result.serverNow = Date.now();
    sendJson(res, 200, result);
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    sendJson(res, statusCode, {
      error:
        statusCode === 500
          ? "Could not claim UncCoins."
          : error.message || "Could not claim UncCoins.",
      claimed: statusCode === 409,
      nextClaimAt: Number(error.nextClaimAt) || 0,
      serverNow: Date.now(),
    });
  }
}
