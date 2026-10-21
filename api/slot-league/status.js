import { handleSlotLeagueStatus } from "../../lib/slot-league-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  return handleSlotLeagueStatus(req, res);
}
