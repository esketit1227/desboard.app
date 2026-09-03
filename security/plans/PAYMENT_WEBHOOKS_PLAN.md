# PAYMENT_WEBHOOKS

## Changes

None. Signature verification, idempotency, and event-lifecycle handling were all verified correct — see `security/reports/PAYMENT_WEBHOOKS_REPORT.md`. No code changes needed.

## New files

None.

## Verification goals

- [x] Webhook route uses `express.raw()`, mounted before the global `express.json()` — confirmed still true after this pass's `helmet` insertion
- [x] Live test: a webhook POST with no `Stripe-Signature` header returns a clean `400` from the Stripe SDK's own `constructEvent`, not a body-parsing error
- [x] Every event path calls `claimStripeEvent` before any handling logic; duplicates ack `200` without reprocessing
- [x] `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` all funnel through one shared state-application helper
- [x] Unrecognized event types ack `200` rather than erroring (avoids Stripe retry storms)
- [x] Plan tier/interval are derived from the subscription's actual Stripe price, never trusted from the original client request
- [x] Studio's 3-seat minimum is enforced server-side and can't be bypassed via Stripe's hosted Checkout/Portal UI
- [x] Checkout/Billing Portal routes are owner-gated and degrade to a friendly `503` (not a crash) with no Stripe key configured

## Manual verification (for the human)

- With Stripe test mode configured: run `stripe listen --forward-to localhost:3000/api/billing/webhook`, complete a real test checkout (`4242 4242 4242 4242`), confirm the workspace row updates. Replay the same event from the Stripe Dashboard ("Resend") and confirm it's a silent no-op. Not re-verified live in this pass (would require live Stripe test-mode credentials); everything checked here was static/code-level plus the one live signature-rejection test.
- Ensure `APP_BASE_URL` is set in your real production environment (see report's "What's at risk" note on the `Host`-header fallback for checkout redirect URLs).
