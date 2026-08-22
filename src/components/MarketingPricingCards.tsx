/**
 * Pricing cards for the marketing site only (landing teaser + /pricing) —
 * styled to the editorial design system. Deliberately separate from
 * PricingCards.tsx, which renders inside the authenticated app (BillingGate,
 * Settings) using the dashboard's own token set — merging them would mean
 * either dragging editorial styling into the dashboard or vice versa.
 * Anonymous-only, so every CTA is a plain link to the signup form (checkout
 * needs a session) rather than a checkout call.
 */
import { useState } from "react";
import { Check } from "lucide-react";

type Interval = "month" | "year";

interface Tier {
  key: "freelance" | "studio";
  name: string;
  blurb: string;
  monthly: number;
  annualMonthly: number;
  priceCaption: string;
  features: string[];
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    key: "freelance",
    name: "Freelance",
    blurb: "For solo studios running client work end to end.",
    monthly: 24,
    annualMonthly: 19,
    priceCaption: "1 seat",
    features: [
      "1 seat",
      "100GB storage",
      "5 active handovers",
      "Image & video proofing",
      "Basic portal branding",
      "Email support",
    ],
  },
  {
    key: "studio",
    name: "Studio",
    blurb: "For teams managing many clients and a growing crew.",
    monthly: 49,
    annualMonthly: 39,
    priceCaption: "per seat, 3-seat minimum",
    highlight: true,
    features: [
      "3-seat minimum, no seat cap",
      "1TB pooled storage",
      "Unlimited handovers",
      "Folder nesting & bulk actions",
      "AI tagging & semantic search",
      "White-label portal, full RBAC",
    ],
  },
];

function formatPrice(n: number) {
  return `$${n}`;
}

export function MarketingPricingCards() {
  const [interval, setInterval] = useState<Interval>("month");

  return (
    <div className="w-full">
      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center gap-1 rounded-full border border-[var(--ed-hairline)] p-1 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setInterval("month")}
            className={`px-4 py-1.5 rounded-full tracking-[-0.01em] transition-colors duration-200 ${
              interval === "month" ? "bg-[var(--ed-ink)] text-white" : "text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)]"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("year")}
            className={`px-4 py-1.5 rounded-full tracking-[-0.01em] transition-colors duration-200 ${
              interval === "year" ? "bg-[var(--ed-ink)] text-white" : "text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)]"
            }`}
          >
            Annual <span className="opacity-70">· 2 months free</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
        {TIERS.map((tier) => {
          const price = interval === "month" ? tier.monthly : tier.annualMonthly;
          return (
            <div
              key={tier.key}
              className={`rounded-[20px] p-8 flex flex-col bg-[var(--ed-bg-alt)] ${
                tier.highlight ? "ring-1 ring-[var(--ed-ink)]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[20px] font-medium tracking-[-0.01em] text-[var(--ed-ink)]">{tier.name}</h3>
                {tier.highlight && (
                  <span className="text-[11px] font-medium tracking-[0.02em] uppercase text-[var(--ed-ink-secondary)]">
                    Popular
                  </span>
                )}
              </div>
              <p className="text-[14px] text-[var(--ed-ink-secondary)] mb-6">{tier.blurb}</p>

              <div className="mb-1 flex items-baseline gap-1.5">
                <span className="text-[40px] font-medium tracking-[-0.03em] text-[var(--ed-ink)]">
                  {formatPrice(price)}
                </span>
                <span className="text-[14px] text-[var(--ed-ink-secondary)]">/mo</span>
              </div>
              <p className="text-[12.5px] text-[var(--ed-ink-tertiary)] mb-7">
                {tier.priceCaption}
                {interval === "year" && " · billed annually"}
              </p>

              <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[14px] text-[var(--ed-ink)]">
                    <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--ed-ink-tertiary)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/signin?mode=signup"
                className={`text-center text-[14px] font-medium rounded-full px-5 py-3 transition-colors duration-150 ${
                  tier.highlight
                    ? "bg-[var(--ed-ink)] text-white hover:bg-[#262626]"
                    : "bg-transparent text-[var(--ed-ink)] border border-[var(--ed-hairline)] hover:bg-white"
                }`}
              >
                Start free trial
              </a>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[13px] text-[var(--ed-ink-tertiary)] mt-8">
        Need audit logs, SSO, or a dedicated CSM?{" "}
        <a href="mailto:sales@desboard.studio" className="text-[var(--ed-ink)] underline underline-offset-4">
          Talk to sales
        </a>{" "}
        about Enterprise.
      </p>
    </div>
  );
}
