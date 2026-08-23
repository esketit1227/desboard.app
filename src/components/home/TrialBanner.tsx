import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { api } from "../../lib/api";

/**
 * A quiet, persistent reminder of how long the trial has left — without it,
 * the countdown only exists inside Settings -> Billing & plan, which nobody
 * opens speculatively. Renders nothing once the workspace is on a paid plan
 * (or if billing status hasn't loaded yet), so it only ever shows during an
 * active trial.
 */
export function TrialBanner({ onOpenBilling }: { onOpenBilling: () => void }) {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    api
      .getBillingStatus()
      .then((b) => {
        if (b.blocked || b.tier !== "trial" || !b.trialEndsAt) return;
        const days = Math.max(0, Math.ceil((Date.parse(b.trialEndsAt) - Date.now()) / 86400000));
        setDaysLeft(days);
      })
      .catch(() => {});
  }, []);

  if (daysLeft === null) return null;

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-panel pl-4 pr-2 py-3">
      <Clock className="w-4 h-4 text-ink shrink-0" />
      <button
        type="button"
        onClick={onOpenBilling}
        className="flex-1 min-w-0 text-left text-[13px] text-ink/85 hover:text-ink transition-colors"
      >
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left in your trial — <span className="font-medium text-ink">choose a plan</span>
      </button>
    </div>
  );
}
