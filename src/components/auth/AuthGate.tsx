/**
 * Gate between "nobody's signed in" and the actual app. Checks the existing
 * session once on mount (GET /api/auth/me), and otherwise renders a minimal
 * login/signup form — every /api/* route the Dashboard calls requires a
 * session, so nothing behind this gate can load without one.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";
import { AuthContext } from "./AuthContext";
import { Toast } from "../Toast";
import { GoogleIcon, MicrosoftIcon, AppleIcon } from "./ProviderIcons";

type Status = "loading" | "anon" | "authed";

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const notice = (msg: string) => setToastMessage(msg);

  const refresh = useCallback(async () => {
    const u = await api.me();
    setUser(u);
    setStatus("authed");
  }, []);

  useEffect(() => {
    refresh().catch(() => setStatus("anon"));
  }, [refresh]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u =
        mode === "signup"
          ? await api.signup({ email, password, name: name || undefined, workspaceName: workspaceName || undefined })
          : await api.login({ email, password });
      setUser(u);
      setStatus("authed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const handleLogout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setEmail("");
    setPassword("");
    setStatus("anon");
  }, []);

  if (status === "loading") {
    return <div className="w-screen h-screen bg-paper" />;
  }

  if (status === "authed" && user) {
    return (
      <AuthContext.Provider value={{ user, refresh, logout: handleLogout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  const ssoButtonClass =
    "flex items-center justify-center gap-2.5 border border-line rounded-full py-2.5 text-[13.5px] font-medium text-ink bg-white hover:bg-chip transition-colors";

  return (
    <div className="w-screen h-screen bg-paper flex flex-col px-4 py-6 overflow-y-auto">
      <span style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-ink">
        desboard
      </span>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-ink tracking-tight text-center mb-6">
            {mode === "login" ? "Sign In" : "Create your studio"}
          </h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-chip border border-transparent rounded-full px-4 py-2.5 text-sm text-ink outline-none focus:border-primary/50 transition-colors"
              />
            )}
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Studio name (optional)"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="bg-chip border border-transparent rounded-full px-4 py-2.5 text-sm text-ink outline-none focus:border-primary/50 transition-colors"
              />
            )}
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="bg-chip border border-transparent rounded-full px-4 py-2.5 text-sm text-ink outline-none focus:border-primary/50 transition-colors"
            />
            <input
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              placeholder={mode === "signup" ? "Password (min. 8 characters)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="bg-chip border border-transparent rounded-full px-4 py-2.5 text-sm text-ink outline-none focus:border-primary/50 transition-colors"
            />

            {error && <p className="text-xs text-ink font-medium px-1">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-full px-3 py-2.5 disabled:opacity-60 transition-colors"
            >
              {submitting ? "Please wait…" : mode === "login" ? "Sign In" : "Create account"}
            </button>
          </form>

          <div className="flex items-center justify-center gap-3 mt-4 text-[12.5px]">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
              }}
              className="text-muted hover:text-ink transition-colors"
            >
              {mode === "login" ? "Sign Up" : "Sign in instead"}
            </button>
            {mode === "login" && (
              <>
                <span className="text-line">|</span>
                <button
                  type="button"
                  onClick={() => notice("Password reset isn't set up yet — contact your workspace admin.")}
                  className="text-muted hover:text-ink transition-colors"
                >
                  Forgot Password
                </button>
                <span className="text-line">|</span>
                <button
                  type="button"
                  onClick={() => notice("For support, reach out to your workspace admin.")}
                  className="text-muted hover:text-ink transition-colors"
                >
                  Contact Us
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-line" />
            <span className="text-[12px] text-muted">or</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          <div className="flex flex-col gap-2.5">
            <a href="/api/auth/sso/google/start" className={ssoButtonClass}>
              <GoogleIcon className="w-4 h-4" /> Sign in with Google
            </a>
            <a href="/api/auth/sso/microsoft/start" className={ssoButtonClass}>
              <MicrosoftIcon className="w-4 h-4" /> Sign in with Microsoft
            </a>
            <a href="/api/auth/sso/apple/start" className={ssoButtonClass}>
              <AppleIcon className="w-4 h-4 text-ink" /> Sign in with Apple
            </a>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 text-[11.5px] text-muted pb-2">
        <span>Terms of Use</span>
        <span className="text-line">|</span>
        <span>Privacy Policy</span>
      </div>
      <div className="text-center text-[11px] text-muted pb-1">© {new Date().getFullYear()} Desboard</div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
