/**
 * Standalone pages for the portal's non-content states: unknown link, expired,
 * revoked, and the password gate. Pure functions returning full HTML documents,
 * consistent with the handover landing page's look. Deliberately generic:
 * these pages never confirm what exists behind a link, who the studio is, or
 * why access was withdrawn.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/favicon.png" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #f5f5f7; color: #1d1d1f; font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
         -webkit-font-smoothing: antialiased; line-height: 1.5; }
  .card { max-width: 420px; width: 100%; text-align: center; }
  h1 { font-weight: 700; font-size: 26px; letter-spacing: -0.01em; margin: 0 0 10px; }
  p { color: #86868b; font-size: 14px; margin: 0 0 22px; }
  .icon { font-size: 34px; margin-bottom: 18px; }
  form { display: flex; flex-direction: column; gap: 10px; text-align: left; }
  label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #86868b; font-weight: 600; }
  input[type="password"] { background: #eeeef1; border: 1px solid transparent; border-radius: 10px;
         padding: 13px 15px; font-size: 15px; color: #1d1d1f; font-family: inherit; outline: none; width: 100%; }
  input[type="password"]:focus { border-color: #2c2c2e; }
  button { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff;
         background: #2c2c2e; border: none; padding: 13px 22px; border-radius: 999px; cursor: pointer; margin-top: 6px; }
  button:hover { opacity: 0.9; }
  .err { color: #1d1d1f; font-weight: 600; font-size: 13px; margin: 0; }
  .hint { font-size: 12px; color: #86868b; margin-top: 22px; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

export function portalNotFoundPage(): string {
  return shell(
    "Link not found",
    `<div class="icon">🔗</div>
     <h1>This link isn't valid</h1>
     <p>The address may have been mistyped, or the link may no longer exist.</p>
     <p class="hint">If someone sent you this link, ask them to check it or send a fresh one.</p>`
  );
}

export function portalExpiredPage(): string {
  return shell(
    "Link expired",
    `<div class="icon">⏳</div>
     <h1>This link has expired</h1>
     <p>Access to this delivery has ended.</p>
     <p class="hint">Need it back? Contact the studio that sent you this link and ask them to reissue access.</p>`
  );
}

export function portalRevokedPage(): string {
  return shell(
    "Access withdrawn",
    `<div class="icon">🔒</div>
     <h1>Access has been withdrawn</h1>
     <p>This delivery is no longer available at this address.</p>
     <p class="hint">If you believe this is a mistake, contact the studio that sent you the link.</p>`
  );
}

export function portalPasswordPage(token: string, opts: { error?: boolean } = {}): string {
  return shell(
    "Enter password",
    `<div class="icon">🔐</div>
     <h1>This delivery is protected</h1>
     <p>Enter the password you were given to view it.</p>
     ${opts.error ? `<p class="err">That password isn't right — try again.</p>` : ""}
     <form method="POST" action="/portal/${esc(token)}/access">
       <label for="pw">Password</label>
       <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
       <button type="submit">View delivery</button>
     </form>`
  );
}
