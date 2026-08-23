/**
 * Marketing chrome for the "/" landing page — nav, hero, integration
 * marquee, product blocks, principle quote, update spotlight, feature
 * carousel, footer. Sign in/sign up lives on its own route now (see
 * SignInPage.tsx) — every CTA here just links to /signin. Design system:
 * see the `.editorial` tokens in src/index.css — near-monochrome, huge
 * tight-tracked type, hairline dividers, real product screenshots
 * (public/marketing/*.png, captured from a live workspace) doing the visual
 * work. No fabricated customer logos or testimonials — every screenshot and
 * every feature claim below is real.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { MarketingPricingCards } from "../MarketingPricingCards";

const EASE = [0.4, 0, 0.2, 1] as const;

function Reveal({
  children,
  delay = 0,
  className,
  y = 20,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-[var(--ed-ink)] tracking-[-0.01em]"
    >
      {children}
      <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
    </a>
  );
}

/* ==========================================================================
   Nav
   ========================================================================== */

export function EditorialNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      setScrolled(el.scrollTop > 8);
    };
    const scroller = document.getElementById("editorial-scroll");
    scroller?.addEventListener("scroll", onScroll);
    return () => scroller?.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToId = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? "bg-[var(--ed-bg)]/85 backdrop-blur-md border-b border-[var(--ed-hairline)]" : "bg-transparent"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 h-[68px] flex items-center justify-between">
        <a href="/" style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-[var(--ed-ink)]">
          desboard
        </a>
        <div className="hidden sm:flex items-center gap-8">
          <a
            href="#platform"
            onClick={scrollToId("platform")}
            className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors tracking-[-0.005em]"
          >
            Platform
          </a>
          <a href="/pricing" className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors tracking-[-0.005em]">
            Pricing
          </a>
          <a
            href="#faq"
            onClick={scrollToId("faq")}
            className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors tracking-[-0.005em]"
          >
            FAQ
          </a>
        </div>
        <a
          href="/signin"
          className="text-[13.5px] font-medium bg-[var(--ed-ink)] text-white rounded-full px-5 py-2.5 hover:bg-[#262626] transition-colors duration-150"
        >
          Sign in
        </a>
      </div>
    </nav>
  );
}

/* ==========================================================================
   Hero
   ========================================================================== */

/**
 * The hero's right-side visual — a looping concept demo (public/marketing/
 * hero-demo.mp4) that cycles through short, on-theme statements ("Client-
 * ready.", "Approve. Or don't.", "No login. Send the work, not the
 * instructions.") over a plain white background. Since its background
 * already matches the page, it needs no masking or frame — it just sits
 * directly on the page, the way Apple product pages let copy/motion float
 * with no visible boundary. The gentle continuous drift is skipped under
 * prefers-reduced-motion; a still frame remains either way.
 */
