import { handleOneVOneBet } from "../../lib/one-v-one-handlers.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  return handleOneVOneBet(req, res);
}
