import Stripe from "stripe";
import { cleanEnv } from "./config.js";

/** Electronically supplied services — virtual currency / digital content. */
export const UNCCOINS_TAX_CODE = "txcd_10000000";

function getSecretKey() {
  return cleanEnv(process.env.STRIPE_SECRET_KEY);
}

export function getStripeWebhookSecret() {
  return cleanEnv(process.env.STRIPE_WEBHOOK_SECRET);
}

export function isStripeConfigured() {
  return Boolean(getSecretKey());
}

export function getStripeClient() {
  const key = getSecretKey();
  if (!key) {
    throw new Error("Stripe is not configured (missing STRIPE_SECRET_KEY).");
  }
  return new Stripe(key);
}

/**
 * Create a hosted Checkout Session for an UncCoins package.
 * Tax is calculated when Stripe Tax is active on the account.
 */
export async function createUncCoinsCheckoutSession({
  orderId,
  points,
  usdAmount,
  packageId,
  kickUserId,
  username,
  successUrl,
  cancelUrl,
}) {
  const stripe = getStripeClient();
  const amount = Number(usdAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Checkout amount must be greater than zero.");
  }

  const unitAmount = Math.round(amount * 100);
  if (unitAmount < 50) {
    throw new Error("Minimum card purchase is $0.50.");
  }

  const label = `${Number(points).toLocaleString()} UncCoins`;
  const taxEnabled = cleanEnv(process.env.STRIPE_AUTOMATIC_TAX) !== "0";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "hosted",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: String(orderId),
      billing_address_collection: "required",
      customer_creation: "if_required",
      automatic_tax: { enabled: taxEnabled },
      tax_id_collection: { enabled: taxEnabled },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            tax_behavior: taxEnabled ? "exclusive" : "unspecified",
            product_data: {
              name: label,
              description: "BLAKJAC21 UncCoins (site currency)",
              tax_code: UNCCOINS_TAX_CODE,
              metadata: {
                packageId: packageId ? String(packageId) : "",
                points: String(points),
              },
            },
          },
        },
      ],
      metadata: {
        orderId: String(orderId),
        kickUserId: String(kickUserId),
        username: String(username || "viewer").slice(0, 80),
        points: String(points),
        packageId: packageId ? String(packageId) : "",
        usdAmount: String(amount),
        provider: "stripe",
      },
      payment_intent_data: {
        metadata: {
          orderId: String(orderId),
          kickUserId: String(kickUserId),
          points: String(points),
          provider: "stripe",
        },
      },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/tax/i.test(message) && /head.?office|settings|location/i.test(message)) {
      throw new Error(
        "Stripe Tax needs a head office address in the Stripe Dashboard (Tax → Settings) before card checkout can run."
      );
    }
    throw error;
  }
}

/**
 * Verify Stripe webhook signature and parse the event.
 * @param {string|Buffer} rawBody
 * @param {string|null|undefined} signatureHeader
 */
export function constructStripeWebhookEvent(rawBody, signatureHeader) {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    throw new Error("Stripe webhook secret is not configured.");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(
    rawBody,
    String(signatureHeader || ""),
    secret
  );
}
