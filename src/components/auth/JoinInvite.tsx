/**
 * /join/:token — accepting a team invite. Structurally separate from
 * AuthGate's login/signup: this is the ONLY path that joins an EXISTING
 * workspace instead of minting a new one, so it deserves its own screen
 * rather than being folded into the generic auth form.
 */
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { InvitePreview } from "../../types";

export function JoinInvite({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .getInvitePreview(token)
      .then((p) => {
        setPreview(p);
        if (p.email) setEmail(p.email);
      })
      .catch(() => setPreview({ workspaceName: "", email: null, valid: false }))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.acceptInvite(token, { email, password, name: name || undefined });
      setDone(true);
      // Full reload so AuthGate re-checks /api/auth/me and mounts the real app.
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="w-screen h-screen bg-paper" />;

  if (!preview?.valid) {
    return (
      <div className="w-screen h-screen bg-paper flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-panel border border-line rounded-2xl shadow-sm p-8 text-center">
          <h1 className="text-lg font-semibold text-ink">This invite is no longer valid</h1>
          <p className="text-sm text-muted mt-2">
            It may have already been used or revoked. Ask whoever invited you to send a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-paper flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-panel border border-line rounded-2xl shadow-sm p-8">
        <h1 className="text-lg font-semibold text-ink tracking-tight">Join {preview.workspaceName}</h1>
        <p className="text-sm text-muted mt-1 mb-6">You've been invited to this studio's workspace.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-surface outline-none focus:border-primary"
          />
          <input
            type="email"
            required
            readOnly={!!preview.email}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className={`border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-primary ${
              preview.email ? "bg-chip text-muted" : "bg-surface"
            }`}
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Choose a password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-surface outline-none focus:border-primary"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || done}
            className="mt-1 bg-primary text-white text-sm font-medium rounded-lg px-3 py-2.5 disabled:opacity-60 transition-opacity"
          >
            {submitting || done ? "Joining…" : "Join studio"}
          </button>
        </form>
      </div>
    </div>
  );
}
