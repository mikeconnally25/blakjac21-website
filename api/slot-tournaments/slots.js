import { handleSlotTournamentSlots } from "../../lib/slot-tournament-handlers.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleSlotTournamentSlots(req, res);
}
