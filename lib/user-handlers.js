import { getSession } from "./session.js";
import { linkStakeUsername, listUsers } from "./users.js";
import { getClientIp, getUserAgent } from "./client-ip.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};

  return JSON.parse(raw);
}

export async function handleStakeLink(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const user = await linkStakeUsername(session.kickUserId, body.stakeUsername);
    sendJson(res, 200, {
      ok: true,
      user: {
        kickUserId: user.kickUserId,
        username: user.username,
        profilePicture: user.profilePicture,
        stakeUsername: user.stakeUsername,
        stakeLinkedAt: user.stakeLinkedAt,
        stakeCodeVerified: user.stakeCodeVerified,
        stakeCodeVerifiedAt: user.stakeCodeVerifiedAt,
        isAdmin: session.isAdmin,
      },
    });
  } catch (err) {
    sendJson(res, 400, { error: err.message || "Could not link Stake account." });
  }
}

export async function handleUsersList(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    const { users, altClusters } = await listUsers();
    sendJson(res, 200, {
      users,
      altClusters,
      total: users.length,
      altClusterCount: altClusters.length,
    });
  } catch {
    sendJson(res, 500, { error: "Could not load users." });
  }
}

export { getClientIp, getUserAgent };
