import { handleChatList, handleChatSend } from "../../lib/chat-handlers.js";

export default function handler(req, res) {
  if (req.method === "GET") {
    return handleChatList(req, res);
  }

  if (req.method === "POST") {
    return handleChatSend(req, res);
  }

  res.statusCode = 405;
  return res.end("Method not allowed");
}
