/**
 * Sits between AuthGate and Dashboard, same loading/blocked/ok shape as
 * AuthGate itself. Dashboard fires many api.* calls on mount — letting it
 * mount before billing status is known would mean every one of those
 * independently hits the same 402, so this checks once, here, first.
 *
 * Checked live on every mount rather than trusted from AuthUser: billing
 * state can flip via a Stripe webhook at any moment, independent of the
 * session cookie.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import type { BillingStatus } from "../../types";
import { useAuth } from "./AuthContext";
import { PricingCards } from "../PricingCards";

type Status = "loading" | "blocked" | "ok";

export function BillingGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<Status>("loading");
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getBillingStatus()
      .then((b) => {
        if (cancelled) return;
        setBilling(b);
        setStatus(b.blocked ? "blocked" : "ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("ok"); // fail open — a transient network error shouldn't lock a workspace out
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return <div className="w-screen h-screen bg-paper" />;
  }

  if (status === "ok") {
    return <>{children}</>;
  }

  const trialExpired = billing?.tier === "trial";
  const heading = trialExpired ? "Your trial has ended" : "Your subscription was canceled";
  const sub = trialExpired
    ? "Your 14-day trial wrapped up. Choose a plan to keep your projects, files, and client handovers active."
    : "Your workspace is on hold. Choose a plan to pick up right where you left off — nothing was deleted.";

  return (
    <div className="w-screen h-screen bg-paper overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-14">
        <div className="flex items-center justify-between mb-12">
          <span style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-ink">
            desboard
          </span>
          <button
            type="button"
            onClick={() => logout()}
            className="text-[13px] text-muted hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </div>

        {user.role === "owner" ? (
          <>
            <div className="text-center mb-10">
              <h1 className="text-3xl font-bold text-ink tracking-tight mb-2">{heading}</h1>
              <p className="text-[15px] text-muted max-w-md mx-auto">{sub}</p>
            </div>
            <PricingCards variant="checkout" currentTier={billing?.tier} />
          </>
        ) : (
          <div className="text-center max-w-sm mx-auto py-16">
            <h1 className="text-2xl font-bold text-ink tracking-tight mb-2">{heading}</h1>
            <p className="text-[15px] text-muted">
              Ask your workspace owner to choose a plan to keep {user.workspaceName} active. You'll get access again
              as soon as they do.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
