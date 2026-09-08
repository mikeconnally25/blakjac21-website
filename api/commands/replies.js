import {
  handleBotRepliesGet,
  handleBotRepliesSave,
} from "../../lib/bot-replies-handlers.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleBotRepliesGet(req, res);
  }

  if (req.method === "POST") {
    return handleBotRepliesSave(req, res);
  }

  res.statusCode = 405;
  return res.end("Method not allowed");
}
