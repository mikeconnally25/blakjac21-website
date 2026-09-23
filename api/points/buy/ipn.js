import { handlePointsBuyIpn } from "../../../lib/points-buy-handlers.js";

export default function handler(req, res) {
  return handlePointsBuyIpn(req, res);
}
