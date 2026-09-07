import { handleSlotTournamentStatus } from "../../lib/slot-tournament-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleSlotTournamentStatus(req, res);
}
