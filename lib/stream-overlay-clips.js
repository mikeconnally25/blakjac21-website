import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { handleUpload } from "@vercel/blob/client";

const CLIPS_DIR = path.resolve("clips");
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "application/octet-stream",
]);

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function getClipUploadMode() {
  if (hasBlobToken()) return "blob";
  if (process.env.VERCEL === "1") return "unavailable";
  return "local";
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "clip.mp4"));
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_").replace(/\s+/g, "-").slice(0, 80);
  return cleaned || "clip.mp4";
}

function ensureVideoExtension(filename, contentType) {
  if (/\.(mp4|webm|mov|m4v)$/i.test(filename)) return filename;
  if (contentType === "video/webm") return `${filename}.webm`;
  if (contentType === "video/quicktime") return `${filename}.mov`;
  return `${filename}.mp4`;
}

async function readRequestBuffer(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function saveLocalClipUpload({ buffer, filename, contentType, origin }) {
  if (!buffer?.length) {
    throw new Error("Empty upload.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Clip is too large (max 150MB).");
  }

  const type = String(contentType || "video/mp4").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type) && !type.startsWith("video/")) {
    throw new Error("Only video files (mp4, webm, mov) are allowed.");
  }

  const safeName = ensureVideoExtension(sanitizeFilename(filename), type);
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`;
  await fs.mkdir(CLIPS_DIR, { recursive: true });
  await fs.writeFile(path.join(CLIPS_DIR, storedName), buffer);

  const base = String(origin || "").replace(/\/$/, "") || "";
  const urlPath = `/clips/${encodeURIComponent(storedName)}`;
  return {
    url: base ? `${base}${urlPath}` : urlPath,
    pathname: urlPath,
    contentType: type,
    size: buffer.length,
  };
}

export async function handleBlobClientUpload({ body, request }) {
  if (!hasBlobToken()) {
    throw new Error("Blob storage is not configured (BLOB_READ_WRITE_TOKEN).");
  }

  return handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      const lower = String(pathname || "").toLowerCase();
      if (!/\.(mp4|webm|mov|m4v)$/.test(lower)) {
        throw new Error("Only mp4, webm, mov, or m4v uploads are allowed.");
      }
      return {
        allowedContentTypes: [
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "video/x-m4v",
          "application/octet-stream",
        ],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
        allowOverwrite: false,
        tokenPayload: JSON.stringify({ kind: "starting-soon-clip" }),
      };
    },
  });
}
