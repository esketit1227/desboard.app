/**
 * The one pricing-tier picker, rendered in four places (landing teaser,
 * /pricing, BillingGate's blocked screen, Settings' trial upgrade CTA) so
 * copy and numbers can't drift into four slightly-different versions.
 *
 * `variant="marketing"` is for anonymous visitors — every CTA is a plain
 * link to "/" (sign up first, per the confirmed flow), never a checkout
 * call. `variant="checkout"` is for a signed-in owner picking a first paid
 * plan — this is only ever safe to show to a workspace with no active
 * subscription yet (still on trial, or blocked after one expired): a
 * workspace that already has one active subscription must change it through
 * the Billing Portal (see Settings), never through a second fresh Checkout
 * Session, or it would end up double-subscribed.
 */
import { useState } from "react";
import { api } from "../lib/api";
import { Toast } from "./Toast";
import { Check } from "lucide-react";

const SALES_EMAIL = "sales@desboard.studio";

type Interval = "month" | "year";

interface Tier {
  key: "freelance" | "studio";
  name: string;
  blurb: string;
  monthly: number;
  annualMonthly: number;
  priceCaption: string;
  features: string[];
  seatsForCheckout: number;
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
    seatsForCheckout: 1,
    features: [
      "1 seat",
      "100GB storage",
      "5 active handovers",
      "Image & video proofing",
      "Basic portal branding (logo + accent color)",
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
    seatsForCheckout: 3,
    highlight: true,
    features: [
      "3-seat minimum, no seat cap",
      "1TB pooled storage (+$15/100GB add-on)",
      "Unlimited handovers",
      "Everything in Freelance, plus:",
      "Folder nesting & bulk file actions",
      "AI tagging & semantic search",
      "White-label portal (custom domain)",
      "Full team roles & permissions",
      "Priority email + chat support",
    ],
  },
];

const ENTERPRISE_FEATURES = [
  "Unlimited seats, storage, and handovers",
  "Everything in Studio, plus:",
  "Audit logs",
  "SSO / SAML",
  "Dedicated CSM & SLA",
];

function formatPrice(n: number) {
  return `$${n}`;
}

export function PricingCards({
  variant,
  currentTier,
}: {
  variant: "marketing" | "checkout";
  /** Only meaningful for variant="checkout" — badges/disables that tier's own card. */
  currentTier?: "trial" | "freelance" | "studio" | "enterprise";
}) {
  const [interval, setInterval] = useState<Interval>("month");
  const [loadingTier, setLoadingTier] = useState<Tier["key"] | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const startCheckout = async (tier: Tier) => {
    setLoadingTier(tier.key);
    try {
      const { url } = await api.createCheckoutSession({
        tier: tier.key,
        interval,
        seats: tier.seatsForCheckout,
      });
      window.location.href = url;
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : "Could not start checkout");
      setLoadingTier(null);
    }
  };

  return (
    <div className="w-full">
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center bg-chip rounded-full p-1 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setInterval("month")}
            className={`px-4 py-1.5 rounded-full transition-colors ${
              interval === "month" ? "bg-primary text-white" : "text-muted hover:text-ink"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("year")}
            className={`px-4 py-1.5 rounded-full transition-colors ${
              interval === "year" ? "bg-primary text-white" : "text-muted hover:text-ink"
            }`}
          >
            Annual <span className={interval === "year" ? "text-white/70" : "text-muted"}>· 2 months free</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch max-w-5xl mx-auto">
        {TIERS.map((tier) => {
          const price = interval === "month" ? tier.monthly : tier.annualMonthly;
          const isCurrent = variant === "checkout" && currentTier === tier.key;
          return (
            <div
              key={tier.key}
              className={`relative rounded-2xl p-6 flex flex-col bg-panel border ${
                tier.highlight ? "border-ink shadow-lg" : "border-line"
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-6 bg-ink text-paper text-[11px] font-medium px-2.5 py-1 rounded-full">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-ink tracking-tight">{tier.name}</h3>
              <p className="text-[13px] text-muted mt-1 mb-5 min-h-[34px]">{tier.blurb}</p>

              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-ink tracking-tight">{formatPrice(price)}</span>
                <span className="text-[13px] text-muted">/mo</span>
              </div>
              <p className="text-[12px] text-muted mb-5">
                {tier.priceCaption}
                {interval === "year" && " · billed annually"}
              </p>

              <ul className="flex flex-col gap-2.5 mb-6 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-ink">
                    <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {variant === "marketing" ? (
                <a
                  href="/"
                  className={`text-center text-sm font-medium rounded-full px-4 py-2.5 transition-colors ${
                    tier.highlight
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "bg-chip text-ink hover:bg-line"
                  }`}
                >
                  Start free trial
                </a>
              ) : isCurrent ? (
                <div className="text-center text-sm font-medium rounded-full px-4 py-2.5 bg-chip text-muted">
                  Current plan
                </div>
              ) : (
                <button
                  type="button"
                  disabled={loadingTier !== null}
                  onClick={() => startCheckout(tier)}
                  className={`text-center text-sm font-medium rounded-full px-4 py-2.5 transition-colors disabled:opacity-60 ${
                    tier.highlight
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "bg-chip text-ink hover:bg-line"
                  }`}
                >
                  {loadingTier === tier.key ? "Redirecting…" : `Choose ${tier.name}`}
                </button>
              )}
            </div>
          );
        })}

        <div className="relative rounded-2xl p-6 flex flex-col bg-panel border border-line">
          <h3 className="text-lg font-semibold text-ink tracking-tight">Enterprise</h3>
          <p className="text-[13px] text-muted mt-1 mb-5 min-h-[34px]">
            For agencies with compliance, security, or scale needs.
          </p>

          <div className="mb-1 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-ink tracking-tight">Custom</span>
          </div>
          <p className="text-[12px] text-muted mb-5">Talk to sales for pricing</p>

          <ul className="flex flex-col gap-2.5 mb-6 flex-1">
            {ENTERPRISE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px] text-ink">
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <a
            href={`mailto:${SALES_EMAIL}`}
            className="text-center text-sm font-medium rounded-full px-4 py-2.5 bg-chip text-ink hover:bg-line transition-colors"
          >
            Contact sales
          </a>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
