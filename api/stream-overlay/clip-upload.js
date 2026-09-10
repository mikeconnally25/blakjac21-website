import {
  handleStreamOverlayClipUpload,
  handleStreamOverlayClipUploadMode,
} from "../../lib/stream-overlay-handlers.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleStreamOverlayClipUploadMode(req, res);
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleStreamOverlayClipUpload(req, res);
}
