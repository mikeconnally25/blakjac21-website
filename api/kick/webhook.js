import { handleKickWebhook } from "../../lib/kick-webhook.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleKickWebhook(req, res);
}
