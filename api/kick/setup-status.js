import { handleKickSetupStatus } from "../../lib/kick-setup-status.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleKickSetupStatus(req, res);
}
