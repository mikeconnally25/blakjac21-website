import { handlePointsBuyStripeWebhook } from "../../../lib/points-buy-handlers.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  return handlePointsBuyStripeWebhook(req, res);
}
