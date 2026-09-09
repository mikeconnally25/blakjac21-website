import { handleStreamOverlaySave } from "../../lib/stream-overlay-handlers.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleStreamOverlaySave(req, res);
}
