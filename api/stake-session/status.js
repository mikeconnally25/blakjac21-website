import { handleStakeSessionStatus } from "../../lib/stake-session-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  return handleStakeSessionStatus(req, res);
}
