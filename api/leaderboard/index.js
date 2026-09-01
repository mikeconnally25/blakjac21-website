import { handleLeaderboardGet } from "../../lib/leaderboard-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleLeaderboardGet(req, res);
}
