import { handleStreamOverlayGet } from "../../lib/stream-overlay-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleStreamOverlayGet(req, res);
}
