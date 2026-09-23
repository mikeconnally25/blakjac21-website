import crypto from "crypto";
import { cleanEnv } from "./config.js";

const LIVE_API = "https://api.nowpayments.io/v1";
const SANDBOX_API = "https://api-sandbox.nowpayments.io/v1";

function getApiBase() {
  return cleanEnv(process.env.NOWPAYMENTS_SANDBOX) === "1"
    ? SANDBOX_API
    : LIVE_API;
}

function getApiKey() {
  return cleanEnv(process.env.NOWPAYMENTS_API_KEY);
}

function getIpnSecret() {
  return cleanEnv(process.env.NOWPAYMENTS_IPN_SECRET);
}

export function isNowPaymentsConfigured() {
  return Boolean(getApiKey() && getIpnSecret());
}

/**
 * Recursively sort object keys for NOWPayments IPN HMAC.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Verify x-nowpayments-sig against the parsed IPN body.
 * @param {object} payload
 * @param {string|null|undefined} signatureHeader
 */
export function verifyIpnSignature(payload, signatureHeader) {
  const secret = getIpnSecret();
  const signature = String(signatureHeader || "").trim().toLowerCase();
  if (!secret || !signature || !payload || typeof payload !== "object") {
    return false;
  }

  const message = JSON.stringify(sortObjectKeys(payload));
  const digest = crypto
    .createHmac("sha512", secret)
    .update(message)
    .digest("hex")
    .toLowerCase();

  try {
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Create a hosted checkout invoice. User picks coin on NOWPayments.
 * @param {{
 *   priceAmount: number,
 *   orderId: string,
 *   orderDescription?: string,
 *   ipnCallbackUrl: string,
 *   successUrl: string,
 *   cancelUrl: string,
 * }} params
 */
export async function createInvoice({
  priceAmount,
  orderId,
  orderDescription = "Store points",
  ipnCallbackUrl,
  successUrl,
  cancelUrl,
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("NOWPayments is not configured (missing API key).");
  }

  const amount = Number(priceAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invoice amount must be greater than zero.");
  }

  const response = await fetch(`${getApiBase()}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: amount,
      price_currency: "usd",
      order_id: String(orderId),
      order_description: String(orderDescription || "Store points"),
      ipn_callback_url: ipnCallbackUrl,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
    cache: "no-store",
  });

  const raw = await response.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      `NOWPayments invoice failed (HTTP ${response.status}).`;
    throw new Error(message);
  }

  const invoiceUrl = data.invoice_url || data.invoiceUrl;
  if (!invoiceUrl) {
    throw new Error("NOWPayments did not return an invoice URL.");
  }

  return {
    invoiceId: data.id != null ? String(data.id) : null,
    invoiceUrl: String(invoiceUrl),
    raw: data,
  };
}
