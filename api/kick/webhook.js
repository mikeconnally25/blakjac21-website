import { handleKickWebhook } from "../../lib/kick-webhook.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  return handleKickWebhook(req, res);
}
