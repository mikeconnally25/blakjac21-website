import { getSession } from "./session.js";
import { getAppBaseUrl, cleanEnv } from "./config.js";
import { awardPoints } from "./points.js";
import {
  createInvoice,
  isNowPaymentsConfigured,
  verifyIpnSignature,
} from "./nowpayments.js";
import {
  createUncCoinsCheckoutSession,
  constructStripeWebhookEvent,
  isStripeConfigured,
} from "./stripe.js";
import {
  createPurchase,
  getPurchaseById,
  getPurchaseLimits,
  getPointsBuySettings,
  isPointsBuyingEnabled,
  listPointPackages,
  markPurchasePaid,
  resolvePurchaseAmount,
  revertPurchasePaid,
  setPointsBuyingEnabled,
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

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.length) {
    return Buffer.from(req.body, "utf8");
  }
  if (req.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function getSiteBaseUrl(req) {
  const fromEnv = cleanEnv(process.env.SITE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return getAppBaseUrl(req).replace(/\/$/, "");
}

function buyingConfigured() {
  return isStripeConfigured() || isNowPaymentsConfigured();
}

export async function handlePointsBuyPackages(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const limits = getPurchaseLimits();
  const settings = await getPointsBuySettings();
  const stripeConfigured = isStripeConfigured();
  const cryptoConfigured = isNowPaymentsConfigured();
  sendJson(res, 200, {
    ok: true,
    configured: buyingConfigured(),
    stripeConfigured,
    cryptoConfigured,
    enabled: settings.enabled !== false,
    rate: limits.rate,
    minUsd: limits.minUsd,
    maxUsd: limits.maxUsd,
    minPoints: limits.minPoints,
    maxPoints: limits.maxPoints,
    stepPoints: limits.stepPoints,
    packages: listPointPackages(),
  });
}

export async function handlePointsBuySettings(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const session = await getSession(req);
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin only." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (typeof body.enabled !== "boolean") {
    sendJson(res, 400, { error: "Provide enabled as true or false." });
    return;
  }

  try {
    const settings = await setPointsBuyingEnabled(body.enabled);
    sendJson(res, 200, {
      ok: true,
      enabled: settings.enabled,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not update buy UncCoins settings.",
    });
  }
}

function resolvePayMethod(body) {
  const raw = String(body?.method || body?.provider || "")
    .trim()
    .toLowerCase();
  if (raw === "stripe" || raw === "card") return "stripe";
  if (raw === "crypto" || raw === "nowpayments") return "crypto";

  if (isStripeConfigured()) return "stripe";
  if (isNowPaymentsConfigured()) return "crypto";
  return null;
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

  if (!buyingConfigured()) {
    sendJson(res, 503, {
      error: "Purchases are not configured yet.",
    });
    return;
  }

  if (!(await isPointsBuyingEnabled())) {
    sendJson(res, 503, {
      error: "Buying UncCoins is paused right now. Try again later.",
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

  const method = resolvePayMethod(body);
  if (!method) {
    sendJson(res, 503, { error: "Purchases are not configured yet." });
    return;
  }

  if (method === "stripe" && !isStripeConfigured()) {
    sendJson(res, 503, { error: "Card purchases are not configured yet." });
    return;
  }
  if (method === "crypto" && !isNowPaymentsConfigured()) {
    sendJson(res, 503, { error: "Crypto purchases are not configured yet." });
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
      provider: method,
    });

    const baseUrl = getSiteBaseUrl(req);

    if (method === "stripe") {
      const checkout = await createUncCoinsCheckoutSession({
        orderId: order.id,
        points: resolved.points,
        usdAmount: resolved.usdAmount,
        packageId: resolved.packageId,
        kickUserId: session.kickUserId,
        username: session.username,
        successUrl: `${baseUrl}/store/?purchase=success&provider=stripe`,
        cancelUrl: `${baseUrl}/store/?purchase=cancel&provider=stripe`,
      });

      await updatePurchaseInvoice(order.id, { invoiceId: checkout.sessionId });

      sendJson(res, 200, {
        ok: true,
        method: "stripe",
        orderId: order.id,
        points: order.points,
        usdAmount: order.usdAmount,
        checkoutUrl: checkout.url,
        invoiceUrl: checkout.url,
      });
      return;
    }

    const invoice = await createInvoice({
      priceAmount: resolved.usdAmount,
      orderId: order.id,
      orderDescription: `${resolved.points.toLocaleString()} UncCoins`,
      ipnCallbackUrl: `${baseUrl}/api/points/buy/ipn`,
      successUrl: `${baseUrl}/store/?purchase=success&provider=crypto`,
      cancelUrl: `${baseUrl}/store/?purchase=cancel&provider=crypto`,
    });

    await updatePurchaseInvoice(order.id, { invoiceId: invoice.invoiceId });

    sendJson(res, 200, {
      ok: true,
      method: "crypto",
      orderId: order.id,
      points: order.points,
      usdAmount: order.usdAmount,
      invoiceUrl: invoice.invoiceUrl,
      checkoutUrl: invoice.invoiceUrl,
    });
  } catch (error) {
    const message = error.message || "Could not start purchase.";
    sendJson(res, 400, { error: message });
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

async function fulfillStripeCheckoutSession(session) {
  if (!session || session.payment_status !== "paid") {
    return { ok: true, ignored: true, reason: "not_paid" };
  }

  const orderId = String(
    session.metadata?.orderId || session.client_reference_id || ""
  ).trim();
  const paymentId = String(
    session.payment_intent || session.id || ""
  ).trim();

  if (!orderId || !paymentId) {
    return { ok: false, error: "Missing orderId or payment id." };
  }

  const existing = await getPurchaseById(orderId);
  if (!existing) {
    return { ok: false, error: "Unknown purchase order." };
  }

  const result = await markPurchasePaid(orderId, paymentId);
  if (!result) {
    return { ok: false, error: "Unknown purchase order." };
  }

  if (result.awarded) {
    try {
      await awardPoints({
        kickUserId: result.order.kickUserId,
        username: result.order.username,
        amount: result.order.points,
        note: "Stripe purchase",
      });
    } catch (error) {
      await revertPurchasePaid(orderId, paymentId);
      throw error;
    }
  }

  return {
    ok: true,
    awarded: result.awarded,
    orderId: result.order.id,
    paymentId,
  };
}

export async function handlePointsBuyStripeWebhook(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isStripeConfigured()) {
    sendJson(res, 503, { error: "Stripe is not configured." });
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature =
      req.headers["stripe-signature"] || req.headers["Stripe-Signature"] || "";
    event = constructStripeWebhookEvent(rawBody, signature);
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Invalid Stripe webhook signature.",
    });
    return;
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const outcome = await fulfillStripeCheckoutSession(event.data.object);
      if (!outcome.ok) {
        sendJson(res, 400, { error: outcome.error || "Fulfillment failed." });
        return;
      }
      sendJson(res, 200, outcome);
      return;
    }

    sendJson(res, 200, { ok: true, ignored: true, type: event.type });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not process Stripe webhook.",
    });
  }
}
