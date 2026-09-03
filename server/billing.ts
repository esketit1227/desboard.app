/**
 * Stripe billing — Checkout, the Billing Portal, and the webhook that syncs
 * subscription state back onto a workspace. Structurally mirrors oauth.ts:
 * pure entitlement logic lives in billingCore.ts, this file is just the
 * Express + Stripe SDK wiring.
 *
 * Two router factories, split by trust level (same reason invites.ts splits
 * into createTeamRouter/createInviteAcceptRouter):
 *   - createBillingWebhookRouter() — public, Stripe-signature-verified, must
 *     be mounted in server.ts BEFORE the global express.json() middleware
 *     (see the comment on the route itself for why).
 *   - createBillingRouter() — studio-session-authenticated.
 */
import express, { type NextFunction, type Response, type Router } from "express";
import Stripe from "stripe";
import {
  claimStripeEvent,
  getEffectiveTier,
  getWorkspaceBillingInfo,
  getWorkspaceIdByStripeCustomerId,
  getWorkspaceStripeCustomerId,
  getWorkspaceStripeSubscriptionId,
  getActiveHandoverCount,
  getWorkspaceMemberCount,
  getWorkspaceStorageBytes,
  setWorkspaceStripeCustomerId,
  updateWorkspaceBilling,
} from "../db.ts";
import {
  resolvePlanFromItems,
  storageAddonUnitsFromItems,
  buildStorageAddonItemsPatch,
  isValidStorageAddonUnits,
  type SubscriptionItemLike,
} from "./billingCore.ts";
import { type AuthedRequest } from "./auth.ts";
import { requireOwner } from "./invites.ts";
import type { PlanTier } from "../src/types.ts";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const hasStripeKey = !!STRIPE_SECRET_KEY;
// Nullable client, same shape as server.ts's `anthropic` — every route below
// checks this and returns a friendly 503 rather than crashing when billing
// hasn't been configured yet. Everything else (trial, its expiry, gating)
// works with zero Stripe config; only checkout/portal/webhook need it.
const stripe = hasStripeKey ? new Stripe(STRIPE_SECRET_KEY!) : null;

if (!hasStripeKey) {
  console.warn(
    "\n[Desboard] WARNING: No STRIPE_SECRET_KEY found in .env — the app runs, and\n" +
      "           every workspace still gets its 14-day trial, but checking out into\n" +
      "           a paid plan stays disabled until you add your key and restart.\n"
  );
}

type Interval = "month" | "year";

