import { handleBonusHuntSlotsAutoSync } from "../../../lib/bonus-hunt-handlers.js";

export const config = {
  maxDuration: 30,
};

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleBonusHuntSlotsAutoSync(req, res);
}
