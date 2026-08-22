/**
 * Public, stateless /pricing page — full tier comparison + FAQ. No auth
 * required and no data fetched; App.tsx routes here via a plain pathname
 * check (this app has no router — see App.tsx's own comment on why).
 * Shares the editorial design system with the landing page (src/index.css's
 * .editorial tokens) so the two feel like one marketing site.
 */
import { Fragment } from "react";
import { MotionConfig, motion } from "motion/react";
import { Check, Minus } from "lucide-react";
import { MarketingPricingCards } from "../components/MarketingPricingCards";
import { EditorialNav, EditorialFAQ, EditorialFooter } from "../components/auth/LandingSections";

type CellValue = string | boolean;

const ROWS: {
  group: string;
  items: { label: string; trial: CellValue; freelance: CellValue; studio: CellValue; enterprise: CellValue }[];
}[] = [
  {
    group: "Core",
    items: [
      { label: "Seats", trial: "Up to 3", freelance: "1", studio: "3 minimum, no cap", enterprise: "Unlimited" },
      { label: "Storage", trial: "5GB", freelance: "100GB", studio: "1TB pooled (+$15/100GB)", enterprise: "Unlimited" },
      { label: "Active handovers", trial: "2", freelance: "5", studio: "Unlimited", enterprise: "Unlimited" },
    ],
  },
  {
    group: "Files",
    items: [
      { label: "Image & video proofing", trial: true, freelance: true, studio: true, enterprise: true },
      { label: "Folder nesting", trial: true, freelance: false, studio: true, enterprise: true },
      { label: "Bulk actions & multi-upload", trial: true, freelance: false, studio: true, enterprise: true },
      { label: "AI tagging & search", trial: true, freelance: false, studio: true, enterprise: true },
    ],
  },
  {
    group: "Client portal",
    items: [
      { label: "Basic branding (logo + accent)", trial: true, freelance: true, studio: true, enterprise: true },
      { label: "White-label (custom domain)", trial: false, freelance: false, studio: true, enterprise: true },
    ],
  },
  {
    group: "Team",
    items: [
      { label: "Team roles & permissions", trial: true, freelance: false, studio: true, enterprise: true },
      { label: "SSO / SAML", trial: false, freelance: false, studio: false, enterprise: true },
      { label: "Audit logs", trial: false, freelance: false, studio: false, enterprise: true },
    ],
  },
  {
    group: "Support",
    items: [
      { label: "Support", trial: "Email", freelance: "Email", studio: "Priority email + chat", enterprise: "Dedicated CSM & SLA" },
    ],
  },
];

function Cell({ value }: { value: CellValue }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="w-4 h-4 text-[var(--ed-ink)] mx-auto" />
    ) : (
      <Minus className="w-4 h-4 text-[var(--ed-hairline)] mx-auto" />
    );
  }
  return <span className="text-[13.5px] text-[var(--ed-ink)]">{value}</span>;
}

export default function PricingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div id="editorial-scroll" className="editorial w-screen h-screen overflow-y-auto">
        <EditorialNav />

        <div className="max-w-[900px] mx-auto px-6 sm:px-10 pt-16 sm:pt-20 pb-16 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="text-[clamp(36px,5vw,64px)] font-medium leading-[1.02] tracking-[-0.035em] text-[var(--ed-ink)] text-balance"
          >
            Pricing that scales with your studio
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.4, 0, 0.2, 1] }}
            className="text-[17px] text-[var(--ed-ink-secondary)] max-w-[46ch] mx-auto mt-5"
          >
            Every workspace starts with a 14-day trial of the full Studio feature set — no card required.
          </motion.p>
        </div>

        <div className="px-6 sm:px-10 pb-24 sm:pb-32">
          <MarketingPricingCards />
        </div>

        <div className="border-t border-[var(--ed-hairline)]">
          <div className="max-w-[1000px] mx-auto px-6 sm:px-10 py-24 sm:py-32">
            <h2 className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase mb-8 text-center">
              Compare plans in full
            </h2>
            <div className="overflow-x-auto rounded-[20px] border border-[var(--ed-hairline)]">
              <table className="w-full border-collapse min-w-[640px]">
                <thead>
                  <tr className="bg-[var(--ed-bg-alt)]">
                    <th className="text-left text-[12.5px] font-medium text-[var(--ed-ink-tertiary)] px-5 py-4 sticky left-0 bg-[var(--ed-bg-alt)]">
                      &nbsp;
                    </th>
                    <th className="text-center text-[13px] font-medium text-[var(--ed-ink)] px-5 py-4 tracking-[-0.01em]">Trial</th>
                    <th className="text-center text-[13px] font-medium text-[var(--ed-ink)] px-5 py-4 tracking-[-0.01em]">Freelance</th>
                    <th className="text-center text-[13px] font-medium text-[var(--ed-ink)] px-5 py-4 tracking-[-0.01em]">Studio</th>
                    <th className="text-center text-[13px] font-medium text-[var(--ed-ink)] px-5 py-4 tracking-[-0.01em]">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((group) => (
                    <Fragment key={group.group}>
                      <tr className="bg-[var(--ed-bg-alt)]/50">
                        <td
                          colSpan={5}
                          className="text-left text-[11px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase px-5 py-2.5"
                        >
                          {group.group}
                        </td>
                      </tr>
                      {group.items.map((row) => (
                        <tr key={row.label} className="border-t border-[var(--ed-hairline)]">
                          <td className="text-left text-[13.5px] text-[var(--ed-ink)] px-5 py-3.5 sticky left-0 bg-[var(--ed-bg)]">
                            {row.label}
                          </td>
                          <td className="text-center px-5 py-3.5">
                            <Cell value={row.trial} />
                          </td>
                          <td className="text-center px-5 py-3.5">
                            <Cell value={row.freelance} />
                          </td>
                          <td className="text-center px-5 py-3.5">
                            <Cell value={row.studio} />
                          </td>
                          <td className="text-center px-5 py-3.5">
                            <Cell value={row.enterprise} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <EditorialFAQ />
        <EditorialFooter />
      </div>
    </MotionConfig>
  );
}
