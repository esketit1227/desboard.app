/**
 * Billing/plan-tier core — PURE functions only (no Express, no Stripe SDK,
 * no database), same convention as authCore.ts/portalCore.ts/oauthCore.ts/
 * ssoCore.ts, so the entitlement math can be unit-tested directly.
 */
import type { PlanTier, PlanLimits } from "../src/types.ts";

const GB = 1024 * 1024 * 1024; // matches storage.ts's existing 1024-based formatBytes

/**
 * Static per-tier entitlements. Trial mirrors Studio's feature set (per the
 * product brief: "full Studio-tier feature set") but with tighter volume
 * caps — including a seat cap Studio itself doesn't have, since an
 * unlimited, no-card-required trial would otherwise be a free-team abuse
 * vector. 3 matches Studio's own seat minimum, so a team can still genuinely
 * trial the multi-seat experience.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  trial: { seatCap: 3, storageCapBytes: 5 * GB, activeHandoverCap: 2, folderNesting: true, bulkActions: true, multiUpload: true, ai: true },
  freelance: { seatCap: 1, storageCapBytes: 100 * GB, activeHandoverCap: 5, folderNesting: false, bulkActions: false, multiUpload: false, ai: false },
  studio: { seatCap: null, storageCapBytes: 1024 * GB, activeHandoverCap: null, folderNesting: true, bulkActions: true, multiUpload: true, ai: true },
  enterprise: { seatCap: null, storageCapBytes: null, activeHandoverCap: null, folderNesting: true, bulkActions: true, multiUpload: true, ai: true },
};

/** The subset of a workspace's row this module needs — kept narrow and hand-shaped rather than importing db.ts's row type, to stay free of any database dependency. */
export interface WorkspaceBillingRow {
  planTier: PlanTier;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  planInterval: "month" | "year" | null;
  seats: number;
  storageAddonUnits: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface EffectiveTier {
  tier: PlanTier;
  blocked: boolean;
  limits: PlanLimits;
}

/**
 * The one function every gating check (and BillingGate) calls. Trial expiry
 * is computed live against `now` — no cron job marking workspaces expired,
 * so this is always correct even if the server was down when a trial ended.
 *
 * A canceled subscription is blocked outright, regardless of `planTier` —
 * `planTier` is deliberately left as a historical record by the webhook
 * handler rather than reset to 'trial' on cancellation, so there's no path
 * to re-earning a free trial by subscribing then canceling.
 *
 * A `past_due` subscription is NOT blocked (Stripe's Smart Retries get a
 * chance to recover the card first) — the caller shows a non-blocking
 * warning from `subscriptionStatus` instead.
 */
export function computeEffectiveTier(row: WorkspaceBillingRow, now: number = Date.now()): EffectiveTier {
  if (row.subscriptionStatus === "canceled") {
    return { tier: row.planTier, blocked: true, limits: PLAN_LIMITS[row.planTier] };
  }

  if (row.planTier === "trial") {
    const expired = row.trialEndsAt !== null && Date.parse(row.trialEndsAt) <= now;
    return { tier: "trial", blocked: expired, limits: PLAN_LIMITS.trial };
  }

  const base = PLAN_LIMITS[row.planTier];
  // Studio's storage add-on ($15/100GB) folds into the effective cap here —
  // the only place tier limits are anything other than the static table.
  const limits: PlanLimits =
    row.planTier === "studio" && base.storageCapBytes !== null && row.storageAddonUnits > 0
      ? { ...base, storageCapBytes: base.storageCapBytes + row.storageAddonUnits * 100 * GB }
      : base;
  return { tier: row.planTier, blocked: false, limits };
}

export function wouldExceedStorage(usedBytes: number, incomingBytes: number, capBytes: number | null): boolean {
  if (capBytes === null) return false;
  return usedBytes + incomingBytes > capBytes;
}

/** Only meaningful on the transition INTO an active status — re-saving an already-active handover, or a Draft staying Draft, never trips this. */
export function wouldExceedHandoverCap(activeCount: number, cap: number | null, isBecomingActive: boolean): boolean {
  if (!isBecomingActive || cap === null) return false;
  return activeCount + 1 > cap;
}

export function wouldExceedSeatCap(memberCount: number, pendingInviteCount: number, seatCap: number | null): boolean {
  if (seatCap === null) return false;
  return memberCount + pendingInviteCount >= seatCap;
}

/** Resolves a Stripe Price id to the tier/interval it represents. `priceMap` is built from env vars by billing.ts and passed in, keeping this file free of `process.env` access. */
export function tierForPriceId(
  priceId: string,
  priceMap: Record<string, { tier: PlanTier; interval: "month" | "year" }>
): { tier: PlanTier; interval: "month" | "year" } | null {
  return priceMap[priceId] ?? null;
}

/**
 * Hand-shaped mirror of the one Stripe.SubscriptionItem shape this module
 * cares about — deliberately not `Stripe.SubscriptionItem` itself, so this
 * file stays free of the Stripe SDK, per its own convention. billing.ts maps
 * the real SDK type down to this before calling anything below.
 */
export interface SubscriptionItemLike {
  id: string;
  priceId: string;
  quantity: number | null | undefined;
  currentPeriodEnd?: number | null;
}

/**
 * Finds the plan item (Freelance/Studio price) among ALL of a subscription's
 * items, not just the first one. Matters once a subscription can carry a
 * second (storage add-on) item: reading only items[0] would silently misread
 * tier/interval/seats depending on Stripe's own item ordering.
 */
export function resolvePlanFromItems(
  items: SubscriptionItemLike[],
  priceMap: Record<string, { tier: PlanTier; interval: "month" | "year" }>
): { tier: PlanTier; interval: "month" | "year"; seats: number; currentPeriodEnd: number | null } | null {
  for (const item of items) {
    const resolved = tierForPriceId(item.priceId, priceMap);
    if (resolved) return { ...resolved, seats: item.quantity ?? 1, currentPeriodEnd: item.currentPeriodEnd ?? null };
  }
  return null;
}

/** The purchased storage add-on quantity among a subscription's items — 0 if no such item exists (nothing bought yet) or the price isn't configured. */
export function storageAddonUnitsFromItems(items: SubscriptionItemLike[], storageAddonPriceId: string | null): number {
  if (!storageAddonPriceId) return 0;
  return items.find((i) => i.priceId === storageAddonPriceId)?.quantity ?? 0;
}

/**
 * The Stripe `items` array patch needed to make the add-on quantity exactly
 * `targetUnits` — add the item if it doesn't exist, update its quantity if it
 * does, remove it via `{deleted: true}` if the target is 0, or `null` if
 * nothing would actually change (so the caller can skip the Stripe API call
 * entirely on a no-op).
 */
export function buildStorageAddonItemsPatch(
  items: SubscriptionItemLike[],
  storageAddonPriceId: string,
  targetUnits: number
): Array<{ id?: string; price?: string; quantity?: number; deleted?: true }> | null {
  const existing = items.find((i) => i.priceId === storageAddonPriceId) ?? null;
  if (existing && (existing.quantity ?? 0) === targetUnits) return null;
  if (targetUnits === 0) return existing ? [{ id: existing.id, deleted: true }] : null;
  return existing ? [{ id: existing.id, quantity: targetUnits }] : [{ price: storageAddonPriceId, quantity: targetUnits }];
}

/** A storage add-on purchase must be a non-negative integer, capped well short of anything a fat-finger or abuse attempt could reach (50 units = +5TB). */
export function isValidStorageAddonUnits(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 50;
}
