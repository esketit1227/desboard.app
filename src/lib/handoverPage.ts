/**
 * Standalone branded handover landing page.
 *
 * A single PURE function that renders a complete, self-contained HTML document
 * for a handover package. It is the single source of truth used in two places:
 *   - the Express server serves it at GET /handover/:id  (the real shared page)
 *   - the branding editor renders it live into an <iframe srcDoc> for preview
 * so the preview always matches exactly what the client will see.
 *
 * It must stay dependency-free (no Node or browser APIs) and inline all styles,
 * since the output is opened directly by clients without the app.
 */
import type { Handover, HandoverBranding, HandoverComment, VaultFile } from "../types";

/** HTML-escape text content. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow safe color values into CSS (hex or a plain named color). */
function safeColor(c: string | undefined, fallback: string): string {
  if (c && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) return c.trim();
  if (c && /^[a-zA-Z]{3,20}$/.test(c.trim())) return c.trim();
  return fallback;
}

/** Only allow http(s) or data image URLs for the logo. */
function safeImageUrl(url: string | undefined): string {
  if (!url) return "";
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
  return "";
}

const pick = (val: string | undefined, def: string) => (val && val.trim() ? val : def);

/** Resolve a handover's branding, filling in sensible defaults from its content. */
export function effectiveBranding(h: Handover): Required<HandoverBranding> {
  const b = h.branding ?? ({} as Partial<HandoverBranding>);
  return {
    accent: safeColor(b.accent, "#D85E25"),
    theme: b.theme === "light" ? "light" : "dark",
    studioName: pick(b.studioName, "Desboard Studio"),
    logoUrl: safeImageUrl(b.logoUrl),
    headline: pick(b.headline, h.title),
    subhead: pick(b.subhead, h.recipient ? `Prepared for ${h.recipient}` : "Project deliverables"),
    welcome: pick(
      b.welcome,
      h.note ||
        "Everything for your project is gathered here. Review the files below and reach out if you have any questions."
    ),
  };
}

