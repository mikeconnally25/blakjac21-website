import { handleOneVOneStatus } from "../../lib/one-v-one-handlers.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  return handleOneVOneStatus(req, res);
}
