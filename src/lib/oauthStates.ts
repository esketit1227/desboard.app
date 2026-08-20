/**
 * Standalone error page for the OAuth connect/callback flow — shown when a
 * browser is mid-redirect (Google/Dropbox consent screen, or back from it)
 * and something's wrong, so a raw JSON error never appears in the address
 * bar. Same visual language as portalStates.ts's non-content pages.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function oauthErrorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/favicon.png" />
<style>
  @font-face {
    font-family: "Artific";
    src: url("/fonts/Artific-Variable.ttf") format("truetype-variations");
    font-weight: 100 900;
    font-style: normal;
    font-display: swap;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #0b0b0d; color: #EBE6DD; font-family: "Artific", ui-sans-serif, system-ui, sans-serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
         -webkit-font-smoothing: antialiased; line-height: 1.5; }
  .card { max-width: 420px; width: 100%; text-align: center; }
  h1 { font-weight: 700; font-size: 26px; letter-spacing: -0.01em; margin: 0 0 10px; }
  p { color: rgba(235,230,221,0.55); font-size: 14px; margin: 0 0 22px; }
  .icon { font-size: 34px; margin-bottom: 18px; }
  a.button { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
         color: #fff; background: #D85E25; text-decoration: none; padding: 13px 22px; border-radius: 999px; }
  a.button:hover { opacity: 0.9; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🔌</div>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <a class="button" href="/">Back to Desboard</a>
  </div>
</body>
</html>`;
}
