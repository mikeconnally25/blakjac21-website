import { handleKickWebhook } from "../../lib/kick-webhook.js";

export default async function handler(req, res) {
  return handleKickWebhook(req, res);
}
