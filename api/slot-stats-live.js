import { handleSlotStatsLive } from "../lib/slot-stats.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleSlotStatsLive(req, res);
}
