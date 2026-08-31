import { handleBonusHuntSlotsSyncStatus } from "../../../lib/bonus-hunt-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleBonusHuntSlotsSyncStatus(req, res);
}