function fileExtLabel(f: VaultFile): string {
  if (f.type === "folder") return "DIR";
  return (f.extension || "FILE").toUpperCase().slice(0, 4);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface RenderHandoverOpts {
  handover: Handover;
  files: VaultFile[];
  comments?: HandoverComment[];
}

export function renderHandoverPage({ handover, files, comments = [] }: RenderHandoverOpts): string {
  const b = effectiveBranding(handover);
  const dark = b.theme === "dark";
  const accent = b.accent;

  // Theme tokens.
  const c = dark
    ? { bg: "#0b0b0d", panel: "#141416", card: "#161618", text: "#EBE6DD", muted: "rgba(235,230,221,0.55)", border: "rgba(255,255,255,0.09)", chip: "rgba(255,255,255,0.05)" }
    : { bg: "#f5f4f0", panel: "#ffffff", card: "#ffffff", text: "#191919", muted: "rgba(0,0,0,0.55)", border: "rgba(0,0,0,0.10)", chip: "rgba(0,0,0,0.04)" };

  const statusBadge = `<span class="status">${esc(handover.status)}</span>`;

  const logo = b.logoUrl
    ? `<img class="logo-img" src="${esc(b.logoUrl)}" alt="${esc(b.studioName)} logo" />`
    : `<span class="logo-text">${esc(b.studioName)}</span>`;

  const filesHtml = files.length
    ? files
        .map(
          (f) => `
        <div class="file">
          <div class="file-badge">${esc(fileExtLabel(f))}</div>
          <div class="file-info">
            <div class="file-name">${esc(f.name)}</div>
            <div class="file-meta">${esc(f.size || (f.type === "folder" ? "Folder" : "—"))}${f.status ? " &middot; " + esc(f.status) : ""}</div>
          </div>
          <button type="button" class="note-btn" data-file="${esc(f.id)}">+ Note</button>
          <a class="dl" href="/handover/${esc(handover.id)}/file/${esc(f.id)}/download" download>Download</a>
        </div>`
        )
        .join("")
    : `<div class="empty">No files attached to this handover yet.</div>`;

  const nameById = (id?: string | null) => (id ? files.find((f) => f.id === id)?.name ?? "a file" : "");

  const commentsHtml = comments.length
    ? comments
        .map((cm) => {
          const isDesigner = cm.role === "designer";
          const roleLabel = isDesigner ? "Studio" : "Client";
          const onChip = cm.fileId ? `<span class="on">on ${esc(nameById(cm.fileId))}</span>` : "";
          return `
        <div class="comment ${isDesigner ? "designer" : "client"}">
          <div class="c-head">
            <span class="who">${esc(cm.author)}</span>
            <span class="role">${roleLabel}</span>
            ${onChip}
            <span class="time">${esc(fmtTime(cm.created))}</span>
          </div>
          <div class="c-body">${esc(cm.body)}</div>
        </div>`;
        })
        .join("")
    : `<div class="empty">No notes yet — start the conversation below.</div>`;

  const fileOptions = files
    .map((f) => `<option value="${esc(f.id)}">On: ${esc(f.name)}</option>`)
    .join("");

  const discussionHtml = `
    <div class="section-title" style="margin-top:40px">
      <h2>Discussion</h2>
      <span class="count">${comments.length} note${comments.length === 1 ? "" : "s"}</span>
    </div>
    <p class="disc-sub">Leave notes or annotate a file. Everything here is shared with the ${esc(b.studioName)} team.</p>
    <div class="thread">${commentsHtml}</div>

    <form id="composer" class="composer">
      <div class="composer-row">
        <input id="c-name" class="c-input" type="text" placeholder="Your name" autocomplete="name" />
        <select id="c-file" class="c-input c-select">
          <option value="">General note</option>
          ${fileOptions}
        </select>
      </div>
      <textarea id="c-body" class="c-input c-area" rows="3" placeholder="Write a note or leave feedback…"></textarea>
      <div class="composer-actions">
        <button type="submit" class="post-btn">Post note</button>
      </div>
    </form>`;

  const commentScript = `
    <script>
    (function(){
      var API = ${JSON.stringify(`/api/handovers/${handover.id}/comments`)};
      var form = document.getElementById('composer');
      if(!form) return;
      var nameEl = document.getElementById('c-name');
      var bodyEl = document.getElementById('c-body');
      var fileEl = document.getElementById('c-file');
      try { var saved = localStorage.getItem('desboard_handover_name'); if(saved && nameEl) nameEl.value = saved; } catch(e){}
      // "+ Note" buttons on files: target that file and focus the composer.
      Array.prototype.forEach.call(document.querySelectorAll('.note-btn'), function(btn){
        btn.addEventListener('click', function(){
          if(fileEl) fileEl.value = btn.getAttribute('data-file') || '';
          if(bodyEl){ bodyEl.focus(); }
          form.scrollIntoView({behavior:'smooth', block:'center'});
        });
      });
      form.addEventListener('submit', function(e){
        e.preventDefault();
        var author = (nameEl && nameEl.value || '').trim() || 'Client';
        var body = (bodyEl && bodyEl.value || '').trim();
        var fileId = fileEl ? fileEl.value : '';
        if(!body) return;
        try { localStorage.setItem('desboard_handover_name', author); } catch(e){}
        var btn = form.querySelector('.post-btn');
        if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
        fetch(API, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({author:author, role:'client', body:body, fileId: fileId || null})
        }).then(function(r){ if(!r.ok) throw new Error('failed'); location.reload(); })
          .catch(function(){ if(btn){ btn.disabled=false; btn.textContent='Post note'; } alert('Could not send your note. Please try again.'); });
      });
    })();
    </script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(b.headline)} — Handover</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  :root { --accent: ${accent}; }
  html, body { margin: 0; padding: 0; }
  body {
    background: ${c.bg};
    color: ${c.text};
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
  }
  .accent-bar { height: 6px; background: var(--accent); width: 100%; }
  .wrap { max-width: 780px; margin: 0 auto; padding: 28px 24px 64px; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 28px; }
  .logo-img { max-height: 40px; max-width: 200px; object-fit: contain; display: block; }
  .logo-text { font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
  .eyebrow { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: ${c.muted}; font-weight: 600; }
  .hero { padding: 8px 0 28px; border-bottom: 1px solid ${c.border}; margin-bottom: 28px; }
  h1 { font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: clamp(30px, 6vw, 46px); line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 12px; }
  .subhead { font-size: 16px; color: ${c.muted}; margin: 0 0 18px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .status { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 12px; border-radius: 999px; color: var(--accent); border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .pill { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${c.muted}; background: ${c.chip}; border: 1px solid ${c.border}; padding: 5px 12px; border-radius: 999px; }
  .welcome { background: ${c.panel}; border: 1px solid ${c.border}; border-radius: 16px; padding: 22px 24px; margin-bottom: 34px; font-size: 15px; color: ${c.text}; }
  .section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  .section-title h2 { font-family: "Space Grotesk", sans-serif; font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; margin: 0; }
  .section-title .count { font-size: 12px; color: ${c.muted}; }
  .files { display: flex; flex-direction: column; gap: 10px; }
  .file { display: flex; align-items: center; gap: 16px; background: ${c.card}; border: 1px solid ${c.border}; border-radius: 14px; padding: 14px 16px; transition: border-color .15s; }
  .file:hover { border-color: var(--accent); }
  .file-badge { flex-shrink: 0; width: 46px; height: 46px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
  .file-info { flex: 1; min-width: 0; }
  .file-name { font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta { font-size: 11px; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 3px; }
  .dl { flex-shrink: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--accent); padding: 9px 16px; border-radius: 999px; cursor: pointer; user-select: none; text-decoration: none; display: inline-block; }
  .dl:hover { opacity: 0.9; }
  .empty { color: ${c.muted}; font-size: 14px; text-align: center; padding: 28px; border: 1px dashed ${c.border}; border-radius: 14px; }
  .note-btn { flex-shrink: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${c.muted}; background: transparent; border: 1px solid ${c.border}; padding: 8px 12px; border-radius: 999px; cursor: pointer; transition: color .15s, border-color .15s; }
  .note-btn:hover { color: var(--accent); border-color: var(--accent); }

  .disc-sub { font-size: 13px; color: ${c.muted}; margin: -6px 0 16px; }
  .thread { display: flex; flex-direction: column; gap: 12px; margin-bottom: 22px; }
  .comment { background: ${c.card}; border: 1px solid ${c.border}; border-left: 3px solid ${c.border}; border-radius: 12px; padding: 14px 16px; }
  .comment.designer { border-left-color: var(--accent); }
  .c-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .c-head .who { font-weight: 600; font-size: 13px; }
  .c-head .role { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${c.muted}; background: ${c.chip}; border: 1px solid ${c.border}; padding: 2px 8px; border-radius: 999px; }
  .comment.designer .role { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .c-head .on { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .c-head .time { margin-left: auto; font-size: 11px; color: ${c.muted}; }
  .c-body { font-size: 14px; color: ${c.text}; white-space: pre-wrap; }

  .composer { background: ${c.panel}; border: 1px solid ${c.border}; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .composer-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .c-input { background: ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}; border: 1px solid ${c.border}; border-radius: 10px; padding: 11px 14px; font-size: 14px; color: ${c.text}; font-family: inherit; outline: none; }
  .c-input:focus { border-color: var(--accent); }
  .composer-row .c-input { flex: 1; min-width: 140px; }
  .c-select { cursor: pointer; }
  .c-area { width: 100%; resize: vertical; }
  .composer-actions { display: flex; justify-content: flex-end; }
  .post-btn { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--accent); border: none; padding: 11px 22px; border-radius: 999px; cursor: pointer; }
  .post-btn:disabled { opacity: 0.6; cursor: default; }

  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid ${c.border}; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${c.muted}; }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="wrap">
    <div class="topbar">
      <div class="logo">${logo}</div>
      <div class="eyebrow">Handover Package</div>
    </div>

    <div class="hero">
      <h1>${esc(b.headline)}</h1>
      <p class="subhead">${esc(b.subhead)}</p>
      <div class="meta">
        ${statusBadge}
        ${handover.recipient ? `<span class="pill">For ${esc(handover.recipient)}</span>` : ""}
        ${handover.created ? `<span class="pill">${esc(handover.created)}</span>` : ""}
      </div>
    </div>

    <div class="welcome">${esc(b.welcome)}</div>

    <div class="section-title">
      <h2>Files</h2>
      <span class="count">${files.length} item${files.length === 1 ? "" : "s"}</span>
    </div>
    <div class="files">${filesHtml}</div>

    ${discussionHtml}

    <div class="footer">
      <span>Delivered by ${esc(b.studioName)}</span>
      <span>Powered by <a href="/">Desboard</a></span>
    </div>
  </div>
  ${commentScript}
</body>
</html>`;
}
