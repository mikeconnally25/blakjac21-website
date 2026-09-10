import { getSession } from "./session.js";
import {
  ackOverlayAlert,
  enqueueOverlayAlert,
  getDefaultOverlayConfig,
  getOverlayConfig,
  listPendingOverlayAlerts,
  saveOverlayConfig,
} from "./stream-overlay.js";
import {
  getClipUploadMode,
  handleBlobClientUpload,
  saveLocalClipUpload,
} from "./stream-overlay-clips.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireAdmin(session, res) {
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

function requestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

export async function handleStreamOverlayGet(req, res) {
  try {
    const config = await getOverlayConfig();
    sendJson(res, 200, { config });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load overlay config." });
  }
}

export async function handleStreamOverlayClipUploadMode(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const mode = getClipUploadMode();
  sendJson(res, 200, {
    mode,
    maxBytes: 150 * 1024 * 1024,
    message:
      mode === "unavailable"
        ? "Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) to upload clips on production."
        : mode === "blob"
          ? "Uploads go to Vercel Blob."
          : "Uploads are stored in /clips on this server.",
  });
}

export async function handleStreamOverlayClipUpload(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  const contentType = String(req.headers["content-type"] || "");
  const mode = getClipUploadMode();

  try {
    if (contentType.includes("application/json")) {
      if (mode !== "blob") {
        sendJson(res, 501, {
          error:
            mode === "unavailable"
              ? "Connect Vercel Blob to upload clips on production."
              : "Blob client upload is not available in local mode.",
          mode,
        });
        return;
      }

      const body = await readJsonBody(req);
      const result = await handleBlobClientUpload({ body, request: req });
      sendJson(res, 200, result);
      return;
    }

    if (mode === "unavailable") {
      sendJson(res, 501, {
        error: "Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) to upload clips on production.",
        mode,
      });
      return;
    }

    if (mode === "blob") {
      // Prefer client → Blob direct upload (avoids serverless body limits).
      sendJson(res, 400, {
        error: "Use the browser dropzone upload (Blob client upload).",
        mode,
      });
      return;
    }

    const filename =
      (typeof req.query?.filename === "string" && req.query.filename) ||
      new URL(req.url || "", "http://localhost").searchParams.get("filename") ||
      "clip.mp4";

    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : await readRequestBufferSafe(req);

    const saved = await saveLocalClipUpload({
      buffer,
      filename,
      contentType,
      origin: requestOrigin(req),
    });

    sendJson(res, 200, { url: saved.url, pathname: saved.pathname, mode: "local" });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Upload failed." });
  }
}

async function readRequestBufferSafe(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function handleStreamOverlaySave(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const config = await saveOverlayConfig(body.config || body);
    sendJson(res, 200, { config, defaults: getDefaultOverlayConfig() });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not save overlay config." });
  }
}

export async function handleStreamOverlayAlertsGet(req, res) {
  try {
    const alerts = await listPendingOverlayAlerts();
    sendJson(res, 200, { alerts });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load alerts." });
  }
}

export async function handleStreamOverlayAlertsAck(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const ok = await ackOverlayAlert(body.id || body.alertId);
    if (!ok) {
      sendJson(res, 404, { error: "Alert not found." });
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not acknowledge alert." });
  }
}

export async function handleStreamOverlayAlertsTest(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const type = String(body.type || "sub").toLowerCase();
  const username = String(body.username || session.username || "TestUser");
  const count = Number(body.count) || 5;

  try {
    const alert = await enqueueOverlayAlert({
      type: type === "gift" ? "gift" : type === "resub" ? "resub" : type === "test" ? "test" : "sub",
      username,
      count: type === "gift" ? count : null,
      message: type === "test" ? `${username} triggered a test alert` : null,
    });
    sendJson(res, 200, { alert });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not enqueue test alert." });
  }
}
