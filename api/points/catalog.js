import {
  handlePointsCatalogGet,
  handlePointsCatalogUpsert,
} from "../../lib/points-handlers.js";

export default function handler(req, res) {
  if (req.method === "GET") {
    return handlePointsCatalogGet(req, res);
  }

  if (req.method === "POST") {
    return handlePointsCatalogUpsert(req, res);
  }

  res.statusCode = 405;
  return res.end("Method not allowed");
}
