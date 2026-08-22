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