function priceIdFor(tier: "freelance" | "studio", interval: Interval): string | null {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${interval === "month" ? "MONTHLY" : "ANNUAL"}`;
  return process.env[key] || null;
}

// Read fresh per use (see buildPriceMap's own comment) rather than cached at
// module load, so a key rotation takes effect without a restart-order dance.
function storageAddonPriceId(): string | null {
  return process.env.STRIPE_PRICE_STORAGE_ADDON || null;
}

/** Maps the real Stripe SDK shape down to billingCore's SDK-free SubscriptionItemLike, once, at the one boundary that needs to know about Stripe.SubscriptionItem at all. */
function mapItems(items: Stripe.SubscriptionItem[]): SubscriptionItemLike[] {
  return items.map((i) => ({
    id: i.id,
    priceId: i.price.id,
    quantity: i.quantity,
    currentPeriodEnd: i.current_period_end ?? null,
  }));
}

/** Built once per call from current env vars (cheap, and lets a key rotation take effect without a restart-order dance) — passed into the pure resolvePlanFromItems (which uses tierForPriceId internally) rather than read there, keeping billingCore.ts free of process.env access. */
function buildPriceMap(): Record<string, { tier: PlanTier; interval: Interval }> {
  const map: Record<string, { tier: PlanTier; interval: Interval }> = {};
  (["freelance", "studio"] as const).forEach((tier) => {
    (["month", "year"] as const).forEach((interval) => {
      const id = priceIdFor(tier, interval);
      if (id) map[id] = { tier, interval };
    });
  });
  return map;
}

function billingStatusPayload(workspaceId: string) {
  const { limits, blocked, tier } = getEffectiveTier(workspaceId);
  const info = getWorkspaceBillingInfo(workspaceId);
  return {
    tier,
    blocked,
    trialEndsAt: info.trialEndsAt,
    subscriptionStatus: info.subscriptionStatus,
    planInterval: info.planInterval,
    seats: info.seats,
    cancelAtPeriodEnd: info.cancelAtPeriodEnd,
    currentPeriodEnd: info.currentPeriodEnd,
    hasStripeCustomer: info.hasStripeCustomer,
    storageAddonUnits: info.storageAddonUnits,
    limits,
    usage: {
      storageBytes: getWorkspaceStorageBytes(workspaceId),
      activeHandovers: getActiveHandoverCount(workspaceId),
      members: getWorkspaceMemberCount(workspaceId),
    },
  };
}

/**
 * Applies a Stripe subscription's current state to the workspace it belongs
 * to. Shared by both the checkout-completed and subscription-updated webhook
 * handlers so they can't drift into recording things differently. Derives
 * {tier, interval} from the subscription's ACTUAL price (not whatever the
 * frontend originally requested at checkout) — what gets recorded reflects
 * what Stripe actually billed.
 *
 * Scans ALL of the subscription's items (via billingCore's resolvePlanFromItems),
 * not just the first one — a Studio subscription can carry a second (storage
 * add-on) item once one's been purchased, and reading only items[0] would
 * silently misread tier/interval/seats depending on Stripe's own item order.
 * Also persists stripeSubscriptionId, which nothing wrote before this.
 */
async function applySubscriptionToWorkspace(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId =
    subscription.metadata?.workspaceId ||
    getWorkspaceIdByStripeCustomerId(typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id);
  if (!workspaceId) {
    console.error("[billing] Could not resolve a workspace for subscription", subscription.id);
    return;
  }

  const items = mapItems(subscription.items.data);
  const resolved = resolvePlanFromItems(items, buildPriceMap());
  if (!resolved) {
    console.error(
      "[billing] Subscription",
      subscription.id,
      "has no item matching a known plan price",
      items.map((i) => i.priceId)
    );
    return;
  }

  updateWorkspaceBilling(workspaceId, {
    planTier: resolved.tier,
    planInterval: resolved.interval,
    seats: resolved.seats,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: resolved.currentPeriodEnd ? new Date(resolved.currentPeriodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    storageAddonUnits: storageAddonUnitsFromItems(items, storageAddonPriceId()),
  });
}

export function createBillingWebhookRouter(): Router {
  const router = express.Router();

  // express.raw() here, NOT express.json() — Stripe's signature verification
  // needs the exact, untouched request body bytes. This route (and this
  // whole router) must be mounted in server.ts BEFORE the global
  // app.use(express.json(...)), or by the time this handler runs the body
  // has already been consumed and parsed, and constructEvent() can never
  // succeed. A curl with a missing/bogus Stripe-Signature header should
  // fail with a clean 400 from constructEvent — if that mounting order is
  // wrong instead, it fails as a body-parsing error, not a signature one.
  router.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "Billing is not configured" });

    let event: Stripe.Event;
    try {
      const signature = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, signature as string, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("[billing] Webhook signature verification failed:", (err as Error).message);
      return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    }

    // Stripe guarantees at-least-once delivery, not exactly-once — a retry
    // or a manual "Resend" from the Dashboard redelivers the same event id.
    if (!claimStripeEvent(event.id, event.type)) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (!session.subscription) break; // shouldn't happen for mode:'subscription', but nothing to sync if so
          const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await applySubscriptionToWorkspace(subscription);
          break;
        }
        case "customer.subscription.updated": {
          await applySubscriptionToWorkspace(event.data.object as Stripe.Subscription);
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const workspaceId =
            subscription.metadata?.workspaceId ||
            getWorkspaceIdByStripeCustomerId(typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id);
          // Deliberately does NOT reset plan_tier back to 'trial' — kept as a
          // historical record. getEffectiveTier() blocks on
          // subscription_status === 'canceled' regardless of plan_tier, so
          // there's no path to re-earning a free trial by canceling.
          if (workspaceId) updateWorkspaceBilling(workspaceId, { subscriptionStatus: "canceled" });
          break;
        }
        default:
          break; // ack and ignore anything we don't act on
      }
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[billing] Webhook handler error for", event.type, err);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  });

  return router;
}

/** Mounted right after the blanket requireAuth, but BEFORE this middleware, so a blocked workspace can still reach checkout/portal to unblock itself. */
export function requireActivePlan(req: AuthedRequest, res: Response, next: NextFunction) {
  const { blocked } = getEffectiveTier(req.auth!.workspaceId);
  if (blocked) return res.status(402).json({ error: "Your plan needs attention before you can keep working.", blocked: true });
  next();
}

export function createBillingRouter(): Router {
  const router = express.Router();

  // No requireActivePlan on this router — it must work even while blocked,
  // it's how the frontend (BillingGate) learns a workspace IS blocked, and
  // how an owner reaches checkout to unblock it.
  router.get("/api/billing/status", (req: AuthedRequest, res) => {
    res.json(billingStatusPayload(req.auth!.workspaceId));
  });

  router.post("/api/billing/checkout", requireOwner, async (req: AuthedRequest, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing isn't available right now — please try again later." });

    const { tier, interval, seats } = req.body as { tier?: string; interval?: string; seats?: number };
    if (tier !== "freelance" && tier !== "studio") return res.status(400).json({ error: "Unknown plan" });
    if (interval !== "month" && interval !== "year") return res.status(400).json({ error: "Unknown billing interval" });

    const quantity = tier === "studio" ? Math.max(3, Math.floor(Number(seats) || 3)) : 1;
    const priceId = priceIdFor(tier, interval);
    if (!priceId) return res.status(503).json({ error: "That plan isn't available to check out into yet — please try again later." });

    const workspaceId = req.auth!.workspaceId;
    // Persisted before the session is created, and reused on every later
    // checkout attempt — this makes stripe_customer_id the universal join
    // key every subsequent webhook event resolves against, not just this
    // session's own `checkout.session.completed`.
    let customerId = getWorkspaceStripeCustomerId(workspaceId);
    if (!customerId) {
      const customer = await stripe.customers.create({ email: req.body.email as string | undefined, metadata: { workspaceId } });
      setWorkspaceStripeCustomerId(workspaceId, customer.id);
      customerId = customer.id;
    }

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity }],
      client_reference_id: workspaceId,
      metadata: { workspaceId, tier },
      subscription_data: { metadata: { workspaceId, tier } },
      allow_promotion_codes: true,
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
      // Deliberately no line_items[].adjustable_quantity — letting a customer
      // edit quantity on Stripe's own hosted page would let them edit around
      // Studio's 3-seat minimum, outside this route's own validation above.
    });
    if (!session.url) return res.status(500).json({ error: "Could not start checkout — try again" });
    res.json({ url: session.url });
  });

  // Buys (or reduces/removes) Studio's storage add-on as a second recurring
  // line item on the workspace's EXISTING subscription — never a new
  // Checkout Session, matching the same reasoning as the "no
  // adjustable_quantity" note on /checkout above: a customer who already has
  // an active subscription must change it in place, never end up
  // double-subscribed. Applies instantly (no redirect) since the card is
  // already on file; the async webhook re-applies the same state moments
  // later as a harmless, idempotent confirmation.
  router.post("/api/billing/storage-addon", requireOwner, async (req: AuthedRequest, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing isn't available right now — please try again later." });
    const priceId = storageAddonPriceId();
    if (!priceId) return res.status(503).json({ error: "Extra storage isn't available to buy yet — please try again later." });

    const { units } = req.body as { units?: number };
    if (!isValidStorageAddonUnits(units)) {
      return res.status(400).json({ error: "Enter a valid number of storage add-on units" });
    }

    const workspaceId = req.auth!.workspaceId;
    const info = getWorkspaceBillingInfo(workspaceId);
    const subscriptionId = getWorkspaceStripeSubscriptionId(workspaceId);
    if (info.planTier !== "studio" || info.subscriptionStatus !== "active" || !subscriptionId) {
      return res.status(400).json({ error: "You need an active Studio subscription before you can buy more storage." });
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const patch = buildStorageAddonItemsPatch(mapItems(subscription.items.data), priceId, units);
    if (patch) {
      await stripe.subscriptions.update(subscriptionId, { items: patch, proration_behavior: "always_invoice" });
      // Write immediately from this request's own validated value — the
      // update call above is Stripe's own synchronous confirmation the
      // change took. The subscription.updated webhook re-applies the same
      // state shortly after; redundant, but harmless (idempotent).
      updateWorkspaceBilling(workspaceId, { storageAddonUnits: units });
    }
    res.json(billingStatusPayload(workspaceId));
  });

  router.post("/api/billing/portal", requireOwner, async (req: AuthedRequest, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing isn't available right now — please try again later." });
    const workspaceId = req.auth!.workspaceId;
    const customerId = getWorkspaceStripeCustomerId(workspaceId);
    if (!customerId) return res.status(400).json({ error: "Choose a plan first — there's no billing account to manage yet." });

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${baseUrl}/` });
    res.json({ url: session.url });
  });

  return router;
}
