import { handleDailyClaim } from "../../lib/daily-claim-handlers.js";

export default function handler(req, res) {
  return handleDailyClaim(req, res);
}
