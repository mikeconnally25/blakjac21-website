import { handlePointsBuy } from "../../../lib/points-buy-handlers.js";

export default function handler(req, res) {
  return handlePointsBuy(req, res);
}
