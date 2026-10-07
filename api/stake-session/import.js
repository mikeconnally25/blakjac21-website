import { handleStakeSessionImport } from "../../lib/stake-session-handlers.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    return handleStakeSessionImport(req, res);
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  return handleStakeSessionImport(req, res);
}
