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
 *
 * Visual proofing: images can be "spectated" full-screen and annotated with
 * point pins (comments with an x/y position, stored as a percentage of the
 * image's rendered box so they stay put regardless of zoom/viewport). PDFs
 * can be spectated but not pinned — there's no in-browser PDF page renderer
 * here, just the browser's native inline viewer, which doesn't expose stable
 * click coordinates to pin against. Every file must be individually approved
 * before its real download unlocks; approval and pinning are both handled by
 * the same inline <script> at the bottom of the page.
 */
import type { Handover, HandoverApprovals, HandoverBranding, HandoverComment, HandoverTemplate, VaultFile } from "../types";

export const TEMPLATES: HandoverTemplate[] = [
  "editorial",
  "minimal",
  "bold",
  "ledger",
  "terminal",
  "broadsheet",
  "boarding-pass",
  "zine",
  "friendly",
  "gallery",
  "blueprint",
  "swiss",
  "app",
  "letterhead",
  "manifest",
];

/**
 * Extra Google Fonts families each template needs beyond the always-loaded
 * Inter + Newsreader — kept per-template and injected only for the active
 * one, since unconditionally loading a dozen typefaces on every client-facing
 * page load would be wasteful. Empty string = no extra family needed.
 */
const TEMPLATE_FONTS: Record<HandoverTemplate, string> = {
  editorial: "",
  minimal: "",
  bold: "",
  ledger: "family=Space+Mono:wght@400;700",
  terminal: "family=Oswald:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600",
  broadsheet: "family=Libre+Baskerville:ital,wght@0,400;0,700;1,400",
  "boarding-pass": "family=Oswald:wght@600;700&family=IBM+Plex+Mono:wght@400;500;700",
  zine: "family=Oswald:wght@700;800&family=Space+Mono:wght@400;700",
  friendly: "family=Poppins:wght@500;600;700;800",
  gallery: "family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400",
  blueprint: "family=IBM+Plex+Mono:wght@400;500;600;700",
  swiss: "family=Space+Grotesk:wght@500;600;700",
  app: "family=Baloo+2:wght@600;700;800",
  letterhead: "family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,400",
  manifest: "",
};

/** HTML-escape text content. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON-encode a value for embedding inside an inline <script> tag. Comment
 * bodies and file names flowing through here can be attacker-influenced (a
 * client wrote that comment), so this guards against a literal `</script>`
 * in the data closing the tag early and injecting markup — JSON.stringify
 * alone does not escape `<`.
 */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
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
    // Neutral monochrome default, matching Desboard's own primary — a studio
    // that hasn't customized a handover gets a page that looks like the rest
    // of the app; the accent swatches remain full-color for studios who want
    // to actively brand their delivery.
    accent: safeColor(b.accent, "#2c2c2e"),
    theme: b.theme === "dark" ? "dark" : "light",
    template: b.template && TEMPLATES.includes(b.template) ? b.template : "editorial",
    studioName: pick(b.studioName, "Desboard Studio"),
    logoUrl: safeImageUrl(b.logoUrl),
    headline: pick(b.headline, h.title),
    subhead: pick(
      b.subhead,
      h.recipient || h.clientName
        ? `Prepared for ${[h.clientName, h.recipient].filter(Boolean).join(" — ")}`
        : "Project deliverables"
    ),
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

/** Seconds -> "m:ss", or "h:mm:ss" past the hour mark — the format used on every timecode badge and the scrubber readout. */
function fmtTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(sec).padStart(2, "0")}`;
}

/** What the lightbox can render inline for a file. Anything else gets no "View" action at all. */
function previewKind(f: VaultFile): "image" | "pdf" | "video" | null {
  if (!f.hasContent) return null;
  const mime = f.mime || "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/** A file's current version label, or null for files that predate version tracking. */
function currentVersionOf(f: VaultFile): string | null {
  return f.versions.find((v) => v.latest)?.version ?? null;
}

export interface RenderHandoverOpts {
  handover: Handover;
  files: VaultFile[];
  comments?: HandoverComment[];
  /**
   * Server-signed, short-lived download URL per file id. The renderer is pure
   * and cannot sign; without an entry the button renders disabled (e.g. in the
   * studio's live preview iframe).
   */
  downloadHrefs?: Record<string, string>;
  /** Inline "spectate" URL per file id — unsigned, session-cookie-gated, never approval-gated. */
  viewHrefs?: Record<string, string>;
  /** Current per-file approval state for this handover, keyed by file id. */
  approvals?: HandoverApprovals;
}

export function renderHandoverPage({
  handover,
  files,
  comments = [],
  downloadHrefs = {},
  viewHrefs = {},
  approvals = {},
}: RenderHandoverOpts): string {
  const b = effectiveBranding(handover);
  const dark = b.theme === "dark";
  const accent = b.accent;
  const template = b.template;

  // Theme tokens — same cool-neutral identity as the studio app's own design
  // system (src/index.css), not the old warm cream/near-black prototype look.
  const c = dark
    ? { bg: "#0a0a0a", panel: "#1c1c1e", card: "#1c1c1e", text: "#f5f5f7", muted: "rgba(245,245,247,0.55)", border: "rgba(255,255,255,0.09)", chip: "rgba(255,255,255,0.05)" }
    : { bg: "#f5f5f7", panel: "#ffffff", card: "#ffffff", text: "#1d1d1f", muted: "#86868b", border: "#e5e5ea", chip: "#eeeef1" };

  const logo = b.logoUrl
    ? `<img class="logo-img" src="${esc(b.logoUrl)}" alt="${esc(b.studioName)} logo" />`
    : `<span class="logo-text">${esc(b.studioName)}</span>`;

  const filesHtml = files.length
    ? files
        .map((f) => {
          const kind = previewKind(f);
          const approval = approvals[f.id];
          const currentVersion = currentVersionOf(f);
          // A version uploaded after the last review makes that review stale —
          // treated as "needs review again", the historical record stays intact.
          const stale = !!approval && approval.version !== currentVersion;
          const status = approval && !stale ? approval.status : null;
          const href = downloadHrefs[f.id];
          const viewBtn = kind
            ? `<button type="button" class="view-btn" data-file="${esc(f.id)}">View</button>`
            : "";

          let actionHtml: string;
          let noteHtml = "";
          if (handover.status === "Draft") {
            // Matches server/portal.ts's requireSent gate — a Draft's actions
            // are blocked server-side too, so this isn't just cosmetic; it's
            // what keeps a click from silently failing against that 403.
            actionHtml = `<span class="dl dl-off" title="This delivery hasn't been sent yet">Not sent yet</span>`;
          } else if (status === "approved") {
            actionHtml = href
              ? `<a class="dl" href="${esc(href)}" download>Download</a>`
              : `<span class="dl dl-off" title="Available on the live page">Download</span>`;
            noteHtml = `<div class="approved-note">Approved${approval!.approvedBy ? ` by ${esc(approval!.approvedBy)}` : ""} · ${esc(fmtTime(approval!.approvedAt))} · <button type="button" class="link-btn" data-request-changes="${esc(f.id)}">Request changes</button></div>`;
          } else if (status === "changes_requested") {
            actionHtml = `<button type="button" class="approve-btn" data-file="${esc(f.id)}">Approve</button>`;
            noteHtml = `<div class="changes-note">Changes requested${approval!.approvedBy ? ` by ${esc(approval!.approvedBy)}` : ""} · ${esc(fmtTime(approval!.approvedAt))}</div>`;
          } else {
            actionHtml = `<button type="button" class="approve-btn" data-file="${esc(f.id)}">Approve</button><button type="button" class="request-btn" data-file="${esc(f.id)}">Request changes</button>`;
            if (stale) {
              noteHtml = `<div class="stale-note">Updated since ${approval!.approvedBy ? esc(approval!.approvedBy) : "the last"} review${approval!.version ? ` (was ${esc(approval!.version)})` : ""} — needs a fresh look</div>`;
            }
          }

          const rowStatusClass =
            status === "approved" ? " file-approved" : status === "changes_requested" ? " file-changes" : stale ? " file-stale" : "";

          return `
        <div class="file${rowStatusClass}">
          <div class="file-badge">${esc(fileExtLabel(f))}</div>
          <div class="file-info">
            <div class="file-name">${esc(f.name)}</div>
            <div class="file-meta">${esc(f.size || (f.type === "folder" ? "Folder" : "—"))}${f.status ? " &middot; " + esc(f.status) : ""}</div>
            ${noteHtml}
          </div>
          ${handover.status === "Draft" ? "" : `<button type="button" class="note-btn" data-file="${esc(f.id)}">+ Note</button>`}
          ${viewBtn}
          ${actionHtml}
        </div>`;
        })
        .join("")
    : `<div class="empty">No files attached to this handover yet.</div>`;

  // Aggregate approval stats, computed once for the decorative
  // elements a few templates use (stat badge, progress ring, summary
  // line) — a fresh pass rather than folding into the filesHtml map
  // above, so that per-row rendering logic stays untouched.
  const totalCount = files.length;
  const approvedCount = files.filter((f) => {
    const approval = approvals[f.id];
    return !!approval && approval.status === "approved" && approval.version === currentVersionOf(f);
  }).length;
  const approvedPct = totalCount ? Math.round((approvedCount / totalCount) * 100) : 0;

  // A studio/client "route code" pair (3 letters each) for the Boarding
  // Pass template's ticket stub — derived from real names, not fabricated.
  const codeFrom = (b.studioName.replace(/[^a-zA-Z]/g, "").slice(0, 3) || "STU").toUpperCase();
  const codeTo = ((handover.clientName || handover.recipient || "CLT").replace(/[^a-zA-Z]/g, "").slice(0, 3) || "CLT").toUpperCase();

  // A small set of optional, purely decorative blocks — always rendered,
  // hidden by default (CSS `display: none`) and opted into per template.
  // Kept out of the way of every JS-bound element above.
  const heroStatHtml = `<div class="hero-stat"><span class="hero-stat-value">${approvedPct}%</span><span class="hero-stat-label">Cleared</span></div>`;

  const progressRingHtml = `
    <div class="progress-ring" style="background: conic-gradient(var(--accent) ${approvedPct}%, ${c.chip} 0)">
      <div class="progress-ring-inner">
        <span class="progress-ring-value">${approvedCount}/${totalCount}</span>
        <span class="progress-ring-label">approved</span>
      </div>
    </div>`;

  const infoPanelHtml = `
    <aside class="info-panel">
      <div class="info-row"><span class="info-label">Client</span><span class="info-value">${esc(handover.clientName || "—")}</span></div>
      <div class="info-row"><span class="info-label">Company</span><span class="info-value">${esc(handover.recipient || "—")}</span></div>
      <div class="info-row"><span class="info-label">Issued</span><span class="info-value">${esc(handover.created)}</span></div>
      <div class="info-row"><span class="info-label">Items</span><span class="info-value">${totalCount}</span></div>
      <div class="info-row"><span class="info-label">Signed</span><span class="info-value">${approvedCount} of ${totalCount}</span></div>
      <div class="info-codes"><span class="info-code">${esc(codeFrom)}</span><span class="info-code-arrow">&rarr;</span><span class="info-code">${esc(codeTo)}</span></div>
      <div class="info-barcode" aria-hidden="true"></div>
    </aside>`;

  const fileTableHeadHtml = `<div class="file-table-head"><span>Item</span><span>Format</span><span>Status</span></div>`;

  const fileSummaryHtml = `<p class="file-summary">Total items ${totalCount} &middot; Approved ${approvedCount} &middot; Outstanding ${totalCount - approvedCount}</p>`;

  const signatureHtml = `
    <div class="signature-line">
      <div class="signature-field"><span class="signature-label">Signature</span></div>
      <div class="signature-field"><span class="signature-label">Date</span></div>
    </div>`;

  const nameById = (id?: string | null) => (id ? files.find((f) => f.id === id)?.name ?? "a file" : "");

  const commentsHtml = comments.length
    ? comments
        .map((cm) => {
          const isDesigner = cm.role === "designer";
          const roleLabel = isDesigner ? "Studio" : "Client";
          const isPin = cm.fileId && typeof cm.x === "number" && typeof cm.y === "number";
          const isTimePin = cm.fileId && typeof cm.timecode === "number";
          const chipAttrs = isPin
            ? `data-pin-file="${esc(cm.fileId)}"`
            : isTimePin
              ? `data-pin-file="${esc(cm.fileId)}" data-pin-time="${cm.timecode}"`
              : "";
          const chipLabel = isPin
            ? "📍 pinned on "
            : isTimePin
              ? `🎬 at ${esc(fmtTimecode(cm.timecode as number))} in `
              : "on ";
          const onChip = cm.fileId
            ? `<span class="on" ${chipAttrs ? `${chipAttrs} role="button" tabindex="0"` : ""}>${chipLabel}${esc(nameById(cm.fileId))}</span>`
            : "";
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

    ${
      handover.status === "Draft"
        ? `<p class="disc-sub">Notes open once this delivery has been sent.</p>`
        : `<form id="composer" class="composer">
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
    </form>`
    }`;

  const lightboxHtml = `
    <div id="lightbox" class="lightbox" aria-hidden="true">
      <div class="lb-topbar">
        <div class="lb-title-group">
          <span id="lb-title" class="lb-title"></span>
          <select id="lb-version-picker" class="lb-version-picker" style="display:none" aria-label="File version"></select>
        </div>
        <div class="lb-actions">
          <span id="lb-old-version-note" class="lb-old-version-note" style="display:none">Viewing an earlier version</span>
          <span id="lb-approved" class="lb-approved-note" style="display:none"></span>
          <button type="button" id="lb-approve" class="approve-btn">Approve</button>
          <button type="button" id="lb-request-changes" class="request-btn">Request changes</button>
          <a id="lb-download" class="dl" style="display:none" download>Download</a>
          <button type="button" id="lb-panel-toggle" class="lb-panel-toggle" aria-label="Toggle notes panel">
            <span id="lb-panel-count" class="lb-panel-count">0</span> Notes
          </button>
          <button type="button" id="lb-close" class="lb-close" aria-label="Close preview">✕</button>
        </div>
      </div>
      <div class="lb-main">
        <div class="lb-stage-col">
          <div id="lb-stage" class="lb-stage"></div>
          <p id="lb-hint" class="lb-hint">Click anywhere on the image to leave feedback at that point.</p>
        </div>
        <div id="lb-panel" class="lb-panel">
          <div class="lb-panel-head">
            <span>Pinned notes</span>
          </div>
          <div id="lb-panel-list" class="lb-panel-list"></div>
        </div>
      </div>
      <div id="lb-pin-composer" class="pin-composer" hidden>
        <input id="lb-pin-name" class="c-input" type="text" placeholder="Your name" />
        <textarea id="lb-pin-body" class="c-input c-area" rows="2" placeholder="What do you see here?"></textarea>
        <div class="pin-composer-actions">
          <button type="button" id="lb-pin-cancel" class="lb-cancel-btn">Cancel</button>
          <button type="button" id="lb-pin-post" class="post-btn">Post pin</button>
        </div>
      </div>
    </div>`;

  // Per-file data the lightbox needs client-side: preview kind, urls, approval
  // state, and comment bodies (client-submitted — must go through jsonScript,
  // not a raw template literal, since this lands inside a <script> tag).
  const fileMeta: Record<
    string,
    {
      name: string;
      kind: "image" | "pdf" | "video" | null;
      viewHref: string | null;
      downloadHref: string | null;
      status: "approved" | "changes_requested" | null;
      versions: { version: string; date: string; author: string; latest?: boolean }[];
      currentVersion: string | null;
    }
  > = {};
  files.forEach((f) => {
    const approval = approvals[f.id];
    const current = currentVersionOf(f);
    const stale = !!approval && approval.version !== current;
    fileMeta[f.id] = {
      name: f.name,
      kind: previewKind(f),
      viewHref: viewHrefs[f.id] ?? null,
      downloadHref: downloadHrefs[f.id] ?? null,
      status: approval && !stale ? approval.status : null,
      versions: f.versions,
      currentVersion: current,
    };
  });
  const pins = comments
    .filter((cm): cm is HandoverComment & { fileId: string; x: number; y: number } => !!cm.fileId && typeof cm.x === "number" && typeof cm.y === "number")
    .map((cm) => ({ id: cm.id, fileId: cm.fileId, x: cm.x, y: cm.y, author: cm.author, body: cm.body, created: cm.created, version: cm.version ?? null }));
  const videoPins = comments
    .filter((cm): cm is HandoverComment & { fileId: string; timecode: number } => !!cm.fileId && typeof cm.timecode === "number")
    .map((cm) => ({ id: cm.id, fileId: cm.fileId, timecode: cm.timecode, author: cm.author, body: cm.body, created: cm.created, version: cm.version ?? null }));

  const commentScript = `
    <script>
    (function(){
      var TOKEN = ${jsonScript(handover.token)};
      var COMMENTS_API = ${jsonScript(`/api/portal/${handover.token}/comments`)};
      var APPROVE_API_BASE = ${jsonScript(`/api/portal/${handover.token}/file/`)};
      var FILE_META = ${jsonScript(fileMeta)};
      var PINS = ${jsonScript(pins)};
      var VIDEO_PINS = ${jsonScript(videoPins)};
      var CLIENT_NAME = ${jsonScript(handover.clientName || "")};

      function savedName(){
        try { return localStorage.getItem('desboard_handover_name') || CLIENT_NAME || ''; } catch(e){ return CLIENT_NAME || ''; }
      }
      function saveName(v){
        try { if (v) localStorage.setItem('desboard_handover_name', v); } catch(e){}
      }

      // --- First-visit "how this works" panel ------------------------------
      // Scoped per handover (not global): a client who's dismissed this on one
      // project shouldn't have it silently skip on a completely different one.
      // A small step-through, not a wall of text — one idea at a time, dots
      // and Back/Next (plus arrow keys) to move around, closable at any point.
      var INTRO_KEY = 'desboard_handover_intro_seen_' + TOKEN;
      var introBox = document.getElementById('intro-box');
      if (introBox) {
        var introSeen = false;
        try { introSeen = localStorage.getItem(INTRO_KEY) === '1'; } catch(e){}
        if (introSeen) {
          introBox.style.display = 'none';
        } else {
          var introClose = document.getElementById('intro-close');
          var introBack = document.getElementById('intro-back');
          var introNext = document.getElementById('intro-next');
          var introCount = document.getElementById('intro-count');
          var introBarFill = document.getElementById('intro-bar-fill');
          var introSteps = introBox.querySelectorAll('.intro-step');
          var introDots = introBox.querySelectorAll('.intro-dot');
          var introTotal = introSteps.length;
          var introIndex = 0;

          function dismissIntro(){
            introBox.style.display = 'none';
            try { localStorage.setItem(INTRO_KEY, '1'); } catch(e){}
          }

          function renderIntro(){
            Array.prototype.forEach.call(introSteps, function(el, i){
              if (i === introIndex) {
                el.style.display = 'block';
                el.classList.remove('intro-anim');
                void el.offsetWidth; // restart the CSS animation
                el.classList.add('intro-anim');
              } else {
                el.style.display = 'none';
              }
            });
            Array.prototype.forEach.call(introDots, function(d, i){
              if (i === introIndex) d.classList.add('active'); else d.classList.remove('active');
            });
            if (introBarFill) introBarFill.style.width = (((introIndex + 1) / introTotal) * 100) + '%';
            if (introCount) introCount.textContent = (introIndex + 1) + ' / ' + introTotal;
            if (introBack) introBack.hidden = introIndex === 0;
            if (introNext) introNext.textContent = introIndex === introTotal - 1 ? 'Got it' : 'Next';
          }

          function introGoTo(i){
            introIndex = Math.max(0, Math.min(introTotal - 1, i));
            renderIntro();
          }

          if (introClose) introClose.addEventListener('click', dismissIntro);
          if (introBack) introBack.addEventListener('click', function(){ introGoTo(introIndex - 1); });
          if (introNext) {
            introNext.addEventListener('click', function(){
              if (introIndex === introTotal - 1) dismissIntro(); else introGoTo(introIndex + 1);
            });
          }
          Array.prototype.forEach.call(introDots, function(d, i){
            d.addEventListener('click', function(){ introGoTo(i); });
          });
          document.addEventListener('keydown', function(e){
            if (introBox.style.display === 'none') return;
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'ArrowRight') introGoTo(introIndex + 1);
            if (e.key === 'ArrowLeft') introGoTo(introIndex - 1);
          });

          renderIntro();
        }
      }

      // --- General / "+Note" composer -------------------------------------
      var form = document.getElementById('composer');
      var nameEl = document.getElementById('c-name');
      var bodyEl = document.getElementById('c-body');
      var fileEl = document.getElementById('c-file');
      if (nameEl) nameEl.value = savedName();

      Array.prototype.forEach.call(document.querySelectorAll('.note-btn'), function(btn){
        btn.addEventListener('click', function(){
          if(fileEl) fileEl.value = btn.getAttribute('data-file') || '';
          if(bodyEl){ bodyEl.focus(); }
          if(form) form.scrollIntoView({behavior:'smooth', block:'center'});
        });
      });

      function postComment(payload, onDone){
        return fetch(COMMENTS_API, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        }).then(function(r){ if(!r.ok) throw new Error('failed'); return r.json(); }).then(onDone);
      }

      if (form) {
        form.addEventListener('submit', function(e){
          e.preventDefault();
          var author = (nameEl && nameEl.value || '').trim() || 'Client';
          var body = (bodyEl && bodyEl.value || '').trim();
          var fileId = fileEl ? fileEl.value : '';
          if(!body) return;
          saveName(author);
          var btn = form.querySelector('.post-btn');
          if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
          postComment({author:author, body:body, fileId: fileId || null}, function(){
            location.reload();
          }).catch(function(){ if(btn){ btn.disabled=false; btn.textContent='Post note'; } alert('Could not send your note. Please try again.'); });
        });
      }

      // --- Approve / Request changes (inline row buttons) --------------------
      function approveFile(fileId, onDone){
        return fetch(APPROVE_API_BASE + encodeURIComponent(fileId) + '/approve', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ approvedBy: savedName() || 'Client' })
        }).then(function(r){ if(!r.ok) throw new Error('failed'); return r.json(); }).then(onDone);
      }

      // A native prompt rather than another full composer widget — this is a
      // quick, occasional action, not the primary feedback surface (that's
      // pins and the Discussion thread below).
      function requestChanges(fileId, onDone){
        var reason = window.prompt('What needs to change?');
        if (reason === null) return;
        fetch(APPROVE_API_BASE + encodeURIComponent(fileId) + '/request-changes', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ requestedBy: savedName() || 'Client', body: reason })
        }).then(function(r){ if(!r.ok) throw new Error('failed'); return r.json(); }).then(onDone)
          .catch(function(){ alert('Could not send that. Please try again.'); });
      }

      Array.prototype.forEach.call(document.querySelectorAll('.approve-btn'), function(btn){
        btn.addEventListener('click', function(){
          var fileId = btn.getAttribute('data-file');
          if(!fileId) return;
          btn.disabled = true;
          btn.textContent = 'Approving…';
          approveFile(fileId, function(){
            location.hash = 'view=' + encodeURIComponent(fileId);
            location.reload();
          }).catch(function(){ btn.disabled = false; btn.textContent = 'Approve'; alert('Could not approve this file. Please try again.'); });
        });
      });

      Array.prototype.forEach.call(document.querySelectorAll('.request-btn, [data-request-changes]'), function(btn){
        btn.addEventListener('click', function(){
          var fileId = btn.getAttribute('data-file') || btn.getAttribute('data-request-changes');
          if(!fileId) return;
          requestChanges(fileId, function(){
            location.hash = 'view=' + encodeURIComponent(fileId);
            location.reload();
          });
        });
      });

      // --- Lightbox ("spectate" + pin-on-image) -----------------------------
      var lightbox = document.getElementById('lightbox');
      var stage = document.getElementById('lb-stage');
      var lbTitle = document.getElementById('lb-title');
      var lbHint = document.getElementById('lb-hint');
      var lbApprove = document.getElementById('lb-approve');
      var lbRequestChanges = document.getElementById('lb-request-changes');
      var lbApprovedNote = document.getElementById('lb-approved');
      var lbDownload = document.getElementById('lb-download');
      var lbClose = document.getElementById('lb-close');
      var pinComposer = document.getElementById('lb-pin-composer');
      var pinNameEl = document.getElementById('lb-pin-name');
      var pinBodyEl = document.getElementById('lb-pin-body');
      var pinCancelBtn = document.getElementById('lb-pin-cancel');
      var pinPostBtn = document.getElementById('lb-pin-post');
      var currentFileId = null;
      var pendingPin = null;
      // True once a pin/comment has actually been posted during this lightbox
      // session — the Discussion thread and file-list rows live outside the
      // lightbox and aren't updated live, so a resync reload is deferred to
      // when the lightbox closes instead of firing after every single post
      // (which is what made posting a pin feel like a page reload before).
      var dirty = false;

      function makeMarkerEl(x, y, label, pending){
        var marker = document.createElement('button');
        marker.type = 'button';
        marker.className = pending ? 'pin-marker pending' : 'pin-marker';
        marker.style.left = x + '%';
        marker.style.top = y + '%';
        marker.textContent = label;
        return marker;
      }

      /** A pin with no stored version predates this feature — treat it as belonging to whatever's current, same as it always displayed before versions were tracked per-pin. */
      function pinVersionOf(p, fileId){
        var meta = FILE_META[fileId];
        return p.version || (meta && meta.currentVersion) || null;
      }
      function pinMatchesVersion(p, fileId, version){
        var meta = FILE_META[fileId];
        var target = version || (meta && meta.currentVersion) || null;
        return pinVersionOf(p, fileId) === target;
      }

      function renderPins(fileId, version){
        var wrap = stage.querySelector('.lb-image-wrap');
        if (!wrap) return;
        Array.prototype.forEach.call(wrap.querySelectorAll('.pin-marker'), function(el){ el.remove(); });
        var n = 0;
        PINS.filter(function(p){ return p.fileId === fileId && pinMatchesVersion(p, fileId, version); }).forEach(function(p){
          n += 1;
          var marker = makeMarkerEl(p.x, p.y, String(n), false);
          marker.title = p.author + ': ' + p.body;
          marker.addEventListener('click', function(e){
            e.stopPropagation();
            focusNote(p.id);
          });
          wrap.appendChild(marker);
        });
        renderPanel(fileId);
      }

      /** The not-yet-posted pin — a distinct dashed/pulsing marker so it never reads as an already-confirmed one. */
      function renderPendingPin(x, y){
        var wrap = stage.querySelector('.lb-image-wrap');
        if (!wrap) return;
        var existing = wrap.querySelector('.pin-marker.pending');
        if (existing) existing.remove();
        wrap.appendChild(makeMarkerEl(x, y, '+', true));
      }

      // --- Video timeline (timecode pins) -------------------------------------
      function fmtT(totalSeconds){
        var s = Math.max(0, Math.floor(totalSeconds || 0));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
        return (h > 0 ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
      }

      function makeTimeMarkerEl(pct, label, pending){
        var marker = document.createElement('button');
        marker.type = 'button';
        marker.className = pending ? 'time-marker pending' : 'time-marker';
        marker.style.left = pct + '%';
        marker.textContent = label;
        return marker;
      }

      function renderVideoPins(fileId, duration, version){
        var track = stage.querySelector('.lb-timeline-track');
        if (!track || !duration) return;
        Array.prototype.forEach.call(track.querySelectorAll('.time-marker'), function(el){ el.remove(); });
        var n = 0;
        VIDEO_PINS.filter(function(p){ return p.fileId === fileId && pinMatchesVersion(p, fileId, version); }).forEach(function(p){
          n += 1;
          var pct = Math.max(0, Math.min(100, (p.timecode / duration) * 100));
          var marker = makeTimeMarkerEl(pct, String(n), false);
          marker.title = fmtT(p.timecode) + ' — ' + p.author + ': ' + p.body;
          marker.addEventListener('click', function(e){
            e.stopPropagation();
            var video = stage.querySelector('.lb-video');
            if (video) { video.currentTime = p.timecode; }
            focusNote(p.id);
          });
          track.appendChild(marker);
        });
        renderPanel(fileId);
      }

      /** The not-yet-posted timecode pin, pinned to the current playhead position on the scrubber. */
      function renderPendingVideoPin(timecode, duration){
        var track = stage.querySelector('.lb-timeline-track');
        if (!track || !duration) return;
        var existing = track.querySelector('.time-marker.pending');
        if (existing) existing.remove();
        var pct = Math.max(0, Math.min(100, (timecode / duration) * 100));
        track.appendChild(makeTimeMarkerEl(pct, '+', true));
      }

      // --- Notes panel: every pin on the open file, in one readable list ---------
      var panelListEl = document.getElementById('lb-panel-list');
      var panelEl = document.getElementById('lb-panel');
      var panelCountEl = document.getElementById('lb-panel-count');
      var panelToggleBtn = document.getElementById('lb-panel-toggle');
      var panelOpen = true;

      function fmtNoteTime(iso){
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }

      function isMine(author){
        var mine = savedName().trim().toLowerCase();
        return !!mine && (author || '').trim().toLowerCase() === mine;
      }

      /** Scroll a note's panel entry into view and flash it — clicking a marker on the media surfaces its note this way. */
      function focusNote(commentId){
        var el = panelListEl && panelListEl.querySelector('[data-note-id="' + commentId + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          el.classList.add('highlight');
          setTimeout(function(){ el.classList.remove('highlight'); }, 1400);
        }
      }

      function flashMarkerFor(fileId, commentId){
        var isImg = PINS.some(function(p){ return p.id === commentId; });
        // Same filter renderPins/renderVideoPins used to build the markers
        // actually on screen right now, so the index lines up.
        var list = (isImg ? PINS : VIDEO_PINS).filter(function(p){ return p.fileId === fileId && pinMatchesVersion(p, fileId, currentViewVersion); });
        var idx = list.findIndex ? list.findIndex(function(p){ return p.id === commentId; }) : -1;
        if (idx < 0) return;
        var selector = isImg ? '.pin-marker' : '.time-marker';
        var markers = stage.querySelectorAll(selector + ':not(.pending)');
        var marker = markers[idx];
        if (marker) {
          marker.classList.add('flash');
          setTimeout(function(){ marker.classList.remove('flash'); }, 900);
        }
      }

      function patchCommentReq(id, body){
        return fetch(COMMENTS_API + '/' + encodeURIComponent(id), {
          method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ body: body })
        }).then(function(r){ if(!r.ok) throw new Error('failed'); return r.json(); });
      }

      function deleteCommentReq(id){
        return fetch(COMMENTS_API + '/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function(r){ if(!r.ok) throw new Error('failed'); });
      }

      function renderPanel(fileId){
        if (!panelListEl) return;
        var meta = FILE_META[fileId];
        var imagePins = PINS.filter(function(p){ return p.fileId === fileId; });
        var videoPinsForFile = VIDEO_PINS.filter(function(p){ return p.fileId === fileId; });
        var isImg = imagePins.length > 0 || (meta && meta.kind === 'image');
        // Every pin on this file, every version — a pin left on an earlier
        // round doesn't disappear when a new one is uploaded, it just carries
        // a badge showing which version it's actually about.
        var list = (isImg ? imagePins : videoPinsForFile).slice()
          .sort(function(a, b){ return String(a.created||'').localeCompare(String(b.created||'')); });

        if (panelCountEl) panelCountEl.textContent = String(list.length);
        panelListEl.innerHTML = '';

        if (list.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'lb-panel-empty';
          empty.textContent = 'No pins yet. Click the image — or use "Comment here" on a video — to leave one.';
          panelListEl.appendChild(empty);
          return;
        }

        // Sequential numbers for images only make sense — and only stay
        // aligned with the on-media markers — among pins on the version
        // actually being displayed right now.
        var currentVersionList = list.filter(function(p){ return pinMatchesVersion(p, fileId, currentViewVersion); });

        list.forEach(function(p){
          var note = document.createElement('div');
          note.className = 'lb-note';
          note.setAttribute('data-note-id', p.id);
          var matchesCurrent = pinMatchesVersion(p, fileId, currentViewVersion);
          var pinVersion = pinVersionOf(p, fileId);

          var head = document.createElement('div');
          head.className = 'lb-note-head';
          var badge = document.createElement('span');
          badge.className = 'lb-note-badge';
          if (isImg) {
            badge.textContent = matchesCurrent ? String(currentVersionList.indexOf(p) + 1) : (pinVersion || '?');
          } else {
            badge.textContent = fmtT(p.timecode);
          }
          var author = document.createElement('span');
          author.className = 'lb-note-author';
          author.textContent = p.author;
          head.appendChild(badge);
          head.appendChild(author);
          if (!matchesCurrent && pinVersion) {
            var versionChip = document.createElement('span');
            versionChip.className = 'lb-note-version';
            versionChip.textContent = pinVersion;
            head.appendChild(versionChip);
          }
          var time = document.createElement('span');
          time.className = 'lb-note-time';
          time.textContent = p.created ? fmtNoteTime(p.created) : '';
          head.appendChild(time);

          var body = document.createElement('div');
          body.className = 'lb-note-body';
          body.textContent = p.body;

          note.appendChild(head);
          note.appendChild(body);

          note.addEventListener('click', function(){
            if (!matchesCurrent) {
              // Jump to the version this pin actually belongs to — for video,
              // land right on its timecode the moment that round loads.
              switchVersion(fileId, pinVersion, isImg ? undefined : p.timecode);
              return;
            }
            if (!isImg) {
              var video = stage.querySelector('.lb-video');
              if (video) video.currentTime = p.timecode;
            }
            flashMarkerFor(fileId, p.id);
          });

          if (isMine(p.author)) {
            var actions = document.createElement('div');
            actions.className = 'lb-note-actions';
            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'lb-note-action';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', function(e){
              e.stopPropagation();
              startEditNote(note, p, fileId);
            });
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'lb-note-action danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', function(e){
              e.stopPropagation();
              if (!window.confirm('Delete this note? This can\\'t be undone.')) return;
              deleteCommentReq(p.id).then(function(){
                if (isImg) { PINS = PINS.filter(function(x){ return x.id !== p.id; }); renderPins(fileId, currentViewVersion); }
                else { VIDEO_PINS = VIDEO_PINS.filter(function(x){ return x.id !== p.id; }); var v = stage.querySelector('.lb-video'); renderVideoPins(fileId, v ? v.duration : 0, currentViewVersion); }
                dirty = true;
              }).catch(function(){ alert('Could not delete this note. Please try again.'); });
            });
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            note.appendChild(actions);
          }

          panelListEl.appendChild(note);
        });
      }

      function startEditNote(noteEl, p, fileId){
        var body = noteEl.querySelector('.lb-note-body');
        var actions = noteEl.querySelector('.lb-note-actions');
        if (!body) return;
        var textarea = document.createElement('textarea');
        textarea.className = 'lb-note-edit-area';
        textarea.rows = 3;
        textarea.value = p.body;
        body.replaceWith(textarea);
        textarea.focus();
        if (actions) actions.style.display = 'none';

        var editActions = document.createElement('div');
        editActions.className = 'lb-note-edit-actions';
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'lb-note-edit-cancel';
        cancelBtn.textContent = 'Cancel';
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'lb-note-edit-save';
        saveBtn.textContent = 'Save';
        editActions.appendChild(cancelBtn);
        editActions.appendChild(saveBtn);
        textarea.insertAdjacentElement('afterend', editActions);

        cancelBtn.addEventListener('click', function(e){ e.stopPropagation(); renderPanel(fileId); });
        saveBtn.addEventListener('click', function(e){
          e.stopPropagation();
          var newBody = textarea.value.trim();
          if (!newBody) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          patchCommentReq(p.id, newBody).then(function(updated){
            var isImg = PINS.some(function(x){ return x.id === p.id; });
            if (isImg) PINS = PINS.map(function(x){ return x.id === p.id ? Object.assign({}, x, { body: updated.body }) : x; });
            else VIDEO_PINS = VIDEO_PINS.map(function(x){ return x.id === p.id ? Object.assign({}, x, { body: updated.body }) : x; });
            dirty = true;
            renderPanel(fileId);
            // Marker tooltips embed the note body — refresh so hover text agrees with the edit.
            if (isImg) renderPins(fileId, currentViewVersion); else { var v = stage.querySelector('.lb-video'); renderVideoPins(fileId, v ? v.duration : 0, currentViewVersion); }
          }).catch(function(){ saveBtn.disabled = false; saveBtn.textContent = 'Save'; alert('Could not save your edit. Please try again.'); });
        });
      }

      if (panelToggleBtn) panelToggleBtn.addEventListener('click', function(){
        panelOpen = !panelOpen;
        if (panelEl) panelEl.classList.toggle('collapsed', !panelOpen);
        panelToggleBtn.classList.toggle('active', panelOpen);
      });

      /** Places the composer as a small popover right next to the click, clamped to stay on-screen. */
      function positionPinComposer(vx, vy){
        if (!pinComposer) return;
        pinComposer.hidden = false;
        var pad = 16;
        var w = pinComposer.offsetWidth || 280;
        var h = pinComposer.offsetHeight || 160;
        var left = vx + pad;
        var top = vy + pad;
        if (left + w > window.innerWidth - pad) left = vx - w - pad;
        if (left < pad) left = pad;
        if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
        if (top < pad) top = pad;
        pinComposer.style.left = left + 'px';
        pinComposer.style.top = top + 'px';
      }

      function closePinComposer(){
        pendingPin = null;
        if (pinComposer) pinComposer.hidden = true;
        if (pinBodyEl) pinBodyEl.value = '';
        var imgWrap = stage.querySelector('.lb-image-wrap');
        var pendingImg = imgWrap && imgWrap.querySelector('.pin-marker.pending');
        if (pendingImg) pendingImg.remove();
        var track = stage.querySelector('.lb-timeline-track');
        var pendingTime = track && track.querySelector('.time-marker.pending');
        if (pendingTime) pendingTime.remove();
      }

      /** currentTime -> [seconds, whole video] as a 0-100 percentage, clamped. */
      function pct(current, duration){
        if (!duration) return 0;
        return Math.max(0, Math.min(100, (current / duration) * 100));
      }

      function buildVideoPlayer(meta, fileId, version, startTime){
        var wrap = document.createElement('div');
        wrap.className = 'lb-video-wrap';

        var video = document.createElement('video');
        video.src = versionedUrl(meta, version);
        video.className = 'lb-video';
        video.preload = 'metadata';
        video.controls = false;
        video.disablePictureInPicture = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
        wrap.appendChild(video);

        var bar = document.createElement('div');
        bar.className = 'lb-video-bar';

        var playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'lb-play-btn';
        playBtn.setAttribute('aria-label', 'Play');
        playBtn.innerHTML = '▶';

        var timeEl = document.createElement('span');
        timeEl.className = 'lb-time-readout';
        timeEl.textContent = '0:00 / 0:00';

        var trackWrap = document.createElement('div');
        trackWrap.className = 'lb-timeline-wrap';
        var track = document.createElement('div');
        track.className = 'lb-timeline-track';
        var fill = document.createElement('div');
        fill.className = 'lb-timeline-fill';
        var head = document.createElement('div');
        head.className = 'lb-timeline-head';
        track.appendChild(fill);
        track.appendChild(head);
        trackWrap.appendChild(track);

        var commentBtn = document.createElement('button');
        commentBtn.type = 'button';
        commentBtn.className = 'lb-comment-here-btn';
        commentBtn.textContent = '+ Comment here';

        bar.appendChild(playBtn);
        bar.appendChild(timeEl);
        bar.appendChild(trackWrap);
        bar.appendChild(commentBtn);
        wrap.appendChild(bar);

        function togglePlay(){
          if (video.paused) video.play(); else video.pause();
        }
        playBtn.addEventListener('click', togglePlay);
        video.addEventListener('click', togglePlay);
        video.addEventListener('play', function(){ playBtn.innerHTML = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); });
        video.addEventListener('pause', function(){ playBtn.innerHTML = '▶'; playBtn.setAttribute('aria-label', 'Play'); });

        function syncTime(){
          var d = video.duration || 0;
          fill.style.width = pct(video.currentTime, d) + '%';
          head.style.left = pct(video.currentTime, d) + '%';
          timeEl.textContent = fmtT(video.currentTime) + ' / ' + fmtT(d);
        }
        video.addEventListener('timeupdate', syncTime);
        video.addEventListener('loadedmetadata', function(){
          syncTime();
          renderVideoPins(fileId, video.duration, version);
          if (typeof startTime === 'number' && isFinite(startTime)) {
            video.currentTime = Math.min(startTime, video.duration || startTime);
          }
        });

        // Scrubbing: click or drag anywhere on the track seeks. Dragging (not
        // just clicking) is what makes fine-grained frame-hunting feel right —
        // a single click alone is too coarse once a video is more than a few
        // seconds long. Listens on the padded wrapper, not the 4px visual
        // line itself — that line is a target nobody, mouse or finger, could
        // reliably hit; the padding around it is the real hit area.
        var scrubbing = false;
        function seekFromEvent(e){
          var rect = track.getBoundingClientRect();
          var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          video.currentTime = ratio * (video.duration || 0);
        }
        trackWrap.addEventListener('pointerdown', function(e){
          if (e.target !== track && e.target !== fill && e.target !== head && e.target !== trackWrap) return; // let marker clicks through
          scrubbing = true;
          seekFromEvent(e);
        });
        window.addEventListener('pointermove', function(e){ if (scrubbing) seekFromEvent(e); });
        window.addEventListener('pointerup', function(){ scrubbing = false; });

        // "+ Comment here" drops a pin at the current playhead — scrub to the
        // right frame first, then comment, rather than asking one click to do
        // both (a precise single click is a much harder target on a timeline
        // than on a still image).
        commentBtn.addEventListener('click', function(e){
          video.pause();
          var t = video.currentTime;
          pendingPin = { timecode: t, version: version || meta.currentVersion };
          renderPendingVideoPin(t, video.duration);
          var btnRect = commentBtn.getBoundingClientRect();
          positionPinComposer(btnRect.left, btnRect.top);
          if (pinNameEl && !pinNameEl.value) pinNameEl.value = savedName();
          if (pinBodyEl) pinBodyEl.focus();
        });

        return wrap;
      }

      /** meta.viewHref, pointed at a specific version when it isn't the current one — the version picker's whole mechanism. */
      function versionedUrl(meta, version){
        if (!meta.viewHref) return null;
        if (!version || version === meta.currentVersion) return meta.viewHref;
        return meta.viewHref + '?v=' + encodeURIComponent(version);
      }

      var versionPicker = document.getElementById('lb-version-picker');
      var lbOldVersionNote = document.getElementById('lb-old-version-note');
      var currentViewVersion = null; // null = latest/current

      function populateVersionPicker(fileId){
        var meta = FILE_META[fileId];
        if (!versionPicker) return;
        versionPicker.innerHTML = '';
        if (!meta || !meta.versions || meta.versions.length < 2) { versionPicker.style.display = 'none'; return; }
        // f.versions is already newest-first (new uploads are unshifted onto the front).
        meta.versions.forEach(function(v){
          var opt = document.createElement('option');
          opt.value = v.version;
          opt.textContent = v.version + (v.latest ? ' (Latest)' : '');
          versionPicker.appendChild(opt);
        });
        versionPicker.value = meta.currentVersion || meta.versions[0].version;
        versionPicker.style.display = '';
      }

      /** Renders the file's media + pins for one specific version into the stage — reused by both first-open and switching versions in place. */
      function renderStage(fileId, version, startTime){
        var meta = FILE_META[fileId];
        if (!meta || !stage) return;
        currentViewVersion = version || null;
        closePinComposer();
        stage.innerHTML = '';
        var viewingLatest = !version || version === meta.currentVersion;
        if (lbOldVersionNote) lbOldVersionNote.style.display = viewingLatest ? 'none' : '';

        var pinnable = meta.kind === 'image' || meta.kind === 'video';
        if (panelToggleBtn) panelToggleBtn.style.display = pinnable ? '' : 'none';
        if (!pinnable && panelListEl) { panelListEl.innerHTML = ''; if (panelCountEl) panelCountEl.textContent = '0'; }

        if (meta.kind === 'image' && meta.viewHref) {
          var wrap = document.createElement('div');
          wrap.className = 'lb-image-wrap';
          var img = document.createElement('img');
          img.src = versionedUrl(meta, version);
          img.alt = meta.name;
          img.addEventListener('click', function(e){
            var rect = img.getBoundingClientRect();
            var x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
            var y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
            // Re-clicking while the composer is already open just moves the
            // pin to the new spot — the typed draft is left alone, this is
            // fine-tuning placement, not starting over.
            pendingPin = { x: x, y: y, version: version || meta.currentVersion };
            renderPendingPin(x, y);
            positionPinComposer(e.clientX, e.clientY);
            if (pinNameEl && !pinNameEl.value) pinNameEl.value = savedName();
            if (pinBodyEl) pinBodyEl.focus();
          });
          wrap.appendChild(img);
          stage.appendChild(wrap);
          renderPins(fileId, version);
          if (lbHint) lbHint.style.display = '';
        } else if (meta.kind === 'pdf' && meta.viewHref) {
          var frame = document.createElement('iframe');
          frame.src = versionedUrl(meta, version);
          frame.title = meta.name;
          frame.className = 'lb-pdf-frame';
          stage.appendChild(frame);
          if (lbHint) lbHint.style.display = 'none';
        } else if (meta.kind === 'video' && meta.viewHref) {
          stage.appendChild(buildVideoPlayer(meta, fileId, version, startTime));
          if (lbHint) lbHint.style.display = 'none';
        } else {
          var msg = document.createElement('div');
          msg.className = 'lb-no-preview';
          msg.textContent = 'No inline preview available for this file.';
          stage.appendChild(msg);
          if (lbHint) lbHint.style.display = 'none';
        }

        // Approving/requesting changes always targets the current deliverable,
        // not a specific past round — so those actions are only offered while
        // actually looking at the latest version.
        if (!viewingLatest) {
          lbApprove.style.display = 'none';
          lbRequestChanges.style.display = 'none';
          lbApprovedNote.style.display = 'none';
          lbDownload.style.display = 'none';
        } else if (meta.status === 'approved') {
          lbApprove.style.display = 'none';
          lbRequestChanges.style.display = '';
          lbApprovedNote.style.display = '';
          lbApprovedNote.textContent = 'Approved';
          if (meta.downloadHref) {
            lbDownload.href = meta.downloadHref;
            lbDownload.style.display = '';
          } else {
            lbDownload.style.display = 'none';
          }
        } else if (meta.status === 'changes_requested') {
          lbApprove.style.display = '';
          lbRequestChanges.style.display = 'none';
          lbApprovedNote.style.display = '';
          lbApprovedNote.textContent = 'Changes requested';
          lbDownload.style.display = 'none';
        } else {
          lbApprove.style.display = '';
          lbRequestChanges.style.display = '';
          lbApprovedNote.style.display = 'none';
          lbDownload.style.display = 'none';
        }
      }

      /** Switches the version picker to the given version and reloads the media in place — what a panel note from an earlier round, or the picker itself, calls. */
      function switchVersion(fileId, version, startTime){
        if (versionPicker) versionPicker.value = version || (FILE_META[fileId] && FILE_META[fileId].currentVersion) || '';
        renderStage(fileId, version, startTime);
      }

      if (versionPicker) versionPicker.addEventListener('change', function(){
        switchVersion(currentFileId, versionPicker.value);
      });

      function openLightbox(fileId, startTime){
        var meta = FILE_META[fileId];
        if (!meta || !lightbox || !stage) return;
        currentFileId = fileId;
        lbTitle.textContent = meta.name;
        populateVersionPicker(fileId);
        panelOpen = true;
        if (panelEl) panelEl.classList.remove('collapsed');
        if (panelToggleBtn) panelToggleBtn.classList.add('active');
        renderStage(fileId, null, startTime);

        lightbox.classList.add('open');
        lightbox.setAttribute('aria-hidden', 'false');
      }

      function closeLightbox(){
        if (!lightbox) return;
        lightbox.classList.remove('open');
        lightbox.setAttribute('aria-hidden', 'true');
        currentFileId = null;
        closePinComposer();
        if (location.hash.indexOf('#view=') === 0) {
          history.replaceState(null, '', location.pathname + location.search);
        }
        // Pins post instantly without a reload while the lightbox is open (see
        // the post handler above) — the Discussion thread and file-list rows
        // behind the lightbox don't know about that yet, so catch them up
        // once, here, instead of on every single pin.
        if (dirty) location.reload();
      }

      Array.prototype.forEach.call(document.querySelectorAll('.view-btn'), function(btn){
        btn.addEventListener('click', function(){
          var fileId = btn.getAttribute('data-file');
          if (fileId) openLightbox(fileId);
        });
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-pin-file]'), function(el){
        el.addEventListener('click', function(){
          var t = el.getAttribute('data-pin-time');
          openLightbox(el.getAttribute('data-pin-file'), t !== null ? parseFloat(t) : undefined);
        });
      });

      if (lbClose) lbClose.addEventListener('click', closeLightbox);
      if (lightbox) lightbox.addEventListener('click', function(e){
        if (e.target !== lightbox) return;
        if (pinComposer && !pinComposer.hidden) { closePinComposer(); return; }
        closeLightbox();
      });
      document.addEventListener('keydown', function(e){
        var tag = document.activeElement && document.activeElement.tagName;
        var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

        if (e.key === 'Escape') {
          if (pinComposer && !pinComposer.hidden) { closePinComposer(); return; }
          closeLightbox();
          return;
        }

        // Playback shortcuts — only while a video is actually open, and never
        // while the visitor is typing into the composer or anything else.
        if (typing || !lightbox.classList.contains('open')) return;
        var video = stage.querySelector('.lb-video');
        if (!video) return;
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (video.paused) video.play(); else video.pause();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          video.currentTime = Math.min((video.duration || 0), video.currentTime + (e.shiftKey ? 1 : 5));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 5));
        }
      });

      if (lbApprove) lbApprove.addEventListener('click', function(){
        if (!currentFileId) return;
        lbApprove.disabled = true;
        lbApprove.textContent = 'Approving…';
        approveFile(currentFileId, function(){
          location.hash = 'view=' + encodeURIComponent(currentFileId);
          location.reload();
        }).catch(function(){ lbApprove.disabled = false; lbApprove.textContent = 'Approve'; alert('Could not approve this file. Please try again.'); });
      });

      if (lbRequestChanges) lbRequestChanges.addEventListener('click', function(){
        if (!currentFileId) return;
        requestChanges(currentFileId, function(){
          location.hash = 'view=' + encodeURIComponent(currentFileId);
          location.reload();
        });
      });

      if (pinCancelBtn) pinCancelBtn.addEventListener('click', closePinComposer);
      if (pinPostBtn) pinPostBtn.addEventListener('click', function(){
        if (!pendingPin || !currentFileId) return;
        var author = (pinNameEl && pinNameEl.value || '').trim() || 'Client';
        var body = (pinBodyEl && pinBodyEl.value || '').trim();
        if (!body) { if (pinBodyEl) pinBodyEl.focus(); return; }
        var postedFileId = currentFileId;
        var isTimePin = typeof pendingPin.timecode === 'number';
        saveName(author);
        pinPostBtn.disabled = true;
        pinPostBtn.textContent = 'Posting…';
        var payload = isTimePin
          ? { author: author, body: body, fileId: postedFileId, timecode: pendingPin.timecode, version: pendingPin.version }
          : { author: author, body: body, fileId: postedFileId, x: pendingPin.x, y: pendingPin.y, version: pendingPin.version };
        postComment(payload, function(newComment){
          // Confirmed in place — no reload. The pending marker is cleared by
          // closePinComposer(); renderPins()/renderVideoPins() then redraw
          // from PINS/VIDEO_PINS, which now include this one, so it appears
          // as a real numbered pin immediately. The Discussion thread below
          // the lightbox is synced later, when the lightbox actually closes
          // (see closeLightbox).
          if (isTimePin) {
            VIDEO_PINS.push({ id: newComment.id, fileId: newComment.fileId, timecode: newComment.timecode, author: newComment.author, body: newComment.body, created: newComment.created, version: newComment.version });
          } else {
            PINS.push({ id: newComment.id, fileId: newComment.fileId, x: newComment.x, y: newComment.y, author: newComment.author, body: newComment.body, created: newComment.created, version: newComment.version });
          }
          dirty = true;
          closePinComposer();
          if (isTimePin) {
            var video = stage.querySelector('.lb-video');
            renderVideoPins(postedFileId, video ? video.duration : 0, currentViewVersion);
          } else {
            renderPins(postedFileId, currentViewVersion);
          }
          pinPostBtn.disabled = false;
          pinPostBtn.textContent = 'Post pin';
        }).catch(function(){ pinPostBtn.disabled = false; pinPostBtn.textContent = 'Post pin'; alert('Could not post your note. Please try again.'); });
      });

      var hashMatch = /^#view=([^&]+)/.exec(location.hash);
      if (hashMatch) {
        var tMatch = /[&#]t=([0-9.]+)/.exec(location.hash);
        openLightbox(decodeURIComponent(hashMatch[1]), tMatch ? parseFloat(tMatch[1]) : undefined);
      }
    })();
    </script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(b.headline)} — Handover</title>
<link rel="icon" type="image/png" href="/favicon.png" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&display=swap');
  ${TEMPLATE_FONTS[template] ? `@import url('https://fonts.googleapis.com/css2?${TEMPLATE_FONTS[template]}&display=swap');` : ""}
  * { box-sizing: border-box; }
  :root { --accent: ${accent}; }
  html, body { margin: 0; padding: 0; }
  body {
    background: ${c.bg};
    color: ${c.text};
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
    letter-spacing: -0.006em;
  }
  .wrap { max-width: 800px; margin: 0 auto; padding: 56px 28px 80px; }
  .topbar { display: flex; align-items: center; padding: 0 0 48px; }
  .logo-img { max-height: 32px; max-width: 180px; object-fit: contain; display: block; }
  .logo-text { font-weight: 600; font-size: 15px; letter-spacing: -0.005em; color: ${c.text}; }
  .hero { position: relative; display: flex; flex-direction: column; padding: 0 0 40px; border-bottom: 1px solid ${c.border}; margin-bottom: 40px; }
  .hero-stat { display: none; position: absolute; top: 0; right: 0; text-align: right; }
  .hero-stat-value { display: block; font-size: 26px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; line-height: 1; }
  .hero-stat-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: ${c.muted}; margin-top: 5px; }
  .progress-ring { display: none; position: absolute; top: 0; right: 0; width: 62px; height: 62px; border-radius: 999px; align-items: center; justify-content: center; }
  .progress-ring-inner { width: 46px; height: 46px; border-radius: 999px; background: ${c.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .progress-ring-value { font-size: 11.5px; font-weight: 700; color: ${c.text}; font-variant-numeric: tabular-nums; }
  .progress-ring-label { font-size: 7.5px; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.03em; margin-top: 1px; }
  .info-panel { display: none; flex-direction: column; gap: 9px; padding: 16px 0 0; margin: 22px 0 0; border-top: 1px solid ${c.border}; }
  .info-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
  .info-label { color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
  .info-value { color: ${c.text}; font-weight: 500; text-align: right; }
  .info-codes { display: none; }
  .info-barcode { display: none; }
  .file-table-head { display: none; justify-content: space-between; padding: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: ${c.muted}; border-bottom: 1px solid ${c.border}; margin-bottom: 2px; }
  .file-summary { display: none; font-size: 12px; color: ${c.muted}; margin: 10px 0 0; }
  .signature-line { display: none; gap: 40px; margin: 36px 0 0; }
  .signature-field { flex: 1; padding-top: 30px; border-top: 1px solid ${c.border}; }
  .signature-label { font-size: 11px; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.08em; }
  .file.file-approved, .file.file-changes, .file.file-stale { /* per-template hook; no default treatment */ }
  h1 { font-weight: 600; font-size: clamp(32px, 5vw, 52px); line-height: 1.08; letter-spacing: -0.03em; margin: 0 0 14px; }
  .subhead { font-size: 16px; color: ${c.muted}; margin: 0 0 20px; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; font-size: 13px; color: ${c.muted}; margin: 0; }
  .meta-item { display: inline-flex; align-items: center; }
  .meta-item + .meta-item::before { content: "·"; color: ${c.border}; margin: 0 10px; }
  .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--accent); margin-right: 7px; flex-shrink: 0; }
  .status-dot.status-draft { background: ${c.muted}; }
  .welcome-wrap { position: relative; margin: 0 0 40px; }
  .welcome { font-family: "Newsreader", Georgia, serif; font-style: italic; font-size: 19px; line-height: 1.55; color: ${c.text}; margin: 0; max-width: 62ch; }
  .quote-mark { display: none; }
  .draft-notice { font-size: 13px; line-height: 1.5; color: ${c.muted}; border-left: 2px solid ${c.border}; padding: 1px 0 1px 16px; margin: -8px 0 40px; max-width: 60ch; }
  .intro { position: relative; background: ${c.panel}; border: 1px solid ${c.border}; border-radius: 16px; padding: 28px 32px 26px; margin-bottom: 40px; animation: intro-in .5s ease both; }
  .intro-close { position: absolute; top: 18px; right: 18px; z-index: 1; background: transparent; border: none; color: ${c.muted}; font-size: 18px; line-height: 1; cursor: pointer; padding: 4px 6px; }
  .intro-close:hover { color: ${c.text}; }
  .intro-eyebrow { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; color: ${c.text}; margin: 0 28px 20px 0; }
  .intro-count { font-variant-numeric: tabular-nums; color: ${c.muted}; font-weight: 400; font-size: 12px; flex-shrink: 0; }
  .intro-bar { height: 2px; background: ${c.chip}; border-radius: 999px; overflow: hidden; margin-bottom: 22px; }
  .intro-bar-fill { height: 100%; width: 20%; background: var(--accent); border-radius: 999px; transition: width .3s ease; }
  .intro-stage { min-height: 56px; margin-bottom: 20px; }
  .intro-step { display: none; }
  .intro-step-label { font-size: 16px; font-weight: 600; color: ${c.text}; margin: 0 0 6px; letter-spacing: -0.005em; }
  .intro-step-body { font-size: 14px; line-height: 1.55; color: ${c.muted}; }
  .intro-step.intro-anim { animation: intro-step-in .3s ease; }
  .intro-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .intro-dots { display: flex; gap: 6px; }
  .intro-dot { width: 6px; height: 6px; padding: 0; border-radius: 999px; border: none; background: ${c.border}; cursor: pointer; transition: background .2s, transform .2s; }
  .intro-dot:hover { background: ${c.muted}; }
  .intro-dot.active { background: var(--accent); transform: scale(1.4); }
  .intro-nav { display: flex; gap: 8px; }
  .intro-back, .intro-next { font-size: 13px; font-weight: 500; border-radius: 999px; padding: 8px 16px; cursor: pointer; font-family: inherit; }
  .intro-back { background: transparent; border: 1px solid ${c.border}; color: ${c.muted}; }
  .intro-back:hover { color: ${c.text}; border-color: ${c.text}; }
  .intro-back[hidden] { display: none; }
  .intro-next { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
  .intro-next:hover { opacity: 0.9; }
  @keyframes intro-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes intro-step-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    .intro, .intro-step.intro-anim { animation: none !important; }
    .intro-bar-fill, .intro-dot { transition: none !important; }
  }
  .section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
  .section-title h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: ${c.text}; }
  .section-title .count { font-size: 13px; color: ${c.muted}; }
  .files { display: flex; flex-direction: column; margin-bottom: 8px; }
  .file { display: flex; align-items: center; gap: 16px; padding: 18px 0; border-bottom: 1px solid ${c.border}; flex-wrap: wrap; }
  .file:first-child { padding-top: 0; }
  .file-badge { flex-shrink: 0; width: 40px; height: 40px; border-radius: 8px; background: ${c.chip}; color: ${c.muted}; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
  .file-info { flex: 1; min-width: 140px; }
  .file-name { font-weight: 500; font-size: 14.5px; color: ${c.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta { font-size: 12.5px; color: ${c.muted}; margin-top: 2px; }
  .approved-note { font-size: 12px; color: var(--accent); margin-top: 3px; }
  .changes-note { font-size: 12px; color: ${c.text}; margin-top: 3px; font-weight: 600; }
  .stale-note { font-size: 12px; color: ${c.muted}; margin-top: 3px; font-style: italic; }
  .link-btn { background: none; border: none; padding: 0; margin: 0; color: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: inherit; font-family: inherit; }
  .dl { flex-shrink: 0; font-size: 13px; font-weight: 500; color: #fff; background: var(--accent); padding: 8px 16px; border-radius: 999px; cursor: pointer; user-select: none; text-decoration: none; display: inline-block; border: none; }
  .dl:hover { opacity: 0.88; }
  .dl-off { opacity: 0.5; cursor: default; }
  .empty { color: ${c.muted}; font-size: 14px; text-align: center; padding: 32px; border: 1px dashed ${c.border}; border-radius: 14px; }
  .note-btn, .view-btn, .approve-btn, .request-btn { flex-shrink: 0; font-size: 13px; font-weight: 500; background: transparent; padding: 8px 16px; border-radius: 999px; cursor: pointer; transition: color .15s, border-color .15s, background .15s; font-family: inherit; }
  .note-btn, .view-btn, .request-btn { color: ${c.muted}; border: 1px solid ${c.border}; }
  .note-btn:hover, .view-btn:hover, .request-btn:hover { color: ${c.text}; border-color: ${c.text}; }
  .approve-btn { color: var(--accent); border: 1px solid var(--accent); }
  .approve-btn:hover { background: var(--accent); color: #fff; }
  .approve-btn:disabled, .post-btn:disabled, .request-btn:disabled { opacity: 0.6; cursor: default; }

  .disc-sub { font-size: 13px; color: ${c.muted}; margin: -8px 0 20px; }
  .thread { display: flex; flex-direction: column; margin-bottom: 8px; }
  .comment { padding: 16px 0; border-bottom: 1px solid ${c.border}; }
  .comment:first-child { padding-top: 0; }
  .c-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .c-head .who { font-weight: 600; font-size: 13.5px; color: ${c.text}; }
  .c-head .role { font-size: 11.5px; color: ${c.muted}; }
  .comment.designer .role { color: var(--accent); }
  .c-head .on { font-size: 12px; color: var(--accent); }
  .c-head .on[data-pin-file] { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .c-head .time { margin-left: auto; font-size: 12px; color: ${c.muted}; }
  .c-body { font-size: 14px; color: ${c.text}; white-space: pre-wrap; }

  .composer { background: ${c.panel}; border: 1px solid ${c.border}; border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  .composer-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .c-input { background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 10px; padding: 11px 14px; font-size: 14px; color: ${c.text}; font-family: inherit; outline: none; }
  .c-input:focus { border-color: var(--accent); }
  .composer-row .c-input { flex: 1; min-width: 140px; }
  .c-select { cursor: pointer; }
  .c-area { width: 100%; resize: vertical; }
  .composer-actions { display: flex; justify-content: flex-end; }
  .post-btn { font-size: 13px; font-weight: 500; color: #fff; background: var(--accent); border: none; padding: 10px 20px; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .lb-cancel-btn { font-size: 13px; font-weight: 500; color: ${c.muted}; background: transparent; border: 1px solid ${c.border}; padding: 10px 16px; border-radius: 999px; cursor: pointer; font-family: inherit; }

  .footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid ${c.border}; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12.5px; color: ${c.muted}; }
  .footer a { color: ${c.muted}; text-decoration: underline; text-underline-offset: 2px; }

  /* --- Lightbox: always dark, independent of page theme (it's a media viewer) --- */
  .lightbox { position: fixed; inset: 0; background: rgba(6,6,8,0.96); z-index: 999; display: none; flex-direction: column; }
  .lightbox.open { display: flex; }
  .lb-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; flex-shrink: 0; }
  .lb-title-group { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .lb-title { color: #f5f5f7; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lb-version-picker { flex-shrink: 0; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #f5f5f7; font-size: 11.5px; font-weight: 600; font-family: inherit; padding: 5px 10px; border-radius: 999px; cursor: pointer; outline: none; }
  .lb-version-picker:hover { background: rgba(255,255,255,0.14); }
  .lb-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .lb-old-version-note { font-size: 11px; color: rgba(245,245,247,0.55); font-style: italic; }
  .lb-approved-note { font-size: 11px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
  .lb-close { background: transparent; border: none; color: #f5f5f7; font-size: 16px; cursor: pointer; padding: 6px 10px; line-height: 1; }
  .lb-close:hover { color: var(--accent); }
  .lb-panel-toggle { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.08); border: none; color: #f5f5f7; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 7px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: background .15s; }
  .lb-panel-toggle:hover { background: rgba(255,255,255,0.16); }
  .lb-panel-toggle.active { background: var(--accent); color: #fff; }
  .lb-panel-count { font-variant-numeric: tabular-nums; }
  .lb-main { flex: 1; display: flex; min-height: 0; }
  .lb-stage-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .lb-stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 20px; min-height: 0; }
  .lb-image-wrap { position: relative; display: inline-block; max-width: 90vw; max-height: 74vh; }
  .lb-image-wrap img { display: block; max-width: 90vw; max-height: 74vh; object-fit: contain; border-radius: 4px; cursor: crosshair; }
  .lb-pdf-frame { width: 88vw; height: 78vh; border: 0; border-radius: 4px; background: #fff; }
  .lb-no-preview { color: rgba(245,245,247,0.5); font-size: 13px; }

  /* --- Notes panel: every pin on the open file, with its full note visible --- */
  .lb-panel { width: 300px; flex-shrink: 0; border-left: 1px solid rgba(255,255,255,0.09); display: flex; flex-direction: column; min-height: 0; background: rgba(255,255,255,0.02); transition: width .18s ease, opacity .18s ease, padding .18s ease; overflow: hidden; }
  .lb-panel.collapsed { width: 0; opacity: 0; border-left-color: transparent; }
  .lb-panel-head { flex-shrink: 0; padding: 16px 18px 12px; font-size: 12.5px; font-weight: 500; color: rgba(245,245,247,0.5); }
  .lb-panel-list { flex: 1; overflow-y: auto; padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
  .lb-panel-empty { color: rgba(245,245,247,0.4); font-size: 12.5px; text-align: center; padding: 24px 12px; }
  .lb-note { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 13px; cursor: pointer; transition: border-color .15s, background .15s; }
  .lb-note:hover { border-color: rgba(255,255,255,0.22); }
  .lb-note.highlight { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, rgba(255,255,255,0.045)); }
  .lb-note-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
  .lb-note-badge { flex-shrink: 0; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: rgba(255,255,255,0.14); color: #f5f5f7; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .lb-note-author { font-size: 12.5px; font-weight: 600; color: #f5f5f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lb-note-version { flex-shrink: 0; font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); padding: 1px 6px; border-radius: 999px; }
  .lb-note-time { margin-left: auto; font-size: 10.5px; color: rgba(245,245,247,0.4); flex-shrink: 0; }
  .lb-note-body { font-size: 12.5px; color: rgba(245,245,247,0.85); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .lb-note-actions { display: flex; gap: 12px; margin-top: 8px; }
  .lb-note-action { background: none; border: none; padding: 0; color: rgba(245,245,247,0.45); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .lb-note-action:hover { color: #f5f5f7; }
  .lb-note-action.danger:hover { color: #ff6b5e; }
  .lb-note-edit-area { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; color: #f5f5f7; font-family: inherit; resize: vertical; outline: none; }
  .lb-note-edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .lb-note-edit-save { background: var(--accent); color: #fff; border: none; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .lb-note-edit-cancel { background: transparent; color: rgba(245,245,247,0.6); border: 1px solid rgba(255,255,255,0.16); font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; }
  @keyframes marker-flash { 0%, 100% { box-shadow: 0 1px 3px rgba(0,0,0,0.5); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent); } }
  .pin-marker.flash, .time-marker.flash { animation: marker-flash 0.9s ease; }

  /* --- Video review: custom transport so the scrubber can carry timecode pins --- */
  .lb-video-wrap { display: flex; flex-direction: column; align-items: stretch; width: min(88vw, 1040px); }
  .lb-video { width: 100%; max-height: 68vh; border-radius: 6px 6px 0 0; background: #000; display: block; cursor: pointer; }
  /* Belt-and-suspenders: the element already has no controls attribute, but
     some Chromium builds still paint a default scrub affordance over a video
     on hover/interaction unless its native controls UI is explicitly killed. */
  .lb-video::-webkit-media-controls,
  .lb-video::-webkit-media-controls-enclosure,
  .lb-video::-webkit-media-controls-panel,
  .lb-video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none !important; }
  .lb-video-bar { display: flex; align-items: center; gap: 12px; background: #16161a; border-radius: 0 0 6px 6px; padding: 10px 14px; }
  .lb-play-btn { flex-shrink: 0; width: 30px; height: 30px; border-radius: 999px; border: none; background: rgba(255,255,255,0.1); color: #f5f5f7; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
  .lb-play-btn:hover { background: var(--accent); }
  .lb-time-readout { flex-shrink: 0; font-variant-numeric: tabular-nums; font-size: 11.5px; color: rgba(245,245,247,0.65); min-width: 92px; }
  .lb-timeline-wrap { flex: 1; display: flex; align-items: center; padding: 8px 0; cursor: pointer; }
  .lb-timeline-track { position: relative; width: 100%; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.16); touch-action: none; }
  .lb-timeline-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; border-radius: 999px; background: var(--accent); pointer-events: none; }
  .lb-timeline-head { position: absolute; top: 50%; left: 0%; width: 12px; height: 12px; border-radius: 999px; background: var(--accent); border: 2px solid #fff; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
  .time-marker { position: absolute; top: 50%; width: 16px; height: 16px; margin-left: -8px; transform: translateY(-50%); border-radius: 999px; background: #fff; color: #16161a; font-size: 9px; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.5); z-index: 2; transition: transform .12s; }
  .time-marker:hover { transform: translateY(-50%) scale(1.3); }
  .time-marker.pending { background: transparent; border: 2px dashed var(--accent); color: var(--accent); cursor: default; animation: pin-pulse 1.2s ease-in-out infinite; }
  .lb-comment-here-btn { flex-shrink: 0; font-size: 12.5px; font-weight: 500; color: #fff; background: var(--accent); border: none; padding: 8px 14px; border-radius: 999px; cursor: pointer; white-space: nowrap; font-family: inherit; }
  .lb-comment-here-btn:hover { opacity: 0.9; }
  .lb-hint { text-align: center; color: rgba(245,245,247,0.45); font-size: 11px; margin: 0 0 10px; flex-shrink: 0; }
  .pin-marker { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; border: 2px solid #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
  .pin-marker.pending { background: rgba(255,255,255,0.12); border: 2px dashed var(--accent); color: var(--accent); cursor: default; animation: pin-pulse 1.2s ease-in-out infinite; }
  @keyframes pin-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
  /* A floating popover anchored to the click (positioned via JS), not a
     docked panel — the pin should feel placed exactly where you clicked. */
  .pin-composer { position: fixed; z-index: 1001; width: 280px; max-width: calc(100vw - 32px); background: #1c1c1e; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
  /* This class's own display:flex beats the UA stylesheet's hidden-attribute default
     (author styles always win over user-agent defaults), so without this the composer
     stays visible — pinned at its default top-left position — any time a file lightbox
     is open, even with no pin being composed. */
  .pin-composer[hidden] { display: none; }
  .pin-composer .c-input { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: #f5f5f7; }
  .pin-composer-actions { display: flex; justify-content: flex-end; gap: 8px; }

  /* --- Template: Minimal — quiet and utilitarian; the studio's own brand is
     the point, this page should have as little personality of its own as
     possible. Same markup as Editorial, restyled: flatter, tighter, sharper
     corners, no serif pull-quote. --- */
  [data-template="minimal"] .hero { border-bottom: none; padding-bottom: 0; margin-bottom: 32px; }
  [data-template="minimal"] h1 { font-size: clamp(24px, 3.2vw, 32px); font-weight: 600; letter-spacing: -0.015em; }
  [data-template="minimal"] .subhead { font-size: 14px; }
  [data-template="minimal"] .welcome-wrap { margin-bottom: 32px; }
  [data-template="minimal"] .welcome { font-family: "Inter", ui-sans-serif, system-ui, sans-serif; font-style: normal; font-size: 15px; color: ${c.muted}; }
  [data-template="minimal"] .intro { background: transparent; border: none; border-top: 1px solid ${c.border}; border-radius: 0; padding: 20px 0 18px; }
  [data-template="minimal"] .intro-close { top: 14px; right: 0; }
  [data-template="minimal"] .intro-eyebrow { margin-right: 20px; }
  [data-template="minimal"] .file-badge { background: transparent; border: 1px solid ${c.border}; width: 32px; height: 32px; font-size: 9px; }
  [data-template="minimal"] .note-btn, [data-template="minimal"] .view-btn, [data-template="minimal"] .approve-btn,
  [data-template="minimal"] .request-btn, [data-template="minimal"] .dl, [data-template="minimal"] .post-btn { border-radius: 4px; }
  [data-template="minimal"] .wrap { padding-top: 48px; }
  [data-template="minimal"] .file { padding: 14px 0; }
  [data-template="minimal"] .comment { padding: 12px 0; }

  /* --- Template: Bold — big type and one confident graphic flourish (the
     pull-quote mark), for studios who want the delivery itself to make a
     visual statement. The accent spends its boldness in the hero only; every
     other rule below the fold is untouched. --- */
  body[data-template="bold"] { border-top: 6px solid var(--accent); }
  [data-template="bold"] h1 { font-size: clamp(40px, 7vw, 76px); font-weight: 800; letter-spacing: -0.035em; }
  [data-template="bold"] .hero { padding-bottom: 48px; margin-bottom: 48px; border-bottom-color: color-mix(in srgb, var(--accent) 30%, ${c.border}); }
  [data-template="bold"] .welcome-wrap { padding-left: 34px; }
  [data-template="bold"] .welcome { font-size: 22px; }
  [data-template="bold"] .quote-mark { display: block; position: absolute; left: -6px; top: -30px; font-family: "Newsreader", Georgia, serif; font-style: italic; font-size: 88px; line-height: 1; color: color-mix(in srgb, var(--accent) 32%, transparent); pointer-events: none; user-select: none; }
  [data-template="bold"] .file-badge { background: color-mix(in srgb, var(--accent) 12%, ${c.chip}); color: var(--accent); }
  [data-template="bold"] .approve-btn { background: var(--accent); color: #fff; }
  [data-template="bold"] .approve-btn:hover { opacity: 0.88; }
  [data-template="bold"] .status-dot { width: 8px; height: 8px; }

  /* ============================================================
     The 12 templates below each commit to one fixed, self-contained
     palette and typeface — unlike Editorial/Minimal/Bold, they don't
     track the studio's light/dark toggle (the template *is* the look,
     the same way a printed collateral piece doesn't have a dark mode).
     The studio's chosen accent color still drives every primary action
     and highlight, so accent customization stays meaningful everywhere.
     ============================================================ */

  /* --- Ledger: tractor-feed accounting paper, Space Mono, zebra rows --- */
  body[data-template="ledger"] { background: #eeece2; color: #1c2b22; font-family: "Space Mono", ui-monospace, monospace; letter-spacing: 0; }
  [data-template="ledger"] .logo-text,
  [data-template="ledger"] .intro-eyebrow, [data-template="ledger"] .section-title h2,
  [data-template="ledger"] .file-name, [data-template="ledger"] .changes-note,
  [data-template="ledger"] .c-head .who, [data-template="ledger"] .c-body,
  [data-template="ledger"] .intro-step-label { color: #1c2b22; }
  [data-template="ledger"] .subhead, [data-template="ledger"] .meta, [data-template="ledger"] .file-meta,
  [data-template="ledger"] .stale-note, [data-template="ledger"] .empty, [data-template="ledger"] .disc-sub,
  [data-template="ledger"] .c-head .role, [data-template="ledger"] .c-head .time, [data-template="ledger"] .footer,
  [data-template="ledger"] .footer a, [data-template="ledger"] .intro-count, [data-template="ledger"] .intro-step-body,
  [data-template="ledger"] .note-btn, [data-template="ledger"] .view-btn, [data-template="ledger"] .request-btn { color: #5b6b5f; }
  [data-template="ledger"] .hero, [data-template="ledger"] .draft-notice, [data-template="ledger"] .intro,
  [data-template="ledger"] .file, [data-template="ledger"] .comment, [data-template="ledger"] .empty,
  [data-template="ledger"] .footer, [data-template="ledger"] .note-btn, [data-template="ledger"] .view-btn,
  [data-template="ledger"] .request-btn, [data-template="ledger"] .composer, [data-template="ledger"] .c-input,
  [data-template="ledger"] .meta-item + .meta-item::before, [data-template="ledger"] .intro-dot { border-color: #c9c4ae; }
  [data-template="ledger"] .intro, [data-template="ledger"] .composer { background: #e4e1d3; }
  [data-template="ledger"] .file-badge { background: #dfdac8; color: #4a5a4e; border-radius: 2px; }
  [data-template="ledger"] .c-input { background: #eeece2; color: #1c2b22; }
  [data-template="ledger"] h1 { font-family: "Space Mono", monospace; font-weight: 700; text-transform: uppercase; font-size: clamp(22px, 3.4vw, 32px); letter-spacing: 0.01em; }
  [data-template="ledger"] .hero { border-top: 1px solid #c9c4ae; border-bottom: 3px double #1c2b22; padding-top: 14px; }
  [data-template="ledger"] .welcome { font-family: "Space Mono", monospace; font-style: normal; font-size: 14px; }
  [data-template="ledger"] .file:nth-child(even), [data-template="ledger"] .comment:nth-child(even) { background: rgba(28,43,34,0.05); }
  [data-template="ledger"] .note-btn, [data-template="ledger"] .view-btn, [data-template="ledger"] .approve-btn,
  [data-template="ledger"] .request-btn, [data-template="ledger"] .dl, [data-template="ledger"] .post-btn { border-radius: 3px; text-transform: uppercase; letter-spacing: 0.04em; font-family: "Space Mono", monospace; font-size: 12px; }
  [data-template="ledger"] .approve-btn { background: #1f3d2b; color: #eeece2; border-color: #1f3d2b; }
  [data-template="ledger"] .approve-btn:hover { opacity: 0.85; }
  [data-template="ledger"] .post-btn, [data-template="ledger"] .dl { background: #1f3d2b; }
  [data-template="ledger"] .file-approved { background: rgba(31,61,43,0.1); }
  [data-template="ledger"] .file-changes { background: rgba(178,58,26,0.08); }
  [data-template="ledger"] .file-table-head { display: flex; font-family: "Space Mono", monospace; }
  [data-template="ledger"] .file-summary { display: block; font-family: "Space Mono", monospace; text-transform: uppercase; letter-spacing: 0.03em; padding-top: 10px; border-top: 1px solid #c9c4ae; }
  [data-template="ledger"] .wrap { position: relative; }
  [data-template="ledger"] .wrap::before, [data-template="ledger"] .wrap::after {
    content: ""; position: absolute; top: 60px; bottom: 60px; width: 12px;
    background-image: radial-gradient(circle, #eeece2 4.5px, transparent 5px);
    background-color: #d6d1bc; background-size: 12px 30px; background-repeat: repeat-y; background-position: center top;
  }
  [data-template="ledger"] .wrap::before { left: 2px; }
  [data-template="ledger"] .wrap::after { right: 2px; }

  /* --- Terminal: dark HUD / mission-control readout --- */
  body[data-template="terminal"] { background: #0a0e12; color: #dfe8e2; font-family: "IBM Plex Mono", ui-monospace, monospace; }
  [data-template="terminal"] .logo-text, [data-template="terminal"] .intro-eyebrow, [data-template="terminal"] .section-title h2,
  [data-template="terminal"] .file-name, [data-template="terminal"] .changes-note, [data-template="terminal"] .c-head .who,
  [data-template="terminal"] .c-body, [data-template="terminal"] .intro-step-label { color: #f2f7f4; }
  [data-template="terminal"] .meta, [data-template="terminal"] .file-meta, [data-template="terminal"] .stale-note,
  [data-template="terminal"] .empty, [data-template="terminal"] .disc-sub, [data-template="terminal"] .c-head .role,
  [data-template="terminal"] .c-head .time, [data-template="terminal"] .footer, [data-template="terminal"] .footer a,
  [data-template="terminal"] .intro-count, [data-template="terminal"] .intro-step-body,
  [data-template="terminal"] .note-btn, [data-template="terminal"] .view-btn, [data-template="terminal"] .request-btn { color: #7c8a90; }
  [data-template="terminal"] .hero, [data-template="terminal"] .draft-notice, [data-template="terminal"] .intro,
  [data-template="terminal"] .empty, [data-template="terminal"] .footer, [data-template="terminal"] .note-btn,
  [data-template="terminal"] .view-btn, [data-template="terminal"] .request-btn, [data-template="terminal"] .composer,
  [data-template="terminal"] .c-input, [data-template="terminal"] .meta-item + .meta-item::before,
  [data-template="terminal"] .intro-dot { border-color: #243039; }
  [data-template="terminal"] .intro, [data-template="terminal"] .composer, [data-template="terminal"] .c-input { background: #11161c; }
  [data-template="terminal"] .file-badge { background: #161d24; color: #7c8a90; border-radius: 2px; }
  [data-template="terminal"] .subhead { order: -1; font-family: "IBM Plex Mono", monospace; text-transform: uppercase; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: var(--accent); margin-bottom: 10px; }
  [data-template="terminal"] h1 { font-family: "Oswald", ui-sans-serif, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; font-size: clamp(28px, 4.6vw, 46px); }
  [data-template="terminal"] .meta { font-family: "IBM Plex Mono", monospace; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.05em; }
  [data-template="terminal"] .welcome { font-family: "IBM Plex Mono", monospace; font-style: normal; font-size: 14px; }
  [data-template="terminal"] .file, [data-template="terminal"] .comment { border: 1px solid #243039; border-bottom: 1px solid #243039; border-radius: 6px; padding: 16px; margin-bottom: 10px; }
  [data-template="terminal"] .file:first-child, [data-template="terminal"] .comment:first-child { padding-top: 16px; }
  [data-template="terminal"] .note-btn, [data-template="terminal"] .view-btn, [data-template="terminal"] .approve-btn,
  [data-template="terminal"] .request-btn, [data-template="terminal"] .dl, [data-template="terminal"] .post-btn { border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; font-family: "IBM Plex Mono", monospace; font-size: 12px; }
  [data-template="terminal"] .approve-btn { background: var(--accent); color: #0a0e12; border-color: var(--accent); }
  [data-template="terminal"] .approve-btn:hover { opacity: 0.85; }
  [data-template="terminal"] .hero-stat { display: block; }
  [data-template="terminal"] .hero-stat-label, [data-template="terminal"] .file-summary { color: #7c8a90; }
  [data-template="terminal"] .file-summary { display: block; font-family: "IBM Plex Mono", monospace; text-transform: uppercase; letter-spacing: 0.04em; }
  [data-template="terminal"] .changes-note { color: #f0b429; text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.06em; font-weight: 600; }
  [data-template="terminal"] .file-changes, [data-template="terminal"] .file-stale { border-color: var(--accent); }
  [data-template="terminal"] .file-approved { border-color: #2f7a52; }

  /* --- Broadsheet: newsprint masthead, three-rule frame, serif --- */
  body[data-template="broadsheet"] { background: #f6f3ec; color: #1a1a1a; font-family: "Libre Baskerville", Georgia, serif; }
  [data-template="broadsheet"] .subhead, [data-template="broadsheet"] .meta, [data-template="broadsheet"] .file-meta,
  [data-template="broadsheet"] .stale-note, [data-template="broadsheet"] .empty, [data-template="broadsheet"] .disc-sub,
  [data-template="broadsheet"] .c-head .role, [data-template="broadsheet"] .c-head .time, [data-template="broadsheet"] .footer,
  [data-template="broadsheet"] .footer a, [data-template="broadsheet"] .intro-count, [data-template="broadsheet"] .intro-step-body,
  [data-template="broadsheet"] .note-btn, [data-template="broadsheet"] .view-btn, [data-template="broadsheet"] .request-btn,
  [data-template="broadsheet"] .info-label { color: #6b6b64; }
  [data-template="broadsheet"] .hero, [data-template="broadsheet"] .draft-notice, [data-template="broadsheet"] .intro,
  [data-template="broadsheet"] .file, [data-template="broadsheet"] .comment, [data-template="broadsheet"] .empty,
  [data-template="broadsheet"] .note-btn, [data-template="broadsheet"] .view-btn, [data-template="broadsheet"] .request-btn,
  [data-template="broadsheet"] .composer, [data-template="broadsheet"] .c-input, [data-template="broadsheet"] .intro-dot { border-color: #d8d3c4; }
  [data-template="broadsheet"] .intro, [data-template="broadsheet"] .composer, [data-template="broadsheet"] .c-input { background: #f6f3ec; }
  [data-template="broadsheet"] .file-badge { background: #efeadb; color: #6b6b64; border-radius: 0; }
  [data-template="broadsheet"] .topbar { justify-content: center; border-bottom: 3px double #1a1a1a; padding-bottom: 14px; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12.5px; }
  [data-template="broadsheet"] .hero { text-align: center; border-bottom-color: #1a1a1a; }
  [data-template="broadsheet"] h1 { font-family: "Libre Baskerville", Georgia, serif; font-weight: 700; letter-spacing: -0.01em; font-size: clamp(28px, 4.6vw, 44px); }
  [data-template="broadsheet"] .subhead { font-style: italic; }
  [data-template="broadsheet"] .meta { justify-content: center; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.1em; }
  [data-template="broadsheet"] .welcome { font-family: "Libre Baskerville", Georgia, serif; }
  [data-template="broadsheet"] .footer { border-top-color: #1a1a1a; }
  [data-template="broadsheet"] .note-btn, [data-template="broadsheet"] .view-btn, [data-template="broadsheet"] .approve-btn,
  [data-template="broadsheet"] .request-btn, [data-template="broadsheet"] .dl, [data-template="broadsheet"] .post-btn { border-radius: 0; }
  [data-template="broadsheet"] .approve-btn { background: #1a1a1a; color: #f6f3ec; border-color: #1a1a1a; }
  [data-template="broadsheet"] .approve-btn:hover { opacity: 0.85; }
  [data-template="broadsheet"] .wrap { display: grid; grid-template-columns: 1fr 220px; column-gap: 40px; max-width: 980px; align-items: start; }
  [data-template="broadsheet"] .wrap > *:not(.info-panel) { grid-column: 1; }
  [data-template="broadsheet"] .info-panel {
    display: flex; grid-column: 2; grid-row: 1 / -1; border: none; border-left: 1px solid #d8d3c4;
    padding: 6px 0 0 28px; margin-top: 6px;
  }
  [data-template="broadsheet"] .info-row { flex-direction: column; gap: 3px; }
  [data-template="broadsheet"] .info-label { font-family: "Inter", sans-serif; }
  [data-template="broadsheet"] .info-value { color: #1a1a1a; text-align: left; font-size: 14px; }
  @media (max-width: 760px) {
    [data-template="broadsheet"] .wrap { grid-template-columns: 1fr; }
    [data-template="broadsheet"] .info-panel { grid-column: 1; grid-row: auto; border-left: none; border-top: 1px solid #d8d3c4; padding: 16px 0 0; margin-top: 24px; }
    [data-template="broadsheet"] .info-row { flex-direction: row; justify-content: space-between; }
  }

  /* --- Boarding Pass: white ticket stub floating on navy --- */
  body[data-template="boarding-pass"] { background: #0d1b2e; }
  [data-template="boarding-pass"] .wrap { background: #fff; color: #16232f; border-radius: 8px; box-shadow: 0 24px 64px rgba(0,0,0,0.4); margin: 48px auto; }
  [data-template="boarding-pass"] .logo-text, [data-template="boarding-pass"] .intro-eyebrow, [data-template="boarding-pass"] .section-title h2,
  [data-template="boarding-pass"] .file-name, [data-template="boarding-pass"] .changes-note, [data-template="boarding-pass"] .c-head .who,
  [data-template="boarding-pass"] .c-body, [data-template="boarding-pass"] .intro-step-label { color: #16232f; }
  [data-template="boarding-pass"] .subhead, [data-template="boarding-pass"] .meta, [data-template="boarding-pass"] .file-meta,
  [data-template="boarding-pass"] .stale-note, [data-template="boarding-pass"] .empty, [data-template="boarding-pass"] .disc-sub,
  [data-template="boarding-pass"] .c-head .role, [data-template="boarding-pass"] .c-head .time, [data-template="boarding-pass"] .footer,
  [data-template="boarding-pass"] .footer a, [data-template="boarding-pass"] .intro-count, [data-template="boarding-pass"] .intro-step-body,
  [data-template="boarding-pass"] .note-btn, [data-template="boarding-pass"] .view-btn, [data-template="boarding-pass"] .request-btn,
  [data-template="boarding-pass"] .info-label { color: #5c6b7a; }
  [data-template="boarding-pass"] .hero, [data-template="boarding-pass"] .intro, [data-template="boarding-pass"] .file,
  [data-template="boarding-pass"] .comment, [data-template="boarding-pass"] .empty, [data-template="boarding-pass"] .footer,
  [data-template="boarding-pass"] .note-btn, [data-template="boarding-pass"] .view-btn, [data-template="boarding-pass"] .request-btn,
  [data-template="boarding-pass"] .composer, [data-template="boarding-pass"] .c-input,
  [data-template="boarding-pass"] .meta-item + .meta-item::before, [data-template="boarding-pass"] .intro-dot { border-color: #dbe2ea; }
  [data-template="boarding-pass"] .intro, [data-template="boarding-pass"] .composer { background: #f5f7fa; }
  [data-template="boarding-pass"] .file-badge { background: #eef1f5; color: #5c6b7a; }
  [data-template="boarding-pass"] h1 { font-family: "Oswald", ui-sans-serif, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.005em; font-size: clamp(26px, 4.2vw, 42px); }
  [data-template="boarding-pass"] .hero { border-bottom-style: dashed; }
  [data-template="boarding-pass"] .meta { font-family: "IBM Plex Mono", monospace; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.05em; }
  [data-template="boarding-pass"] .note-btn, [data-template="boarding-pass"] .view-btn, [data-template="boarding-pass"] .approve-btn,
  [data-template="boarding-pass"] .request-btn, [data-template="boarding-pass"] .dl, [data-template="boarding-pass"] .post-btn { border-radius: 4px; font-family: "IBM Plex Mono", monospace; text-transform: uppercase; letter-spacing: 0.04em; font-size: 12px; }
  [data-template="boarding-pass"] .approve-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
  [data-template="boarding-pass"] .approve-btn:hover { opacity: 0.85; }
  [data-template="boarding-pass"] .footer { position: relative; padding-top: 28px; }
  [data-template="boarding-pass"] .footer::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 6px; background: repeating-linear-gradient(90deg, #16232f 0 3px, transparent 3px 7px); opacity: 0.5; }
  [data-template="boarding-pass"] .wrap { display: grid; grid-template-columns: 1fr 210px; column-gap: 0; max-width: 900px; overflow: hidden; }
  [data-template="boarding-pass"] .wrap > *:not(.info-panel) { grid-column: 1; }
  [data-template="boarding-pass"] .info-panel {
    display: flex; grid-column: 2; grid-row: 1 / -1; background: #f5f7fa; border: none; border-left: 2px dashed #c3ccd6;
    padding: 40px 22px; margin: -56px -28px -80px 0; justify-content: flex-start;
  }
  [data-template="boarding-pass"] .info-row { flex-direction: column; gap: 2px; }
  [data-template="boarding-pass"] .info-value { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 12px; }
  [data-template="boarding-pass"] .info-codes { display: flex; align-items: baseline; justify-content: center; gap: 8px; font-family: "Oswald", sans-serif; font-weight: 700; font-size: 26px; margin: 8px 0 18px; color: #16232f; }
  [data-template="boarding-pass"] .info-code-arrow { font-size: 13px; color: #8a96a3; }
  [data-template="boarding-pass"] .info-barcode { display: block; height: 46px; margin-top: auto; background: repeating-linear-gradient(90deg, #16232f 0 2px, transparent 2px 5px); }
  @media (max-width: 760px) {
    [data-template="boarding-pass"] .wrap { grid-template-columns: 1fr; }
    [data-template="boarding-pass"] .info-panel { grid-column: 1; grid-row: auto; border-left: none; border-top: 2px dashed #c3ccd6; flex-direction: row; flex-wrap: wrap; gap: 16px; }
    [data-template="boarding-pass"] .info-barcode { display: none; }
  }

  /* --- Zine: punk flyer — yellow ground, stacked-shadow title, card grid --- */
  body[data-template="zine"] { background: #f0e832; color: #111; font-family: "Space Mono", ui-monospace, monospace; }
  [data-template="zine"] .wrap { border: 6px solid #111; }
  [data-template="zine"] .logo-text, [data-template="zine"] .file-name, [data-template="zine"] .c-head .who,
  [data-template="zine"] .c-body, [data-template="zine"] .intro-step-label, [data-template="zine"] .intro-eyebrow,
  [data-template="zine"] .section-title h2 { color: #111; }
  [data-template="zine"] .subhead, [data-template="zine"] .meta, [data-template="zine"] .disc-sub,
  [data-template="zine"] .c-head .role, [data-template="zine"] .c-head .time, [data-template="zine"] .intro-count,
  [data-template="zine"] .intro-step-body { color: #4a441a; }
  [data-template="zine"] .footer, [data-template="zine"] .footer a { color: #111; }
  [data-template="zine"] .hero, [data-template="zine"] .footer { border-color: #111; }
  [data-template="zine"] .intro { background: #fff9dd; border: 3px solid #111; border-radius: 0; }
  [data-template="zine"] h1 { font-family: "Oswald", ui-sans-serif, sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; font-size: clamp(34px, 6.4vw, 68px); line-height: 0.98; text-shadow: 4px 4px 0 var(--accent); }
  [data-template="zine"] .welcome { font-family: "Space Mono", monospace; font-style: normal; }
  [data-template="zine"] .files { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  [data-template="zine"] .file { flex-direction: column; align-items: flex-start; gap: 10px; padding: 20px; border: 3px solid #111; border-radius: 0; margin: 0; }
  [data-template="zine"] .file:first-child { padding-top: 20px; }
  [data-template="zine"] .file:nth-child(odd) { background: #111; color: #f0e832; }
  [data-template="zine"] .file:nth-child(odd) .file-name, [data-template="zine"] .file:nth-child(odd) .file-meta { color: #f0e832; }
  [data-template="zine"] .file:nth-child(even) { background: var(--accent); }
  [data-template="zine"] .file:nth-child(even) .file-name, [data-template="zine"] .file:nth-child(even) .file-meta,
  [data-template="zine"] .file:nth-child(even) .changes-note { color: #111; }
  [data-template="zine"] .file-badge { background: rgba(0,0,0,0.15); color: inherit; border-radius: 0; }
  [data-template="zine"] .note-btn, [data-template="zine"] .view-btn, [data-template="zine"] .approve-btn,
  [data-template="zine"] .request-btn, [data-template="zine"] .dl, [data-template="zine"] .post-btn { border-radius: 0; text-transform: uppercase; font-weight: 700; letter-spacing: 0.02em; border-width: 2px; }
  [data-template="zine"] .approve-btn { background: #111; color: #f0e832; border-color: #111; }
  [data-template="zine"] .note-btn, [data-template="zine"] .view-btn, [data-template="zine"] .request-btn { border-color: currentColor; color: inherit; }
  [data-template="zine"] .files { counter-reset: zine-file; }
  [data-template="zine"] .file { counter-increment: zine-file; position: relative; }
  [data-template="zine"] .file::after { content: counter(zine-file, decimal-leading-zero); position: absolute; top: 10px; right: 14px; font-size: 12px; font-weight: 700; opacity: 0.55; }
  @media (max-width: 640px) { [data-template="zine"] .files { grid-template-columns: 1fr; } }

  /* --- Friendly: soft rounded cards, sage ground, Poppins --- */
  body[data-template="friendly"] { background: #eef1ea; color: #28352c; font-family: "Poppins", ui-sans-serif, sans-serif; }
  [data-template="friendly"] .subhead, [data-template="friendly"] .meta, [data-template="friendly"] .file-meta,
  [data-template="friendly"] .stale-note, [data-template="friendly"] .empty, [data-template="friendly"] .disc-sub,
  [data-template="friendly"] .c-head .role, [data-template="friendly"] .c-head .time, [data-template="friendly"] .footer,
  [data-template="friendly"] .footer a, [data-template="friendly"] .intro-count, [data-template="friendly"] .intro-step-body,
  [data-template="friendly"] .note-btn, [data-template="friendly"] .view-btn, [data-template="friendly"] .request-btn { color: #748177; }
  [data-template="friendly"] .empty, [data-template="friendly"] .footer, [data-template="friendly"] .note-btn,
  [data-template="friendly"] .view-btn, [data-template="friendly"] .request-btn, [data-template="friendly"] .c-input,
  [data-template="friendly"] .meta-item + .meta-item::before, [data-template="friendly"] .intro-dot { border-color: #dfe6da; }
  [data-template="friendly"] .intro, [data-template="friendly"] .composer, [data-template="friendly"] .c-input { background: #fff; }
  [data-template="friendly"] .file-badge { background: #e4ece0; color: #4d5c50; }
  [data-template="friendly"] h1 { font-family: "Poppins", ui-sans-serif, sans-serif; font-weight: 700; letter-spacing: -0.015em; font-size: clamp(28px, 4.4vw, 42px); }
  [data-template="friendly"] .hero { background: #fff; border: none; border-radius: 20px; padding: 28px 32px; box-shadow: 0 1px 3px rgba(40,53,44,0.06); }
  [data-template="friendly"] .welcome { font-family: "Poppins", ui-sans-serif, sans-serif; font-style: normal; }
  [data-template="friendly"] .intro { border: none; box-shadow: 0 1px 3px rgba(40,53,44,0.06); }
  [data-template="friendly"] .file, [data-template="friendly"] .comment { background: #fff; border: none; border-left: 4px solid var(--accent); border-radius: 12px; padding: 16px 18px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(40,53,44,0.05); }
  [data-template="friendly"] .file:first-child, [data-template="friendly"] .comment:first-child { padding-top: 16px; }
  [data-template="friendly"] .composer { border: none; box-shadow: 0 1px 3px rgba(40,53,44,0.06); }
  [data-template="friendly"] .note-btn, [data-template="friendly"] .view-btn, [data-template="friendly"] .approve-btn,
  [data-template="friendly"] .request-btn, [data-template="friendly"] .dl, [data-template="friendly"] .post-btn { font-family: "Poppins", ui-sans-serif, sans-serif; font-weight: 600; }
  [data-template="friendly"] .progress-ring { display: flex; top: 28px; right: 32px; background: #eef1ea; }
  [data-template="friendly"] .progress-ring-inner { background: #fff; }
  [data-template="friendly"] .progress-ring-value, [data-template="friendly"] .info-value { color: #28352c; }
  [data-template="friendly"] .progress-ring-label, [data-template="friendly"] .info-label { color: #748177; font-family: "Poppins", ui-sans-serif, sans-serif; }
  [data-template="friendly"] h1 { padding-right: 76px; }

  /* --- Gallery: museum wall label — white, Cormorant Garamond, roman numerals --- */
  body[data-template="gallery"] { background: #fff; color: #1a1a1a; font-family: "Cormorant Garamond", Georgia, serif; font-size: 17px; }
  [data-template="gallery"] .subhead, [data-template="gallery"] .meta, [data-template="gallery"] .file-meta,
  [data-template="gallery"] .stale-note, [data-template="gallery"] .empty, [data-template="gallery"] .disc-sub,
  [data-template="gallery"] .c-head .role, [data-template="gallery"] .c-head .time, [data-template="gallery"] .footer,
  [data-template="gallery"] .footer a, [data-template="gallery"] .intro-count, [data-template="gallery"] .intro-step-body,
  [data-template="gallery"] .note-btn, [data-template="gallery"] .view-btn, [data-template="gallery"] .request-btn { color: #8a8a8a; }
  [data-template="gallery"] .hero, [data-template="gallery"] .file, [data-template="gallery"] .comment,
  [data-template="gallery"] .empty, [data-template="gallery"] .footer, [data-template="gallery"] .note-btn,
  [data-template="gallery"] .view-btn, [data-template="gallery"] .request-btn, [data-template="gallery"] .composer,
  [data-template="gallery"] .c-input, [data-template="gallery"] .meta-item + .meta-item::before { border-color: #e2e2e2; }
  [data-template="gallery"] .intro { background: transparent; border: none; border-top: 1px solid #e2e2e2; border-radius: 0; padding: 22px 0; }
  [data-template="gallery"] .intro-close { top: 20px; right: 0; }
  [data-template="gallery"] .intro-eyebrow { margin-right: 20px; font-family: "Inter", sans-serif; font-size: 13px; }
  [data-template="gallery"] .file-badge { background: transparent; border: 1px solid #e2e2e2; color: #8a8a8a; }
  [data-template="gallery"] h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; letter-spacing: -0.005em; font-size: clamp(30px, 4.8vw, 46px); }
  [data-template="gallery"] .subhead { font-style: italic; }
  [data-template="gallery"] .meta { font-family: "Inter", sans-serif; text-transform: uppercase; font-size: 11px; letter-spacing: 0.12em; }
  [data-template="gallery"] .welcome { font-family: "Cormorant Garamond", Georgia, serif; font-size: 21px; }
  [data-template="gallery"] .files { counter-reset: gallery-file; }
  [data-template="gallery"] .file { counter-increment: gallery-file; position: relative; padding-left: 34px; }
  [data-template="gallery"] .file::before { content: counter(gallery-file, upper-roman) "."; position: absolute; left: 0; top: 18px; font-size: 13px; color: #8a8a8a; font-family: "Inter", sans-serif; }
  [data-template="gallery"] .note-btn, [data-template="gallery"] .view-btn, [data-template="gallery"] .approve-btn,
  [data-template="gallery"] .request-btn, [data-template="gallery"] .dl, [data-template="gallery"] .post-btn { border-radius: 0; font-family: "Inter", sans-serif; font-size: 12.5px; }
  [data-template="gallery"] .approve-btn { background: transparent; }
  [data-template="gallery"] .request-btn, [data-template="gallery"] .note-btn { border-color: transparent; text-decoration: underline; text-underline-offset: 3px; padding-left: 4px; padding-right: 4px; }

  /* --- Blueprint: technical spec sheet on graph paper, IBM Plex Mono --- */
  body[data-template="blueprint"] { background-color: #e9eef5; background-image: linear-gradient(rgba(15,41,66,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,41,66,0.08) 1px, transparent 1px); background-size: 22px 22px; color: #0f2942; font-family: "IBM Plex Mono", ui-monospace, monospace; }
  [data-template="blueprint"] .wrap { background: #fff; border: 2px solid #0f2942; margin: 32px auto; padding: 40px 32px 56px; }
  [data-template="blueprint"] .subhead, [data-template="blueprint"] .meta, [data-template="blueprint"] .file-meta,
  [data-template="blueprint"] .stale-note, [data-template="blueprint"] .empty, [data-template="blueprint"] .disc-sub,
  [data-template="blueprint"] .c-head .role, [data-template="blueprint"] .c-head .time, [data-template="blueprint"] .footer,
  [data-template="blueprint"] .footer a, [data-template="blueprint"] .intro-count, [data-template="blueprint"] .intro-step-body,
  [data-template="blueprint"] .note-btn, [data-template="blueprint"] .view-btn, [data-template="blueprint"] .request-btn,
  [data-template="blueprint"] .info-label, [data-template="blueprint"] .file-summary, [data-template="blueprint"] .signature-label { color: #5b7085; }
  [data-template="blueprint"] .hero, [data-template="blueprint"] .intro, [data-template="blueprint"] .file,
  [data-template="blueprint"] .comment, [data-template="blueprint"] .empty, [data-template="blueprint"] .footer,
  [data-template="blueprint"] .note-btn, [data-template="blueprint"] .view-btn, [data-template="blueprint"] .request-btn,
  [data-template="blueprint"] .composer, [data-template="blueprint"] .c-input,
  [data-template="blueprint"] .meta-item + .meta-item::before { border-color: rgba(15,41,66,0.25); }
  [data-template="blueprint"] .intro, [data-template="blueprint"] .composer, [data-template="blueprint"] .c-input { background: rgba(15,41,66,0.04); }
  [data-template="blueprint"] .file-badge { background: rgba(15,41,66,0.06); color: #0f2942; border-radius: 2px; }
  [data-template="blueprint"] h1 { font-family: "IBM Plex Mono", monospace; font-weight: 700; text-transform: uppercase; font-size: clamp(22px, 3.6vw, 32px); letter-spacing: 0; }
  [data-template="blueprint"] .meta-item { border: 1px solid rgba(15,41,66,0.25); padding: 3px 9px; }
  [data-template="blueprint"] .meta-item + .meta-item::before { display: none; }
  [data-template="blueprint"] .meta { gap: 8px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  [data-template="blueprint"] .welcome { font-family: "IBM Plex Mono", monospace; font-style: normal; font-size: 14px; }
  [data-template="blueprint"] .files { counter-reset: bp-file; }
  [data-template="blueprint"] .file { counter-increment: bp-file; }
  [data-template="blueprint"] .file-name::before { content: counter(bp-file, decimal-leading-zero) "  "; color: #5b7085; }
  [data-template="blueprint"] .note-btn, [data-template="blueprint"] .view-btn, [data-template="blueprint"] .approve-btn,
  [data-template="blueprint"] .request-btn, [data-template="blueprint"] .dl, [data-template="blueprint"] .post-btn { border-radius: 2px; text-transform: uppercase; letter-spacing: 0.05em; font-size: 12px; }
  [data-template="blueprint"] .approve-btn { background: #0f2942; color: #fff; border-color: #0f2942; }
  [data-template="blueprint"] .approve-btn:hover { opacity: 0.85; }
  [data-template="blueprint"] .info-panel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 24px 0 0; padding: 0; border: 1px solid rgba(15,41,66,0.35); }
  [data-template="blueprint"] .info-row { flex-direction: column; gap: 2px; padding: 8px 12px; border-right: 1px solid rgba(15,41,66,0.2); border-bottom: 1px solid rgba(15,41,66,0.2); }
  [data-template="blueprint"] .info-value { color: #0f2942; text-align: left; }
  [data-template="blueprint"] .file-table-head { display: flex; }
  [data-template="blueprint"] .file-summary { display: block; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 10px; border-top: 1px solid rgba(15,41,66,0.2); }
  [data-template="blueprint"] .signature-line { display: flex; }
  [data-template="blueprint"] .signature-field { border-top-color: rgba(15,41,66,0.35); }
  [data-template="blueprint"] .signature-label { text-transform: uppercase; letter-spacing: 0.05em; }

  /* --- Swiss: grid, big numerals, one confident accent — Space Grotesk --- */
  body[data-template="swiss"] { background: #f2efe9; color: #111; font-family: "Space Grotesk", ui-sans-serif, sans-serif; }
  [data-template="swiss"] .subhead, [data-template="swiss"] .meta, [data-template="swiss"] .file-meta,
  [data-template="swiss"] .stale-note, [data-template="swiss"] .empty, [data-template="swiss"] .disc-sub,
  [data-template="swiss"] .c-head .role, [data-template="swiss"] .c-head .time, [data-template="swiss"] .footer,
  [data-template="swiss"] .footer a, [data-template="swiss"] .intro-count, [data-template="swiss"] .intro-step-body,
  [data-template="swiss"] .note-btn, [data-template="swiss"] .view-btn, [data-template="swiss"] .request-btn { color: #6b6b63; }
  [data-template="swiss"] .hero, [data-template="swiss"] .intro, [data-template="swiss"] .file, [data-template="swiss"] .comment,
  [data-template="swiss"] .empty, [data-template="swiss"] .note-btn, [data-template="swiss"] .view-btn,
  [data-template="swiss"] .request-btn, [data-template="swiss"] .composer, [data-template="swiss"] .c-input,
  [data-template="swiss"] .meta-item + .meta-item::before { border-color: #ddd8cc; }
  [data-template="swiss"] .intro, [data-template="swiss"] .composer, [data-template="swiss"] .c-input { background: #f2efe9; }
  [data-template="swiss"] .file-badge { background: #e6e1d3; color: #6b6b63; border-radius: 3px; }
  [data-template="swiss"] .topbar { border-top: 3px double #111; padding-top: 14px; }
  [data-template="swiss"] h1 { font-family: "Space Grotesk", sans-serif; font-weight: 700; letter-spacing: -0.02em; font-size: clamp(32px, 5.4vw, 58px); }
  [data-template="swiss"] .disc-sub { color: var(--accent); }
  [data-template="swiss"] .files { counter-reset: swiss-file; }
  [data-template="swiss"] .file { counter-increment: swiss-file; }
  [data-template="swiss"] .file::before { content: counter(swiss-file, decimal-leading-zero); font-size: 26px; font-weight: 700; color: #111; margin-right: 4px; flex-shrink: 0; }
  [data-template="swiss"] .note-btn, [data-template="swiss"] .view-btn, [data-template="swiss"] .approve-btn,
  [data-template="swiss"] .request-btn, [data-template="swiss"] .dl, [data-template="swiss"] .post-btn { border-radius: 3px; font-family: "Space Grotesk", sans-serif; }
  [data-template="swiss"] .approve-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
  [data-template="swiss"] .approve-btn:hover { opacity: 0.85; }
  [data-template="swiss"] .info-panel { display: flex; flex-direction: row; gap: 28px; border-top: none; margin: -8px 0 32px; padding: 0; }
  [data-template="swiss"] .info-row { flex-direction: column; gap: 2px; }
  [data-template="swiss"] .info-value { color: #111; text-align: left; font-weight: 600; }
  [data-template="swiss"] .info-label { color: var(--accent); }

  /* --- App: vivid full-bleed accent header, Baloo 2, rounded and friendly-bold --- */
  body[data-template="app"] { background: #f5f7ff; color: #1a2240; font-family: "Baloo 2", ui-sans-serif, sans-serif; }
  [data-template="app"] .subhead, [data-template="app"] .file-meta, [data-template="app"] .stale-note,
  [data-template="app"] .empty, [data-template="app"] .disc-sub, [data-template="app"] .c-head .role,
  [data-template="app"] .c-head .time, [data-template="app"] .footer, [data-template="app"] .footer a,
  [data-template="app"] .intro-count, [data-template="app"] .intro-step-body,
  [data-template="app"] .note-btn, [data-template="app"] .view-btn, [data-template="app"] .request-btn { color: #68729a; }
  [data-template="app"] .intro, [data-template="app"] .file, [data-template="app"] .comment, [data-template="app"] .empty,
  [data-template="app"] .footer, [data-template="app"] .note-btn, [data-template="app"] .view-btn,
  [data-template="app"] .request-btn, [data-template="app"] .composer, [data-template="app"] .c-input { border-color: #e1e5f5; }
  [data-template="app"] .intro, [data-template="app"] .composer, [data-template="app"] .c-input { background: #fff; }
  [data-template="app"] .file-badge { background: #eef1ff; color: #4353a8; }
  [data-template="app"] h1 { font-family: "Baloo 2", sans-serif; font-weight: 800; letter-spacing: -0.01em; font-size: clamp(30px, 4.6vw, 44px); color: #fff; }
  [data-template="app"] .hero { background: var(--accent); color: #fff; border: none; margin: -56px -28px 32px; padding: 40px 28px 32px; border-radius: 0 0 24px 24px; }
  [data-template="app"] .subhead, [data-template="app"] .hero .meta, [data-template="app"] .hero .meta-item { color: rgba(255,255,255,0.82); }
  [data-template="app"] .hero .meta-item + .meta-item::before { color: rgba(255,255,255,0.5); }
  [data-template="app"] .hero .status-dot { background: #fff; }
  [data-template="app"] .welcome { font-family: "Baloo 2", sans-serif; font-style: normal; }
  [data-template="app"] .file, [data-template="app"] .comment { background: #f8f9ff; border: none; border-radius: 16px; padding: 16px 18px; margin-bottom: 10px; }
  [data-template="app"] .file:first-child, [data-template="app"] .comment:first-child { padding-top: 16px; }
  [data-template="app"] .note-btn, [data-template="app"] .view-btn, [data-template="app"] .approve-btn,
  [data-template="app"] .request-btn, [data-template="app"] .dl, [data-template="app"] .post-btn { font-family: "Baloo 2", sans-serif; font-weight: 700; padding: 9px 18px; }
  [data-template="app"] .progress-ring { display: flex; background: rgba(255,255,255,0.3); }
  [data-template="app"] .progress-ring-inner { background: #fff; }
  [data-template="app"] .progress-ring-value { color: #1a2240; }
  [data-template="app"] .progress-ring-label { color: #68729a; font-family: "Baloo 2", sans-serif; }
  [data-template="app"] h1 { padding-right: 76px; }

  /* --- Letterhead: elegant Playfair serif headline, thin double rules --- */
  body[data-template="letterhead"] { background: #fff; color: #1c1c1c; }
  [data-template="letterhead"] .subhead, [data-template="letterhead"] .meta, [data-template="letterhead"] .file-meta,
  [data-template="letterhead"] .stale-note, [data-template="letterhead"] .empty, [data-template="letterhead"] .disc-sub,
  [data-template="letterhead"] .c-head .role, [data-template="letterhead"] .c-head .time, [data-template="letterhead"] .footer,
  [data-template="letterhead"] .footer a, [data-template="letterhead"] .intro-count, [data-template="letterhead"] .intro-step-body,
  [data-template="letterhead"] .note-btn, [data-template="letterhead"] .view-btn, [data-template="letterhead"] .request-btn,
  [data-template="letterhead"] .info-label, [data-template="letterhead"] .signature-label { color: #7a7a72; }
  [data-template="letterhead"] .hero, [data-template="letterhead"] .intro, [data-template="letterhead"] .file,
  [data-template="letterhead"] .comment, [data-template="letterhead"] .empty, [data-template="letterhead"] .note-btn,
  [data-template="letterhead"] .view-btn, [data-template="letterhead"] .request-btn, [data-template="letterhead"] .composer,
  [data-template="letterhead"] .c-input, [data-template="letterhead"] .meta-item + .meta-item::before { border-color: #e7e3da; }
  [data-template="letterhead"] .intro, [data-template="letterhead"] .composer, [data-template="letterhead"] .c-input { background: #fbfaf7; }
  [data-template="letterhead"] .file-badge { background: #f2efe7; color: #7a7a72; }
  [data-template="letterhead"] .topbar { border-bottom: 3px double #1c1c1c; padding-bottom: 14px; }
  [data-template="letterhead"] h1 { font-family: "Playfair Display", Georgia, serif; font-weight: 700; letter-spacing: -0.005em; font-size: clamp(30px, 4.8vw, 48px); }
  [data-template="letterhead"] .quote-mark { display: none; }
  [data-template="letterhead"] .welcome-wrap { border-left: 2px solid var(--accent); padding-left: 18px; }
  [data-template="letterhead"] .welcome { font-style: italic; }
  [data-template="letterhead"] .note-btn, [data-template="letterhead"] .view-btn, [data-template="letterhead"] .approve-btn,
  [data-template="letterhead"] .request-btn, [data-template="letterhead"] .dl, [data-template="letterhead"] .post-btn { border-radius: 6px; }
  [data-template="letterhead"] .approve-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
  [data-template="letterhead"] .approve-btn:hover { opacity: 0.85; }
  [data-template="letterhead"] .info-panel { display: flex; flex-direction: row; gap: 32px; border-top: none; border-bottom: 1px solid #e7e3da; padding: 0 0 20px; margin: -4px 0 32px; }
  [data-template="letterhead"] .info-row { flex-direction: column; gap: 3px; }
  [data-template="letterhead"] .info-value { color: #1c1c1c; text-align: left; font-family: "Playfair Display", serif; }
  [data-template="letterhead"] .signature-line { display: flex; }
  [data-template="letterhead"] .signature-field { border-top-color: #e7e3da; }
  [data-template="letterhead"] .signature-label { text-transform: none; letter-spacing: 0.02em; font-style: italic; font-family: "Playfair Display", serif; }

  /* --- Manifest: monochrome business record, tabular, Inter only --- */
  body[data-template="manifest"] { background: #fff; color: #111; }
  [data-template="manifest"] .subhead, [data-template="manifest"] .meta, [data-template="manifest"] .file-meta,
  [data-template="manifest"] .stale-note, [data-template="manifest"] .empty, [data-template="manifest"] .disc-sub,
  [data-template="manifest"] .c-head .role, [data-template="manifest"] .c-head .time, [data-template="manifest"] .footer,
  [data-template="manifest"] .footer a, [data-template="manifest"] .intro-count, [data-template="manifest"] .intro-step-body,
  [data-template="manifest"] .note-btn, [data-template="manifest"] .view-btn, [data-template="manifest"] .request-btn,
  [data-template="manifest"] .info-label, [data-template="manifest"] .file-summary, [data-template="manifest"] .signature-label { color: #666; }
  [data-template="manifest"] .hero, [data-template="manifest"] .intro, [data-template="manifest"] .file,
  [data-template="manifest"] .comment, [data-template="manifest"] .empty, [data-template="manifest"] .note-btn,
  [data-template="manifest"] .view-btn, [data-template="manifest"] .request-btn, [data-template="manifest"] .composer,
  [data-template="manifest"] .c-input, [data-template="manifest"] .meta-item + .meta-item::before { border-color: #ddd; }
  [data-template="manifest"] .intro, [data-template="manifest"] .composer, [data-template="manifest"] .c-input { background: #fafafa; }
  [data-template="manifest"] .file-badge { background: #f0f0f0; color: #444; border-radius: 3px; }
  [data-template="manifest"] .logo-text { text-transform: lowercase; font-weight: 700; }
  [data-template="manifest"] .topbar { border-bottom: 3px solid #111; padding-bottom: 14px; }
  [data-template="manifest"] h1 { font-weight: 800; letter-spacing: -0.02em; }
  [data-template="manifest"] .files { counter-reset: mf-file; }
  [data-template="manifest"] .file { counter-increment: mf-file; }
  [data-template="manifest"] .file-name::before { content: counter(mf-file, decimal-leading-zero) "  "; color: #999; font-weight: 400; }
  [data-template="manifest"] .note-btn, [data-template="manifest"] .view-btn, [data-template="manifest"] .approve-btn,
  [data-template="manifest"] .request-btn, [data-template="manifest"] .dl, [data-template="manifest"] .post-btn { border-radius: 6px; }
  [data-template="manifest"] .approve-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
  [data-template="manifest"] .approve-btn:hover { opacity: 0.85; }
  [data-template="manifest"] .info-panel { display: flex; flex-direction: row; flex-wrap: wrap; gap: 20px 28px; border-top: 1px solid #ddd; border-bottom: none; }
  [data-template="manifest"] .info-row { flex-direction: column; gap: 2px; }
  [data-template="manifest"] .info-value { color: #111; text-align: left; }
  [data-template="manifest"] .file-table-head { display: flex; }
  [data-template="manifest"] .file-summary { display: block; padding-top: 10px; border-top: 1px solid #ddd; }
  [data-template="manifest"] .signature-line { display: flex; }
</style>
</head>
<body data-template="${template}">
  <div class="wrap">
    <div class="topbar">
      <div class="logo">${logo}</div>
    </div>

    <div class="hero">
      ${heroStatHtml}
      ${progressRingHtml}
      <h1>${esc(b.headline)}</h1>
      <p class="subhead">${esc(b.subhead)}</p>
      <p class="meta">
        <span class="meta-item"><span class="status-dot${handover.status === "Draft" ? " status-draft" : ""}"></span>${esc(handover.status)}</span>
        ${handover.recipient || handover.clientName ? `<span class="meta-item">For ${esc([handover.clientName, handover.recipient].filter(Boolean).join(" — "))}</span>` : ""}
        ${handover.created ? `<span class="meta-item">${esc(handover.created)}</span>` : ""}
      </p>
    </div>

    ${infoPanelHtml}

    ${
      handover.status === "Draft"
        ? `<p class="draft-notice">This delivery hasn't been sent yet — you're viewing a preview. Files can be opened, but approving or requesting changes is disabled until it's sent.</p>`
        : ""
    }
    <div class="welcome-wrap">
      <span class="quote-mark" aria-hidden="true">&ldquo;</span>
      <p class="welcome">${esc(b.welcome)}</p>
    </div>

    <div class="intro" id="intro-box">
      <button type="button" class="intro-close" id="intro-close" aria-label="Dismiss">&times;</button>
      <div class="intro-eyebrow">How this page works <span class="intro-count" id="intro-count">1 / 5</span></div>
      <div class="intro-bar"><div class="intro-bar-fill" id="intro-bar-fill"></div></div>
      <div class="intro-stage" id="intro-stage">
        <div class="intro-step" data-step="0" style="display:block">
          <div class="intro-step-label">View</div>
          <div class="intro-step-body">Open a file full-screen. On images, click anywhere to drop a comment pinned to that exact spot.</div>
        </div>
        <div class="intro-step" data-step="1">
          <div class="intro-step-label">Approve</div>
          <div class="intro-step-body">Mark a file ready to ship — the studio is notified the moment you do.</div>
        </div>
        <div class="intro-step" data-step="2">
          <div class="intro-step-label">Request changes</div>
          <div class="intro-step-body">Not quite right? Say so, and it goes straight back to the studio.</div>
        </div>
        <div class="intro-step" data-step="3">
          <div class="intro-step-label">Download</div>
          <div class="intro-step-body">Unlocks automatically the moment a file is approved.</div>
        </div>
        <div class="intro-step" data-step="4">
          <div class="intro-step-label">+ Note</div>
          <div class="intro-step-body">Leave a general note anytime — it doesn't need to be tied to one file.</div>
        </div>
      </div>
      <div class="intro-controls">
        <div class="intro-dots" id="intro-dots">
          <button type="button" class="intro-dot active" data-goto="0" aria-label="Step 1 of 5"></button>
          <button type="button" class="intro-dot" data-goto="1" aria-label="Step 2 of 5"></button>
          <button type="button" class="intro-dot" data-goto="2" aria-label="Step 3 of 5"></button>
          <button type="button" class="intro-dot" data-goto="3" aria-label="Step 4 of 5"></button>
          <button type="button" class="intro-dot" data-goto="4" aria-label="Step 5 of 5"></button>
        </div>
        <div class="intro-nav">
          <button type="button" class="intro-back" id="intro-back" hidden>Back</button>
          <button type="button" class="intro-next" id="intro-next">Next</button>
        </div>
      </div>
    </div>

    <div class="section-title">
      <h2>Files</h2>
      <span class="count">${files.length} item${files.length === 1 ? "" : "s"}</span>
    </div>
    ${fileTableHeadHtml}
    <div class="files">${filesHtml}</div>
    ${fileSummaryHtml}

    ${discussionHtml}

    ${signatureHtml}

    <div class="footer">
      <span>Delivered by ${esc(b.studioName)}</span>
      <span>Powered by <a href="/">Desboard</a></span>
    </div>
  </div>
  ${lightboxHtml}
  ${commentScript}
</body>
</html>`;
}
