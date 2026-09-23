import { handlePointsBuyPackages } from "../../../lib/points-buy-handlers.js";

export default function handler(req, res) {
  return handlePointsBuyPackages(req, res);
}
