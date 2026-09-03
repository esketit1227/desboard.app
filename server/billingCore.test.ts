/**
 * Billing entitlement tests — the guarantee that matters here is: a
 * workspace's effective access is computed correctly and deterministically
 * from its stored billing row, with no path to a free entitlement it hasn't
 * earned (an expired trial, a canceled subscription).
 */
import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  computeEffectiveTier,
  wouldExceedStorage,
  wouldExceedHandoverCap,
  wouldExceedSeatCap,
  tierForPriceId,
  resolvePlanFromItems,
  storageAddonUnitsFromItems,
  buildStorageAddonItemsPatch,
  isValidStorageAddonUnits,
  type WorkspaceBillingRow,
  type SubscriptionItemLike,
} from "./billingCore.ts";

const baseRow: WorkspaceBillingRow = {
  planTier: "trial",
  trialEndsAt: null,
  subscriptionStatus: null,
  planInterval: null,
  seats: 1,
  storageAddonUnits: 0,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

describe("computeEffectiveTier", () => {
  it("keeps a trial active right up to its expiry instant", () => {
    const now = Date.parse("2026-01-15T00:00:00.000Z");
    const row = { ...baseRow, trialEndsAt: new Date(now + 1).toISOString() };
    expect(computeEffectiveTier(row, now)).toEqual({ tier: "trial", blocked: false, limits: PLAN_LIMITS.trial });
  });

  it("blocks a trial exactly at its expiry instant", () => {
    const now = Date.parse("2026-01-15T00:00:00.000Z");
    const row = { ...baseRow, trialEndsAt: new Date(now).toISOString() };
    expect(computeEffectiveTier(row, now).blocked).toBe(true);
  });

  it("blocks a trial one millisecond after expiry", () => {
    const now = Date.parse("2026-01-15T00:00:00.000Z");
    const row = { ...baseRow, trialEndsAt: new Date(now - 1).toISOString() };
    expect(computeEffectiveTier(row, now).blocked).toBe(true);
  });

  it("never blocks a trial with no trialEndsAt set", () => {
    expect(computeEffectiveTier({ ...baseRow, trialEndsAt: null }, Date.now()).blocked).toBe(false);
  });

  it("an active paid subscription is never blocked, even past a trial-shaped date", () => {
    const row: WorkspaceBillingRow = {
      ...baseRow,
      planTier: "freelance",
      trialEndsAt: new Date(Date.now() - 1_000_000).toISOString(), // stale/irrelevant once on a real plan
      subscriptionStatus: "active",
    };
    const result = computeEffectiveTier(row);
    expect(result).toEqual({ tier: "freelance", blocked: false, limits: PLAN_LIMITS.freelance });
  });

  it("a past_due subscription stays fully entitled (non-blocking by design)", () => {
    const row: WorkspaceBillingRow = { ...baseRow, planTier: "studio", subscriptionStatus: "past_due" };
    expect(computeEffectiveTier(row).blocked).toBe(false);
  });

  it("a canceled subscription is blocked regardless of planTier — no re-earning a trial by canceling", () => {
    const row: WorkspaceBillingRow = { ...baseRow, planTier: "studio", subscriptionStatus: "canceled" };
    const result = computeEffectiveTier(row);
    expect(result.blocked).toBe(true);
    expect(result.tier).toBe("studio"); // kept as historical record, not reset to 'trial'
  });

  it("folds Studio's storage add-on units into the effective cap", () => {
    const row: WorkspaceBillingRow = { ...baseRow, planTier: "studio", subscriptionStatus: "active", storageAddonUnits: 2 };
    const result = computeEffectiveTier(row);
    expect(result.limits.storageCapBytes).toBe(PLAN_LIMITS.studio.storageCapBytes! + 2 * 100 * 1024 * 1024 * 1024);
  });

  it("does not apply add-on math to Freelance or Enterprise", () => {
    const freelance = computeEffectiveTier({ ...baseRow, planTier: "freelance", subscriptionStatus: "active", storageAddonUnits: 5 });
    expect(freelance.limits.storageCapBytes).toBe(PLAN_LIMITS.freelance.storageCapBytes);
    const enterprise = computeEffectiveTier({ ...baseRow, planTier: "enterprise", subscriptionStatus: "active", storageAddonUnits: 5 });
    expect(enterprise.limits.storageCapBytes).toBeNull();
  });
});

describe("wouldExceedStorage", () => {
  it("allows uploads under the cap", () => {
    expect(wouldExceedStorage(50, 10, 100)).toBe(false);
  });
  it("allows landing exactly on the cap", () => {
    expect(wouldExceedStorage(90, 10, 100)).toBe(false);
  });
  it("blocks uploads that would cross the cap", () => {
    expect(wouldExceedStorage(95, 10, 100)).toBe(true);
  });
  it("never blocks an uncapped (null) tier", () => {
    expect(wouldExceedStorage(10_000_000, 10_000_000, null)).toBe(false);
  });
});

describe("wouldExceedHandoverCap", () => {
  it("ignores writes that aren't becoming active", () => {
    expect(wouldExceedHandoverCap(5, 2, false)).toBe(false);
  });
  it("blocks the transition into active once at cap", () => {
    expect(wouldExceedHandoverCap(2, 2, true)).toBe(true);
  });
  it("allows the transition into active under cap", () => {
    expect(wouldExceedHandoverCap(1, 2, true)).toBe(false);
  });
  it("never blocks an uncapped (null) tier", () => {
    expect(wouldExceedHandoverCap(500, null, true)).toBe(false);
  });
});

describe("wouldExceedSeatCap", () => {
  it("blocks any invite for a 1-seat (Freelance) workspace", () => {
    expect(wouldExceedSeatCap(1, 0, 1)).toBe(true);
  });
  it("counts pending invites toward the cap, not just accepted members", () => {
    expect(wouldExceedSeatCap(2, 1, 3)).toBe(true);
  });
  it("allows an invite that stays within purchased seats", () => {
    expect(wouldExceedSeatCap(1, 1, 3)).toBe(false);
  });
  it("never blocks an uncapped (null) tier", () => {
    expect(wouldExceedSeatCap(500, 500, null)).toBe(false);
  });
});

describe("tierForPriceId", () => {
  const priceMap = { price_freelance_m: { tier: "freelance" as const, interval: "month" as const } };
  it("resolves a known price id", () => {
    expect(tierForPriceId("price_freelance_m", priceMap)).toEqual({ tier: "freelance", interval: "month" });
  });
  it("returns null for an unrecognized price id", () => {
    expect(tierForPriceId("price_unknown", priceMap)).toBeNull();
  });
});

const priceMap = { price_studio_m: { tier: "studio" as const, interval: "month" as const } };
const planItem: SubscriptionItemLike = { id: "si_plan", priceId: "price_studio_m", quantity: 3, currentPeriodEnd: 1_700_000_000 };
const addonItem: SubscriptionItemLike = { id: "si_addon", priceId: "price_addon", quantity: 2, currentPeriodEnd: 1_700_000_000 };

describe("resolvePlanFromItems", () => {
  it("resolves the plan item when it's the only item", () => {
    expect(resolvePlanFromItems([planItem], priceMap)).toEqual({
      tier: "studio",
      interval: "month",
      seats: 3,
      currentPeriodEnd: 1_700_000_000,
    });
  });

  it("resolves the plan item even when it isn't first — the items.data[0] regression case", () => {
    expect(resolvePlanFromItems([addonItem, planItem], priceMap)).toEqual({
      tier: "studio",
      interval: "month",
      seats: 3,
      currentPeriodEnd: 1_700_000_000,
    });
  });

  it("returns null when no item matches a known plan price", () => {
    expect(resolvePlanFromItems([addonItem], priceMap)).toBeNull();
  });

  it("returns null for an empty items array", () => {
    expect(resolvePlanFromItems([], priceMap)).toBeNull();
  });
});

describe("storageAddonUnitsFromItems", () => {
  it("returns the add-on item's quantity when present", () => {
    expect(storageAddonUnitsFromItems([planItem, addonItem], "price_addon")).toBe(2);
  });
  it("returns 0 when no add-on item exists", () => {
    expect(storageAddonUnitsFromItems([planItem], "price_addon")).toBe(0);
  });
  it("returns 0 when the add-on price isn't configured, regardless of items", () => {
    expect(storageAddonUnitsFromItems([planItem, addonItem], null)).toBe(0);
  });
});

describe("buildStorageAddonItemsPatch", () => {
  it("adds a new item when none exists and the target is above zero", () => {
    expect(buildStorageAddonItemsPatch([planItem], "price_addon", 3)).toEqual([{ price: "price_addon", quantity: 3 }]);
  });
  it("updates quantity when an item exists and the target differs", () => {
    expect(buildStorageAddonItemsPatch([planItem, addonItem], "price_addon", 5)).toEqual([{ id: "si_addon", quantity: 5 }]);
  });
  it("is a no-op when an item exists and already matches the target", () => {
    expect(buildStorageAddonItemsPatch([planItem, addonItem], "price_addon", 2)).toBeNull();
  });
  it("removes the item when the target is 0", () => {
    expect(buildStorageAddonItemsPatch([planItem, addonItem], "price_addon", 0)).toEqual([{ id: "si_addon", deleted: true }]);
  });
  it("is a no-op when no item exists and the target is 0", () => {
    expect(buildStorageAddonItemsPatch([planItem], "price_addon", 0)).toBeNull();
  });
});

describe("isValidStorageAddonUnits", () => {
  it("accepts 0 — removing the add-on is a valid target", () => {
    expect(isValidStorageAddonUnits(0)).toBe(true);
  });
  it("accepts the upper boundary", () => {
    expect(isValidStorageAddonUnits(50)).toBe(true);
  });
  it("rejects just past the upper boundary", () => {
    expect(isValidStorageAddonUnits(51)).toBe(false);
  });
  it("rejects a negative count", () => {
    expect(isValidStorageAddonUnits(-1)).toBe(false);
  });
  it("rejects a non-integer", () => {
    expect(isValidStorageAddonUnits(1.5)).toBe(false);
  });
  it("rejects a non-number", () => {
    expect(isValidStorageAddonUnits("3")).toBe(false);
  });
});
