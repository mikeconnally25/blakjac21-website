# Buy store points with NOWPayments

Crypto checkout for channel points via hosted NOWPayments invoices.

## Env vars (Vercel + local `.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `NOWPAYMENTS_API_KEY` | Yes | API key from the NOWPayments dashboard |
| `NOWPAYMENTS_IPN_SECRET` | Yes | IPN secret used to verify `x-nowpayments-sig` |
| `NOWPAYMENTS_SANDBOX` | No | Set to `1` to use `api-sandbox.nowpayments.io` |
| `POINTS_USD_RATE` | No | Points per $1 USD (default `1000`) |
| `SITE_URL` | Recommended on Vercel | Public site origin, e.g. `https://website-blakjac21.vercel.app` — used for IPN + success/cancel URLs. Falls back to `KICK_REDIRECT_URI` host / `VERCEL_URL` |

Also requires the existing Upstash Redis env vars so purchase orders persist.

## Dashboard setup

1. Create a NOWPayments account and generate an API key + IPN secret.
2. Set the env vars above in Vercel (and local `.env`).
3. Set the IPN callback URL in NOWPayments (or rely on per-invoice `ipn_callback_url`) to:
   `https://<your-domain>/api/points/buy/ipn`
4. Sandbox-test one package before going live (`NOWPAYMENTS_SANDBOX=1`).

## Return URLs

After checkout, NOWPayments redirects the browser to:

- Success: `/store/?purchase=success`
- Cancel: `/store/?purchase=cancel`

The store UI shows a status message from that query, strips it from the URL, and refreshes the points balance. Points are credited only when the signed IPN reports `finished` or `confirmed` (idempotent on `payment_id`).

## Pricing

- Fixed packages: 1,000 ($1) · 5,000 ($5) · 10,000 ($10) · 25,000 ($25) at the configured rate
- Custom: steps of `POINTS_USD_RATE`, min $1 / rate pts, max $100 / (rate × 100) pts
- Charged in USD (`price_currency: usd`); user picks coin on NOWPayments
