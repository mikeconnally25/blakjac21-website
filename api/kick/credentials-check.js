import { handleKickCredentialsCheck } from "../../../lib/kick-credentials-check.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  return handleKickCredentialsCheck(req, res);
}
