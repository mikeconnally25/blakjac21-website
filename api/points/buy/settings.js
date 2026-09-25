import { handlePointsBuySettings } from "../../../lib/points-buy-handlers.js";

export default function handler(req, res) {
  return handlePointsBuySettings(req, res);
}
