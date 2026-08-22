/**
 * Dedicated /signin route — sign in and sign up both live here now, out of
 * the marketing hero. A successful auth does a full navigation back to "/"
 * rather than a client-side state update: this page can be reached with no
 * prior app state loaded, so a hard redirect is the simplest way to land in
 * a clean, fully-initialized Dashboard rather than threading auth state
 * back through AuthGate from a page it didn't render.
 */
import { MotionConfig, motion } from "motion/react";
import type { AuthUser } from "../types";
import { AuthForm } from "../components/auth/AuthForm";

export default function SignInPage() {
  const initialMode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";

  const handleAuthed = (_user: AuthUser) => {
    window.location.href = "/";
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="editorial w-screen h-screen overflow-y-auto flex flex-col">
        <nav className="px-6 sm:px-10 h-[68px] flex items-center shrink-0">
          <a href="/" style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-[var(--ed-ink)]">
            desboard
          </a>
        </nav>

        <div className="flex-1 flex items-center justify-center px-6 py-12 relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] opacity-[0.08] pointer-events-none select-none"
            style={{
              backgroundImage: "radial-gradient(circle, var(--ed-ink) 0%, transparent 70%)",
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="relative"
          >
            <AuthForm onAuthed={handleAuthed} initialMode={initialMode} />
          </motion.div>
        </div>

        <div className="px-6 sm:px-10 py-8 text-center shrink-0">
          <span className="text-[12.5px] text-[var(--ed-ink-tertiary)]">
            Terms of Use · Privacy Policy · © {new Date().getFullYear()} Desboard
          </span>
        </div>
      </div>
    </MotionConfig>
  );
}
