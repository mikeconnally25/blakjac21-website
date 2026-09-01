import { getSession } from "./session.js";
import { listUsers } from "./users.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export async function handleUsersList(req, res) {
  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  try {
    const users = await listUsers();
    sendJson(res, 200, {
      users,
      total: users.length,
    });
  } catch {
    sendJson(res, 500, { error: "Could not load users." });
  }
}
