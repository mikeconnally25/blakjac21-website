import { getSession } from "./session.js";
import { getAppBaseUrl, cleanEnv } from "./config.js";
import { awardPoints } from "./points.js";
import {
  createInvoice,
  isNowPaymentsConfigured,
  verifyIpnSignature,
} from "./nowpayments.js";
import {
  createPurchase,
  getPurchaseById,
  getPurchaseLimits,
  listPointPackages,
  markPurchasePaid,
  resolvePurchaseAmount,
  revertPurchasePaid,
  updatePurchaseInvoice,
} from "./points-purchases.js";

const CREDIT_STATUSES = new Set(["finished", "confirmed"]);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  if (req.body && typeof req.body === "object") {
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

function getSiteBaseUrl(req) {
  const fromEnv = cleanEnv(process.env.SITE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return getAppBaseUrl(req).replace(/\/$/, "");
}

export async function handlePointsBuyPackages(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const limits = getPurchaseLimits();
  sendJson(res, 200, {
    ok: true,
    configured: isNowPaymentsConfigured(),
    rate: limits.rate,
    minUsd: limits.minUsd,
    maxUsd: limits.maxUsd,
    minPoints: limits.minPoints,
    maxPoints: limits.maxPoints,
    stepPoints: limits.stepPoints,
    packages: listPointPackages(),
  });
}

export async function handlePointsBuy(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
    return;
  }

  if (!isNowPaymentsConfigured()) {
    sendJson(res, 503, {
      error: "Crypto purchases are not configured yet.",
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const resolved = resolvePurchaseAmount({
      packageId: body.packageId,
      points: body.points,
      usd: body.usd,
    });

    const order = await createPurchase({
      kickUserId: session.kickUserId,
      username: session.username,
      points: resolved.points,
      usdAmount: resolved.usdAmount,
      packageId: resolved.packageId,
    });

    const baseUrl = getSiteBaseUrl(req);
    const invoice = await createInvoice({
      priceAmount: resolved.usdAmount,
      orderId: order.id,
      orderDescription: `${resolved.points.toLocaleString()} store points`,
      ipnCallbackUrl: `${baseUrl}/api/points/buy/ipn`,
      successUrl: `${baseUrl}/store/?purchase=success`,
      cancelUrl: `${baseUrl}/store/?purchase=cancel`,
    });

    await updatePurchaseInvoice(order.id, { invoiceId: invoice.invoiceId });

    sendJson(res, 200, {
      ok: true,
      orderId: order.id,
      points: order.points,
      usdAmount: order.usdAmount,
      invoiceUrl: invoice.invoiceUrl,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not start crypto purchase.",
    });
  }
}

export async function handlePointsBuyIpn(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid IPN body." });
    return;
  }

  const signature =
    req.headers["x-nowpayments-sig"] ||
    req.headers["X-Nowpayments-Sig"] ||
    "";

  if (!verifyIpnSignature(body, signature)) {
    sendJson(res, 401, { error: "Invalid IPN signature." });
    return;
  }

  const status = String(body.payment_status || body.status || "")
    .trim()
    .toLowerCase();
  const orderId = String(body.order_id || "").trim();
  const paymentId =
    body.payment_id != null
      ? String(body.payment_id).trim()
      : body.paymentId != null
        ? String(body.paymentId).trim()
        : "";

  if (!CREDIT_STATUSES.has(status)) {
    sendJson(res, 200, { ok: true, ignored: true, status });
    return;
  }

  if (!orderId || !paymentId) {
    sendJson(res, 400, { error: "Missing order_id or payment_id." });
    return;
  }

  const existing = await getPurchaseById(orderId);
  if (!existing) {
    sendJson(res, 404, { error: "Unknown purchase order." });
    return;
  }

  try {
    const result = await markPurchasePaid(orderId, paymentId);
    if (!result) {
      sendJson(res, 404, { error: "Unknown purchase order." });
      return;
    }

    if (result.awarded) {
      try {
        await awardPoints({
          kickUserId: result.order.kickUserId,
          username: result.order.username,
          amount: result.order.points,
          note: "Crypto purchase",
        });
      } catch (error) {
        await revertPurchasePaid(orderId, paymentId);
        throw error;
      }
    }

    sendJson(res, 200, {
      ok: true,
      awarded: result.awarded,
      orderId: result.order.id,
      paymentId,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not process IPN.",
    });
  }
}
