/**
 * The actual email/password + SSO form — pure and reusable, no page chrome.
 * Used by SignInPage (the dedicated /signin route). Owns its own field
 * state and submit handling; tells its parent about a successful session
 * via `onAuthed` rather than reaching into any shared auth state itself.
 */
import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";
import { Toast } from "../Toast";
import { GoogleIcon, MicrosoftIcon, AppleIcon } from "./ProviderIcons";

export function AuthForm({
  onAuthed,
  initialMode = "login",
}: {
  onAuthed: (user: AuthUser) => void;
  initialMode?: "login" | "signup";
}) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const notice = (msg: string) => setToastMessage(msg);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u =
        mode === "signup"
          ? await api.signup({ email, password, name: name || undefined, workspaceName: workspaceName || undefined })
          : await api.login({ email, password });
      onAuthed(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const ssoButtonClass =
    "flex items-center justify-center gap-2.5 border border-[var(--ed-hairline)] rounded-full py-2.5 text-[13.5px] font-medium text-[var(--ed-ink)] bg-[var(--ed-bg)] hover:bg-[var(--ed-bg-alt)] transition-colors duration-150";
  const fieldClass =
    "bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-full px-4 py-2.5 text-sm text-[var(--ed-ink)] outline-none focus:border-[var(--ed-ink)]/40 transition-colors placeholder:text-[var(--ed-ink-tertiary)]";

  return (
    <div className="w-full max-w-sm bg-[var(--ed-bg)] border border-[var(--ed-hairline)] rounded-[20px] p-7">
      <h1 className="text-[20px] font-medium text-[var(--ed-ink)] tracking-[-0.01em] text-center mb-6">
        {mode === "login" ? "Sign in" : "Create your studio"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        )}
        {mode === "signup" && (
          <input
            type="text"
            placeholder="Studio name (optional)"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className={fieldClass}
          />
        )}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={fieldClass}
        />
        <input
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={mode === "signup" ? "Password (min. 8 characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={fieldClass}
        />

        {error && <p className="text-xs text-[var(--ed-ink)] font-medium px-1">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 bg-[var(--ed-ink)] hover:bg-[#262626] text-white text-sm font-medium rounded-full px-3 py-2.5 disabled:opacity-60 transition-colors duration-150"
        >
          {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="flex items-center justify-center gap-3 mt-4 text-[12.5px]">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
          className="text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors"
        >
          {mode === "login" ? "Sign up" : "Sign in instead"}
        </button>
        {mode === "login" && (
          <>
            <span className="text-[var(--ed-hairline)]">|</span>
            <button
              type="button"
              onClick={() => notice("Password reset isn't set up yet — contact your workspace admin.")}
              className="text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors"
            >
              Forgot password
            </button>
            <span className="text-[var(--ed-hairline)]">|</span>
            <button
              type="button"
              onClick={() => notice("For support, reach out to your workspace admin.")}
              className="text-[var(--ed-ink-secondary)] hover:text-[var(--ed-ink)] transition-colors"
            >
              Contact us
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-[var(--ed-hairline)]" />
        <span className="text-[12px] text-[var(--ed-ink-tertiary)]">or</span>
        <div className="flex-1 h-px bg-[var(--ed-hairline)]" />
      </div>

      <div className="flex flex-col gap-2.5">
        <a href="/api/auth/sso/google/start" className={ssoButtonClass}>
          <GoogleIcon className="w-4 h-4" /> Sign in with Google
        </a>
        <a href="/api/auth/sso/microsoft/start" className={ssoButtonClass}>
          <MicrosoftIcon className="w-4 h-4" /> Sign in with Microsoft
        </a>
        <a href="/api/auth/sso/apple/start" className={ssoButtonClass}>
          <AppleIcon className="w-4 h-4 text-[var(--ed-ink)]" /> Sign in with Apple
        </a>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