function HeroGraphic() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative w-full flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, delay: 0.15, ease: EASE }}
        className="w-full max-w-[640px]"
      >
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, -12, 0] }}
          transition={reduceMotion ? undefined : { duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <video
            src="/marketing/hero-demo.mp4"
            autoPlay={!reduceMotion}
            loop
            muted
            playsInline
            preload="metadata"
            className="w-full h-auto aspect-video object-contain"
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

export function EditorialHero() {
  return (
    <div className="max-w-[1440px] mx-auto w-full px-6 sm:px-10 pt-10 sm:pt-16 pb-24 sm:pb-32 grid grid-cols-1 lg:grid-cols-12 gap-y-14 gap-x-10 items-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="lg:col-span-7"
      >
        <h1 className="text-[clamp(40px,6.4vw,84px)] font-medium leading-[0.98] tracking-[-0.035em] text-[var(--ed-ink)] text-balance">
          From kickoff to handoff.
        </h1>
        <p className="text-[18px] sm:text-[20px] leading-[1.5] tracking-[-0.005em] text-[var(--ed-ink-secondary)] mt-7 max-w-[46ch]">
          Projects, files, and approvals in one place — handed off through a portal your clients actually enjoy
          opening.
        </p>
        <div className="flex items-center gap-6 flex-wrap mt-9">
          <a
            href="/signin?mode=signup"
            className="text-[14.5px] font-medium bg-[var(--ed-ink)] text-white rounded-full px-6 py-3 hover:bg-[#262626] transition-colors duration-150"
          >
            Start free trial
          </a>
          <a
            href="/signin"
            className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors"
          >
            Already have an account? Sign in
          </a>
        </div>
      </motion.div>
      <div className="lg:col-span-5">
        <HeroGraphic />
      </div>
    </div>
  );
}

/* ==========================================================================
   Integration marquee — real connections (Drive/Dropbox/OneDrive import,
   Google/Microsoft/Apple sign-in), rendered as flat wordmarks rather than
   trademark-color logos, in keeping with the monochrome shell. Not "trusted
   by" social proof — this product has no public customer list to show, and
   inventing one would be exactly the kind of dishonest UI this app avoids
   everywhere else.
   ========================================================================== */

const INTEGRATIONS = [
  "Google Drive",
  "Dropbox",
  "OneDrive",
  "Google",
  "Microsoft",
  "Apple",
  "Resend",
  "Stripe",
];

export function IntegrationMarquee() {
  const row = [...INTEGRATIONS, ...INTEGRATIONS];
  return (
    <div className="border-y border-[var(--ed-hairline)] py-8 overflow-hidden">
      <p className="text-center text-[13px] text-[var(--ed-ink-tertiary)] tracking-[0.02em] mb-7">
        Connects with the tools already in your stack
      </p>
      <div className="flex overflow-hidden">
        <div className="flex shrink-0 gap-16 pr-16 editorial-marquee-track">
          {row.map((name, i) => (
            <span
              key={i}
              className="shrink-0 text-[22px] font-medium tracking-[-0.02em] text-[var(--ed-ink)] opacity-80"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Key features — a six-up overview grid. Retokenized from a design-review
   mockup onto this page's own editorial system (Instrument Sans via
   --font-editorial, --ed-* colors) rather than the mockup's own Inter/
   Newsreader — everything here inherits type from the .editorial wrapper,
   same as every other section in this file. The two spots that referenced
   stand-in photography in the mockup are left as plain neutral placeholders
   here rather than faked screenshots, matching this page's no-fabrication
   rule; every other visual is real CSS/markup, not an image.
   ========================================================================== */

function DriveMark() {
  return (
    <svg width="24" height="21" viewBox="0 0 87.3 78" role="img" aria-label="Google Drive">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47" />
      <path
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.3c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"
        fill="#ea4335"
      />
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53.8H27.5L13.75 77.6c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path
        d="M73.4 26.5 60.75 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28.8h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

function DropboxMark() {
  return (
    <svg width="24" height="22" viewBox="0 0 43 40" role="img" aria-label="Dropbox">
      <path
        fill="#0061ff"
        d="M10.75 0 0 6.85l10.75 6.85L21.5 6.85zm21.5 0L21.5 6.85l10.75 6.85L43 6.85zM0 20.55l10.75 6.85L21.5 20.55 10.75 13.7zm32.25-6.85L21.5 20.55l10.75 6.85L43 20.55zM10.75 29.7l10.75 6.85L32.25 29.7 21.5 22.85z"
      />
    </svg>
  );
}

function OneDriveMark() {
  return (
    <svg width="28" height="18" viewBox="0 0 48 30" role="img" aria-label="OneDrive">
      <path fill="#0364b8" d="m28.9 18.4 10.6-10.1a15.7 15.7 0 0 0-26.7-2.1 11 11 0 0 1 8.7 3.4z" />
      <path fill="#0078d4" d="M20.5 9.8a10.6 10.6 0 0 0-5.6-1.6h-.4A10.7 10.7 0 0 0 5 24.4l14.9-6.3 6.6-2.8 3-1.2z" />
      <path
        fill="#1490df"
        d="M13.2 6.2h.5c.6 0 1.2.1 1.8.2l4.9 2.5a10.7 10.7 0 0 1 8.5 9.5l9.4-2 .8-.2a9.7 9.7 0 0 0-.8-7.7z"
      />
      <path
        fill="#28a8ea"
        d="M28.9 18.4h-.5c-.7 0-1.4.1-2.1.3l-4.5-4.3-16.6 6a10.7 10.7 0 0 0 9.6 9h23a8 8 0 0 0 0-15.9z"
      />
    </svg>
  );
}

function FeatureCell({ children }: { children: ReactNode }) {
  return <div className="border-r border-b border-[var(--ed-hairline)] p-7 sm:p-8 flex flex-col gap-7">{children}</div>;
}

function FeatureCopy({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[var(--ed-ink)]">{title}</h3>
      <p className="text-[13.5px] leading-[1.6] text-[var(--ed-ink-secondary)]">{body}</p>
    </div>
  );
}

export function KeyFeatures() {
  return (
    <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-40">
      <Reveal className="flex flex-col gap-10 mb-14 sm:mb-16">
        <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
          Key features
        </span>
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-x-16 gap-y-6 items-start">
          <h2 className="text-[clamp(32px,4.6vw,56px)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--ed-ink)] text-balance">
            Everything you&#8217;ve ever made, finally findable.
          </h2>
          <p className="text-[17px] leading-[1.6] text-[var(--ed-ink-secondary)] mt-1">
            Desboard sits on top of the storage your studio already pays for &mdash; and turns it into a searchable
            archive, a review room and a client-facing delivery surface.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="border-t border-l border-[var(--ed-hairline)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCell>
            <div className="h-[236px] flex flex-col items-center justify-center gap-0">
              <div className="flex items-center gap-5">
                {[
                  { label: "Drive", Mark: DriveMark },
                  { label: "Dropbox", Mark: DropboxMark },
                  { label: "OneDrive", Mark: OneDriveMark },
                ].map(({ label, Mark }) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-[14px] bg-[var(--ed-bg)] border border-[var(--ed-hairline)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex items-center justify-center">
                      <Mark />
                    </div>
                    <span className="text-[11.5px] text-[var(--ed-ink-tertiary)]">{label}</span>
                  </div>
                ))}
              </div>
              <div className="w-px h-[26px] border-l border-dashed border-[var(--ed-hairline)]" />
              <div className="w-[180px] border-t border-dashed border-[var(--ed-hairline)]" />
              <div className="w-px h-[26px] border-l border-dashed border-[var(--ed-hairline)]" />
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 flex flex-col items-center gap-1">
                <span className="text-[11.5px] text-[var(--ed-ink-tertiary)]">Setup time</span>
                <span className="text-[13.5px] font-medium text-[var(--ed-ink)]">3 clouds linked &middot; 90 seconds</span>
              </div>
            </div>
            <FeatureCopy
              title="Link what you already use"
              body="Google Drive, Dropbox and OneDrive in about ninety seconds. Files stay in your own accounts — Desboard stores references, not duplicates."
            />
          </FeatureCell>

          <FeatureCell>
            <div className="h-[236px] flex flex-col justify-center gap-3.5">
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 text-[13.5px] text-[var(--ed-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                the moody kitchen shots from the Fazer job
              </div>
              <div className="flex justify-center">
                <div className="w-px h-[18px] border-l border-dashed border-[var(--ed-hairline)]" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="aspect-[4/3] rounded-[10px] bg-[var(--ed-bg-alt)]" />
                <div className="aspect-[4/3] rounded-[10px] bg-[var(--ed-bg-alt)]" />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {["AI tags", "OCR", "Duplicates", "Visual match"].map((t) => (
                  <span
                    key={t}
                    className="bg-[var(--ed-bg-alt)] rounded-full px-2.5 py-1 text-[11.5px] text-[var(--ed-ink-secondary)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <FeatureCopy
              title="Find anything you&#8217;ve ever made"
              body="Search every connected cloud from one place — including the years of work that never passed through a review tool. Ask for it the way you remember it."
            />
          </FeatureCell>

          <FeatureCell>
            <div className="h-[236px] flex flex-col justify-center">
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-[13.5px] text-[var(--ed-ink-tertiary)]">Source &middot; v1</span>
                <span className="w-[7px] h-[7px] rounded-full bg-[var(--ed-ink-tertiary)]" />
              </div>
              <div className="h-4 ml-6 border-l border-dashed border-[var(--ed-hairline)]" />
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-[13.5px] text-[var(--ed-ink-tertiary)]">Revision &middot; v2</span>
                <span className="w-[7px] h-[7px] rounded-full bg-[var(--ed-ink-secondary)]" />
              </div>
              <div className="h-4 ml-6 border-l border-dashed border-[var(--ed-hairline)]" />
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <span className="text-[13.5px] font-medium text-[var(--ed-ink)]">Export the client received</span>
                <span className="bg-[var(--ed-ink)] text-white rounded-full px-2.5 py-1 text-[11px] font-medium">
                  Final
                </span>
              </div>
              <div className="mt-3.5 text-[12px] text-[var(--ed-ink-tertiary)]">Used in 4 places &middot; 0 missing files</div>
            </div>
            <FeatureCopy
              title="Know what&#8217;s approved"
              body="Version history that traces a source file to the export the client actually received. See where an asset is used before you change it — health checks catch the rest."
            />
          </FeatureCell>

          <FeatureCell>
            <div className="h-[236px] flex flex-col justify-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <span className="bg-[var(--ed-bg-alt)] rounded-full px-2.5 py-1 text-[11.5px] text-[var(--ed-ink-tertiary)]">
                  Draft
                </span>
                <span className="text-[var(--ed-ink-tertiary)] text-[11px]">&rarr;</span>
                <span className="bg-[var(--ed-bg-alt)] rounded-full px-2.5 py-1 text-[11.5px] text-[var(--ed-ink-tertiary)]">
                  Review
                </span>
                <span className="text-[var(--ed-ink-tertiary)] text-[11px]">&rarr;</span>
                <span className="bg-[var(--ed-ink)] text-white rounded-full px-2.5 py-1 text-[11.5px] font-medium">
                  Approved
                </span>
              </div>
              <div className="rounded-xl h-[104px] bg-[var(--ed-bg-alt)]" />
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3 flex gap-2.5 items-start">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--ed-ink)] text-white text-[11px] font-medium flex items-center justify-center">
                  1
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[13.5px] text-[var(--ed-ink)]">Crop tighter on the left edge.</span>
                  <span className="text-[11.5px] text-[var(--ed-ink-tertiary)]">Aalto Foods &middot; v2 &middot; 2h ago</span>
                </div>
              </div>
            </div>
            <FeatureCopy
              title="Review in one place"
              body="Comment on a region of an image, a page of a PDF or a timestamp in a video. Every approval recorded with who, when and which version — permanently."
            />
          </FeatureCell>

          <FeatureCell>
            <div className="h-[236px] flex flex-col justify-center gap-3">
              <div className="bg-[var(--ed-ink)] rounded-[14px] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] uppercase text-white/55">Handover</span>
                  <span style={{ fontFamily: "var(--font-wordmark)" }} className="text-[13px] text-white">
                    desboard
                  </span>
                </div>
                <div className="text-[15px] font-medium text-white">Packaging &mdash; final dielines</div>
                <div className="flex gap-2">
                  <span className="border border-white/20 rounded-full px-2.5 py-1 text-[11px] text-white/70">
                    studio.yourdomain.com
                  </span>
                  <span className="border border-white/20 rounded-full px-2.5 py-1 text-[11px] text-white/70">
                    12 files
                  </span>
                </div>
              </div>
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 text-[12.5px] text-[var(--ed-ink-tertiary)] border-b border-[var(--ed-hairline)] flex justify-between">
                  <span>Opened by client</span>
                  <span>2h ago</span>
                </div>
                <div className="px-3.5 py-2.5 text-[12.5px] text-[var(--ed-ink-tertiary)] flex justify-between">
                  <span>Downloaded 4 files</span>
                  <span>1h ago</span>
                </div>
              </div>
            </div>
            <FeatureCopy
              title="Deliver like a studio"
              body="Send a branded client portal instead of a file-transfer link. Your logo, your domain. See when the client opened it, what they downloaded and what they approved."
            />
          </FeatureCell>

          <FeatureCell>
            <div className="h-[236px] flex flex-col justify-center gap-3">
              <div className="self-end bg-[var(--ed-ink)] text-white rounded-[14px] px-3.5 py-2.5 text-[13px] max-w-[85%]">
                What&#8217;s still unapproved before Friday?
              </div>
              <div className="bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-xl px-4 py-3.5 flex flex-col gap-2.5">
                <div className="text-[13.5px] leading-[1.55] text-[var(--ed-ink)]">
                  Three files in Aalto Rebrand: two key visuals and the dieline v2. Nothing else is blocking delivery.
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <span className="bg-[var(--ed-bg-alt)] rounded-md px-2 py-1 text-[11px] text-[var(--ed-ink-secondary)]">
                    key-visual-a.tif
                  </span>
                  <span className="bg-[var(--ed-bg-alt)] rounded-md px-2 py-1 text-[11px] text-[var(--ed-ink-secondary)]">
                    dieline-v2.pdf
                  </span>
                </div>
              </div>
              <div className="text-[12px] text-[var(--ed-ink-tertiary)]">Every answer comes with its sources.</div>
            </div>
            <FeatureCopy
              title="Ask your archive"
              body="The project assistant answers questions grounded in your own files: what changed this week, what's still unapproved, what's missing before delivery."
            />
          </FeatureCell>
        </div>
      </Reveal>

      <p className="text-[15px] leading-[1.6] text-[var(--ed-ink-tertiary)] max-w-[64ch] mt-10">
        Built for design studios, brand agencies, photographers and in-house creative teams who already pay for
        storage and just need to make sense of it.
      </p>
    </div>
  );
}

/* ==========================================================================
   Studio atmosphere — a break from product screenshots to ground the page in
   the physical, unglamorous reality of the work itself, rather than another
   UI panel. Deliberately doesn't caption these as "our team" or "our
   office" — that would be a claim this page can't back up. They're mood,
   not a testimonial.
   ========================================================================== */

export function StudioAtmosphere() {
  return (
    <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-40">
      <Reveal className="max-w-[38ch] mb-16 sm:mb-20">
        <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
          Who it's for
        </span>
        <p className="text-[26px] sm:text-[32px] leading-[1.25] tracking-[-0.02em] text-[var(--ed-ink)] mt-4">
          Made for studios that sweat the details.
        </p>
        <p className="text-[16px] text-[var(--ed-ink-secondary)] leading-[1.5] mt-4">
          The kind of work that happens after the brief is done — refining, versioning, and handing off something a
          client is proud to receive.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 sm:gap-8 items-start">
        <Reveal className="sm:col-span-7">
          <div className="rounded-[20px] overflow-hidden shadow-[0_24px_64px_-24px_rgba(0,0,0,0.16)]">
            <img
              src="/marketing/studio-desks.jpg"
              alt="A minimal, light-filled studio with a team working at a shared desk"
              loading="lazy"
              className="w-full h-auto aspect-[4/5] sm:aspect-[16/11] object-cover"
            />
          </div>
        </Reveal>
        <Reveal delay={0.1} className="sm:col-span-5 sm:mt-16">
          <div className="rounded-[20px] overflow-hidden shadow-[0_24px_64px_-24px_rgba(0,0,0,0.16)]">
            <img
              src="/marketing/studio-desk-detail.jpg"
              alt="A designer's desk with sketches, reference images, and work in progress"
              loading="lazy"
              className="w-full h-auto aspect-[4/5] object-cover"
            />
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/* ==========================================================================
   Product blocks
   ========================================================================== */

interface Capability {
  verb: string;
  phrase: string;
}

interface ProductBlockData {
  eyebrow: string;
  heading: string;
  link: string;
  image: string;
  imageAlt: string;
  capabilities: Capability[];
  mediaFirst: boolean;
}

const PRODUCT_BLOCKS: ProductBlockData[] = [
  {
    eyebrow: "Client Portal",
    heading: "Send finished work through a page clients open, review, and approve — no login required.",
    link: "Explore the portal",
    image: "/marketing/portal.png",
    imageAlt: "A branded client handover page showing deliverables, statuses, and approve/request-changes actions",
    mediaFirst: false,
    capabilities: [
      { verb: "Package", phrase: "bundle files into one branded page" },
      { verb: "Approve", phrase: "clients sign off file by file, or all at once" },
      { verb: "Comment", phrase: "feedback lands pinned to the exact file" },
      { verb: "Track", phrase: "see the moment it's opened, approved, or stalls" },
    ],
  },
  {
    eyebrow: "File Vault",
    heading: "Every version kept, every file findable — organized the way a studio actually works.",
    link: "Explore File Vault",
    image: "/marketing/filevault.png",
    imageAlt: "The File Vault file grid showing versioned files, tags, and statuses for a client project",
    mediaFirst: true,
    capabilities: [
      { verb: "Version", phrase: "every upload keeps its history, restorable anytime" },
      { verb: "Organize", phrase: "folders, tags, and projects that actually nest" },
      { verb: "Preview", phrase: "open images, video, and documents in place" },
      { verb: "Search", phrase: "find a file by describing it, not naming it" },
    ],
  },
  {
    eyebrow: "Team",
    heading: "Bring on collaborators, assign roles, and keep every project visible to the people working on it.",
    link: "Explore Team",
    image: "/marketing/team.png",
    imageAlt: "The Team roster showing studio members with their roles",
    mediaFirst: false,
    capabilities: [
      { verb: "Invite", phrase: "a link, an email, a seat — nothing to configure" },
      { verb: "Assign", phrase: "owners and members see exactly what they need" },
      { verb: "Share", phrase: "one calendar and message thread per project" },
      { verb: "Scale", phrase: "from one seat to a full production team" },
    ],
  },
];

function ProductBlock({ data, index }: { data: ProductBlockData; index: number }) {
  const text = (
    <Reveal className="lg:col-span-5" y={16}>
      <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
        {data.eyebrow}
      </span>
      <p className="text-[22px] sm:text-[26px] leading-[1.3] tracking-[-0.015em] text-[var(--ed-ink)] mt-4 mb-6 max-w-[34ch]">
        {data.heading}
      </p>
      <ArrowLink href="/signin?mode=signup">{data.link}</ArrowLink>

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 mt-12">
        {data.capabilities.map((c) => (
          <div key={c.verb}>
            <span className="block text-[16px] font-semibold text-[var(--ed-ink)] tracking-[-0.01em]">{c.verb}</span>
            <span className="block text-[14px] text-[var(--ed-ink-secondary)] leading-[1.4] mt-1">{c.phrase}</span>
          </div>
        ))}
      </div>
    </Reveal>
  );

  const media = (
    <Reveal className="lg:col-span-7" delay={0.1} y={24}>
      <div className="rounded-[20px] overflow-hidden shadow-[0_24px_64px_-24px_rgba(0,0,0,0.16)] bg-[var(--ed-bg-alt)]">
        <img
          src={data.image}
          alt={data.imageAlt}
          loading="lazy"
          className="w-full h-auto aspect-[16/10] object-cover object-top"
        />
      </div>
    </Reveal>
  );

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-12 gap-y-10 gap-x-12 items-center ${index > 0 ? "mt-32 sm:mt-44" : ""}`}>
      {data.mediaFirst ? (
        <>
          {media}
          {text}
        </>
      ) : (
        <>
          {text}
          {media}
        </>
      )}
    </div>
  );
}

export function ProductBlocks() {
  return (
    <div id="platform" className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-40 scroll-mt-16">
      {PRODUCT_BLOCKS.map((block, i) => (
        <ProductBlock key={block.eyebrow} data={block} index={i} />
      ))}
    </div>
  );
}

/* ==========================================================================
   Principle quote — a standalone statement of intent rather than a
   testimonial. This product has no named customer to quote yet; attributing
   a line to an invented person or company would be a fabrication, not a
   design choice. The pull-quote treatment carries the section on its own.
   ========================================================================== */

export function PrincipleQuote() {
  return (
    <div className="editorial-invert bg-[var(--ed-bg)] relative overflow-hidden">
      <img
        src="/marketing/ai-particles.gif"
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,760px)] h-[min(90vw,760px)] opacity-40 pointer-events-none select-none"
      />
      <div className="relative max-w-[900px] mx-auto px-6 sm:px-10 py-32 sm:py-44 text-center">
        <Reveal>
          <p className="text-[clamp(26px,3.4vw,44px)] leading-[1.25] tracking-[-0.02em] text-[var(--ed-ink)]">
            “Great client work deserves a great last impression.”
          </p>
          <span className="block text-[13px] text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase mt-8">
            Desboard
          </span>
        </Reveal>
      </div>
    </div>
  );
}

/* ==========================================================================
   Update spotlight — a real, shipped feature, not a fabricated event.
   ========================================================================== */

export function UpdateSpotlight() {
  return (
    <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-36">
      <Reveal>
        <div className="rounded-[24px] bg-[var(--ed-bg-alt)] px-8 sm:px-16 py-16 sm:py-20 text-center">
          <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
            Now on Studio
          </span>
          <h2 className="text-[clamp(30px,4vw,52px)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--ed-ink)] mt-5">
            AI search, built in.
          </h2>
          <p className="text-[17px] text-[var(--ed-ink-secondary)] mt-5 max-w-[50ch] mx-auto leading-[1.5]">
            Find any file by describing it — new uploads get tagged automatically the moment they land in the vault.
          </p>
          <div className="mt-9">
            <ArrowLink href="/pricing">See plans</ArrowLink>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ==========================================================================
   Numbered feature carousel
   ========================================================================== */

const CAROUSEL_SLIDES: { title: string; body: string; video?: string }[] = [
  {
    title: "AI search & tagging",
    body: "Describe a file instead of hunting for it. New uploads get tag suggestions automatically.",
    video: "/marketing/ai-orb.mp4",
  },
  {
    title: "White-label portal",
    body: "Put your studio's name on the door — custom accent color, logo, and branding on every client page.",
  },
  {
    title: "Version history",
    body: "Every upload keeps its past selves. Restore any version in one click, no questions asked.",
  },
  {
    title: "Cloud connections",
    body: "Pull files straight from Google Drive, Dropbox, or OneDrive — nothing to re-upload.",
  },
  {
    title: "Roles & permissions",
    body: "Owners and members see exactly what they're meant to. Nothing more, nothing hidden.",
  },
  {
    title: "Calendar & messaging",
    body: "Deadlines and conversations live next to the work itself, not in another tab.",
  },
];

export function FeatureCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <div className="border-t border-[var(--ed-hairline)]">
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-36">
        <div className="flex items-center gap-5 mb-12 flex-wrap">
          {CAROUSEL_SLIDES.map((s, i) => (
            <button
              key={s.title}
              onClick={() => goTo(i)}
              className={`text-[14px] font-medium tabular-nums tracking-[-0.01em] transition-colors duration-200 ${
                active === i ? "text-[var(--ed-ink)]" : "text-[var(--ed-ink-tertiary)] hover:text-[var(--ed-ink-secondary)]"
              }`}
            >
              {String(i + 1).padStart(2, "0")}
            </button>
          ))}
        </div>

        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {CAROUSEL_SLIDES.map((s) => (
            <div
              key={s.title}
              className={`snap-center shrink-0 w-full pr-8 ${
                s.video ? "grid grid-cols-1 sm:grid-cols-12 gap-8 items-center" : ""
              }`}
            >
              <div className={s.video ? "sm:col-span-6" : ""}>
                <p className="text-[clamp(28px,4.2vw,56px)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--ed-ink)] max-w-[16ch]">
                  {s.title}
                </p>
                <p className="text-[17px] text-[var(--ed-ink-secondary)] leading-[1.5] mt-6 max-w-[46ch]">{s.body}</p>
              </div>
              {s.video && (
                <div className="sm:col-span-6 rounded-[20px] overflow-hidden bg-[var(--ed-invert-bg)] mt-8 sm:mt-0">
                  <video
                    src={s.video}
                    autoPlay={!reduceMotion}
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full h-auto aspect-square object-cover"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Pricing teaser
   ========================================================================== */

export function LandingPricingTeaser() {
  return (
    <div className="border-t border-[var(--ed-hairline)]">
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-28 sm:py-36">
        <Reveal className="text-center mb-14">
          <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
            Pricing
          </span>
          <p className="text-[clamp(28px,3.6vw,44px)] font-medium tracking-[-0.03em] text-[var(--ed-ink)] mt-4">
            Simple per-seat pricing.
          </p>
        </Reveal>
        <MarketingPricingCards />
        <div className="text-center mt-10">
          <ArrowLink href="/pricing">See the full comparison</ArrowLink>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   FAQ
   ========================================================================== */

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need a card to start?",
    a: "No. Every workspace gets a 14-day trial with the full Studio feature set — no card required.",
  },
  {
    q: "What happens when the trial ends?",
    a: "Your data stays exactly as you left it, but the workspace is paused until you choose a plan. Nothing is deleted.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes — upgrade, downgrade, or cancel any time from Settings. Changes are prorated automatically.",
  },
  {
    q: "What does my client see?",
    a: "Only the branded handover portal you send them — never your File Vault, other clients, or internal workspace.",
  },
];

export function EditorialFAQ() {
  return (
    <div id="faq" className="max-w-[720px] mx-auto px-6 sm:px-10 py-28 sm:py-36 scroll-mt-16">
      <Reveal className="text-center mb-14">
        <span className="text-[13px] font-medium text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase">
          Frequently asked
        </span>
      </Reveal>
      <div className="flex flex-col">
        {FAQ.map((item, i) => (
          <Reveal key={item.q} delay={i * 0.06} className="border-t border-[var(--ed-hairline)] py-7 last:border-b">
            <h3 className="text-[16px] font-medium text-[var(--ed-ink)] tracking-[-0.01em] mb-2">{item.q}</h3>
            <p className="text-[15px] text-[var(--ed-ink-secondary)] leading-[1.5]">{item.a}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
   Footer
   ========================================================================== */

export function EditorialFooter() {
  return (
    <footer className="border-t border-[var(--ed-hairline)]">
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-16 grid grid-cols-2 sm:grid-cols-4 gap-10">
        <div className="col-span-2 sm:col-span-1">
          <span style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-[var(--ed-ink)]">
            desboard
          </span>
          <p className="text-[13px] text-[var(--ed-ink-tertiary)] mt-3 max-w-[24ch]">
            Client work, delivered like it matters.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-[12px] text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase mb-1">Product</span>
          <a href="#platform" className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors">
            Platform
          </a>
          <a href="/pricing" className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors">
            Pricing
          </a>
          <a href="#faq" className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors">
            FAQ
          </a>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-[12px] text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase mb-1">Company</span>
          <a href="mailto:sales@desboard.studio" className="text-[14px] text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors">
            Contact
          </a>
          <span className="text-[14px] text-[var(--ed-ink-secondary)]">Terms of Use</span>
          <span className="text-[14px] text-[var(--ed-ink-secondary)]">Privacy Policy</span>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-[12px] text-[var(--ed-ink-tertiary)] tracking-[0.02em] uppercase mb-1">Social</span>
          <span className="text-[14px] text-[var(--ed-ink-secondary)]">X</span>
          <span className="text-[14px] text-[var(--ed-ink-secondary)]">LinkedIn</span>
        </div>
      </div>
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 pb-10 text-[12.5px] text-[var(--ed-ink-tertiary)]">
        © {new Date().getFullYear()} Desboard
      </div>
    </footer>
  );
}
