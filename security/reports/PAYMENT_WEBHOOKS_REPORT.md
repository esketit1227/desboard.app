# PAYMENT_WEBHOOKS

## Status: PASS

## Findings

**Signature verification, live-tested, not just read.** `server/billing.ts`'s webhook route uses `express.raw({ type: "application/json" })` (not the global JSON parser) and `stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET)`. Confirmed the router mounting order in `server.ts` is still correct after this pass's `SECURITY_HEADERS` change (`createBillingWebhookRouter()` at line 312, `express.json()` at line 314 — webhook router still registered first, and `helmet` — mounted even earlier — only sets response headers and never touches the request body, so it can't interfere with raw-body signature verification). Booted a real `tsx server.ts` instance and sent a webhook POST with no `Stripe-Signature` header: got a clean `400 Webhook Error: No stripe-signature header value was provided.` from the Stripe SDK itself — proof the raw bytes reached `constructEvent` untouched, not a body-parsing error, which is exactly what a broken mounting order would produce instead.

**Idempotency.** Every event, on every code path, calls `claimStripeEvent(event.id, event.type)` before any handling logic runs; a duplicate (Stripe's at-least-once delivery, or a Dashboard "Resend") gets a `200 {received: true, duplicate: true}` with no re-processing. `claimStripeEvent` (already reviewed under `DATABASE_ACCESS`) uses the same `INSERT OR IGNORE` + check-`.changes` idiom as the rest of this codebase's other idempotency needs.

**Event lifecycle.** Handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`, all funneled through one shared `applySubscriptionToWorkspace()` helper so the three paths can't record state differently. Every unrecognized event type falls through to `default: break` and still acks `200` — correct (Stripe interprets a non-2xx as "retry me," so silently-ignored-but-acked event types don't cause retry storms). CLAUDE.md's example lifecycle also names `payment_intent.succeeded`/`invoice.payment_failed`; this app's entitlement model only cares about the subscription's own `status` field (`active`/`past_due`/`canceled`/etc.), and Stripe already emits `customer.subscription.updated` on every one of those status transitions — including exactly when an invoice payment fails and the subscription moves to `past_due`. Handling `customer.subscription.updated` alone is functionally equivalent to (and more current than) also listening for `invoice.payment_failed` separately for this app's specific needs — a deliberate scope decision, not an oversight, and one that matches the plan-file's own stated design: `past_due` subscriptions stay entitled with a non-blocking warning, so what matters is that `subscription_status` gets synced, which it does.

**`applySubscriptionToWorkspace` derives `{tier, interval}` from the subscription's actual Stripe price** (`tierForPriceId`), not from whatever the frontend originally requested at checkout time — defense in depth against a tampered client-side checkout request ever mattering, since the webhook re-derives truth from Stripe's own data regardless.

**Studio's 3-seat minimum is enforced server-side at checkout**, not just in the UI: `Math.max(3, Math.floor(Number(seats) || 3))` for the `studio` tier, and `line_items[].adjustable_quantity` is deliberately omitted from the Checkout Session so a customer can't edit the quantity back down on Stripe's own hosted page, bypassing this route's validation.

**Checkout/Billing Portal routes are owner-gated** (`requireOwner`, already verified under `ACCESS_CONTROL`) and both return a friendly `503` rather than crashing when `STRIPE_SECRET_KEY` is unset — verified this doesn't block the rest of the app: trial status, the landing page, and `/pricing` all work with zero Stripe configuration.

## What's at risk

Nothing rises to a fix in this category. One minor, non-webhook-related observation worth naming: `success_url`/`cancel_url` on the Checkout Session (and the Billing Portal's `return_url`) fall back to `` `${req.protocol}://${req.get("host")}` `` when `APP_BASE_URL` isn't set — the same Host-header-derived pattern flagged under `XSS` for the reminder email. Here the consequence is much smaller (it's Stripe's own hosted redirect target, not HTML this app renders, so there's no injection risk — at worst a payer's own browser gets redirected somewhere unexpected after their own payment, and only if the paying owner themselves crafts a raw request with a non-default `Host` header, since a real browser never lets script override that header). Not fixed here since `.env.example` already documents `APP_BASE_URL` as the correct production setting for exactly this purpose, and the fallback exists specifically as a local-dev convenience per its own comment.

## What's already secure

- Signature verification is correctly wired and was proven live, not just read from source.
- Idempotency is enforced before any side effect on every event type.
- Entitlement state is always re-derived from Stripe's own authoritative subscription data, never trusted from client input.
- Business-rule validation (3-seat minimum) is enforced server-side and can't be bypassed via Stripe's own hosted UI.
- `updateWorkspaceBilling` (the only function that can change a workspace's plan/entitlement) is reachable from exactly two call sites, both inside this signature-verified webhook handler — reconfirmed this pass, matching the `DATABASE_ACCESS` finding.

## Recommendations

None required. If you want to close the minor `Host`-header-fallback note above, ensure `APP_BASE_URL` is always set in your production environment (already the documented recommendation) — not treated as a required fix here given the trivial impact and existing guidance.
