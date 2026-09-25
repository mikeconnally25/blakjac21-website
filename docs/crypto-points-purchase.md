# Buy store points with NOWPayments

> **Status:** Active — Buy points UI is on `/store/`. Backend credits after verified IPN.

Crypto checkout for channel points via hosted NOWPayments invoices.

## Setup checklist

1. In NOWPayments → **Store Settings**:
   - Create an **API key** (not the public key)
   - Generate an **IPN Secret Key** (copy it once)
2. In Vercel → Project → **Environment Variables** (Production + Preview if needed):
   - `NOWPAYMENTS_API_KEY`
   - `NOWPAYMENTS_IPN_SECRET`
   - `SITE_URL` = `https://website-blakjac21.vercel.app`
   - Optional: `NOWPAYMENTS_SANDBOX` = `1` for sandbox testing
   - Optional: `POINTS_USD_RATE` (default `100`)
3. Set NOWPayments IPN URL to:
   `https://website-blakjac21.vercel.app/api/points/buy/ipn`
4. **Redeploy** Vercel (env vars do not apply until redeploy).
5. Confirm `GET /api/points/buy/packages` returns `"configured": true`.
6. Admins can pause/resume purchases from the Store admin panel (`POST /api/points/buy/settings` with `{ "enabled": false }`).
7. Sign in on `/store/`, buy the $1 package, complete payment, wait for IPN credit.

## Env vars

| Variable | Required | Description |
| --- | --- | --- |
| `NOWPAYMENTS_API_KEY` | Yes | API key from the NOWPayments dashboard |
| `NOWPAYMENTS_IPN_SECRET` | Yes | IPN secret used to verify `x-nowpayments-sig` |
| `NOWPAYMENTS_SANDBOX` | No | Set to `1` to use `api-sandbox.nowpayments.io` |
| `POINTS_USD_RATE` | No | Points per $1 USD (default `100`) |
| `SITE_URL` | Recommended on Vercel | Public site origin for IPN + success/cancel URLs |

Also requires existing Upstash Redis env vars so purchase orders persist.

## Return URLs

After checkout, NOWPayments redirects to:

- Success: `/store/?purchase=success`
- Cancel: `/store/?purchase=cancel`

The store UI shows a status message, strips the query, and refreshes balance. Points credit only on signed IPN status `finished` or `confirmed` (idempotent on `payment_id`).

## Pricing

- Fixed packages: 2,000 points for $15 · 10,000 points for $75
- Custom amounts are disabled
- Charged in USD (`price_currency: usd`); user picks coin on NOWPayments
