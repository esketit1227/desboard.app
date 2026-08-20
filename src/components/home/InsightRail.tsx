import type { DashboardInsight } from "../../types";

function actionLabel(kind: DashboardInsight["action"]["kind"]): string {
  switch (kind) {
    case "open":
      return "Open";
    case "copy_link":
      return "Copy portal link";
    case "extend_expiry":
      return "Extend +7 days";
    case "reconnect":
      return "Reconnect";
  }
}

/**
 * Up to 3 real, actionable lines the home screen surfaces alongside the
 * command box — hidden entirely when there's nothing to say, per the "no
 * smiling empty state" rule.
 */
export function InsightRail({
  insights,
  onAction,
}: {
  insights: DashboardInsight[];
  onAction: (insight: DashboardInsight) => void;
}) {
  if (insights.length === 0) return null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <h2 style={{ fontFamily: "var(--font-serif)" }} className="italic text-[17px] text-ink mb-4">
        Worth a look
      </h2>
      <div className="flex flex-col gap-4">
        {insights.map((insight, i) => (
          <div key={i} className={i > 0 ? "pt-4 border-t border-line" : ""}>
            <p className="text-[13px] leading-snug text-ink/85">
              {insight.lead ? `${insight.lead} ` : ""}
              <span className="font-medium text-ink">{insight.entityLabel}</span>
              {insight.trail}
            </p>
            <button
              type="button"
              onClick={() => onAction(insight)}
              className="mt-1.5 text-[12px] font-medium text-primary hover:underline"
            >
              {actionLabel(insight.action.kind)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
