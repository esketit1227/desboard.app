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
import type { Handover, HandoverApprovals, HandoverBranding, HandoverComment, VaultFile } from "../types";

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

  // Theme tokens — same cool-neutral identity as the studio app's own design
  // system (src/index.css), not the old warm cream/near-black prototype look.
  const c = dark
    ? { bg: "#0a0a0a", panel: "#1c1c1e", card: "#1c1c1e", text: "#f5f5f7", muted: "rgba(245,245,247,0.55)", border: "rgba(255,255,255,0.09)", chip: "rgba(255,255,255,0.05)" }
    : { bg: "#f5f5f7", panel: "#ffffff", card: "#ffffff", text: "#1d1d1f", muted: "#86868b", border: "#e5e5ea", chip: "#eeeef1" };

  const statusBadge = `<span class="status">${esc(handover.status)}</span>`;

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
          if (status === "approved") {
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

          return `
        <div class="file">
          <div class="file-badge">${esc(fileExtLabel(f))}</div>
          <div class="file-info">
            <div class="file-name">${esc(f.name)}</div>
            <div class="file-meta">${esc(f.size || (f.type === "folder" ? "Folder" : "—"))}${f.status ? " &middot; " + esc(f.status) : ""}</div>
            ${noteHtml}
          </div>
          <button type="button" class="note-btn" data-file="${esc(f.id)}">+ Note</button>
          ${viewBtn}
          ${actionHtml}
        </div>`;
        })
        .join("")
    : `<div class="empty">No files attached to this handover yet.</div>`;

  const nameById = (id?: string | null) => (id ? files.find((f) => f.id === id)?.name ?? "a file" : "");

  const commentsHtml = comments.length
    ? comments
        .map((cm) => {
          const isDesigner = cm.role === "designer";
          const roleLabel = isDesigner ? "Studio" : "Client";
          const isPin = cm.fileId && typeof cm.x === "number" && typeof cm.y === "number";
          const onChip = cm.fileId
            ? `<span class="on" ${isPin ? `data-pin-file="${esc(cm.fileId)}" role="button" tabindex="0"` : ""}>${
                isPin ? "📍 pinned on " : "on "
              }${esc(nameById(cm.fileId))}</span>`
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

  const lightboxHtml = `
    <div id="lightbox" class="lightbox" aria-hidden="true">
      <div class="lb-topbar">
        <span id="lb-title" class="lb-title"></span>
        <div class="lb-actions">
          <span id="lb-approved" class="lb-approved-note" style="display:none"></span>
          <button type="button" id="lb-approve" class="approve-btn">Approve</button>
          <button type="button" id="lb-request-changes" class="request-btn">Request changes</button>
          <a id="lb-download" class="dl" style="display:none" download>Download</a>
          <button type="button" id="lb-close" class="lb-close" aria-label="Close preview">✕</button>
        </div>
      </div>
      <div id="lb-stage" class="lb-stage"></div>
      <p id="lb-hint" class="lb-hint">Click anywhere on the image to leave feedback at that point.</p>
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
    }
  > = {};
  files.forEach((f) => {
    const approval = approvals[f.id];
    const stale = !!approval && approval.version !== currentVersionOf(f);
    fileMeta[f.id] = {
      name: f.name,
      kind: previewKind(f),
      viewHref: viewHrefs[f.id] ?? null,
      downloadHref: downloadHrefs[f.id] ?? null,
      status: approval && !stale ? approval.status : null,
    };
  });
  const pins = comments
    .filter((cm): cm is HandoverComment & { fileId: string; x: number; y: number } => !!cm.fileId && typeof cm.x === "number" && typeof cm.y === "number")
    .map((cm) => ({ id: cm.id, fileId: cm.fileId, x: cm.x, y: cm.y, author: cm.author, body: cm.body }));

  const commentScript = `
    <script>
    (function(){
      var TOKEN = ${jsonScript(handover.token)};
      var COMMENTS_API = ${jsonScript(`/api/portal/${handover.token}/comments`)};
      var APPROVE_API_BASE = ${jsonScript(`/api/portal/${handover.token}/file/`)};
      var FILE_META = ${jsonScript(fileMeta)};
      var PINS = ${jsonScript(pins)};
      var CLIENT_NAME = ${jsonScript(handover.clientName || "")};

      function savedName(){
        try { return localStorage.getItem('desboard_handover_name') || CLIENT_NAME || ''; } catch(e){ return CLIENT_NAME || ''; }
      }
      function saveName(v){
        try { if (v) localStorage.setItem('desboard_handover_name', v); } catch(e){}
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

      function closePinComposer(){
        pendingPin = null;
        if (pinComposer) pinComposer.hidden = true;
        if (pinBodyEl) pinBodyEl.value = '';
      }

      function renderPins(fileId){
        var wrap = stage.querySelector('.lb-image-wrap');
        if (!wrap) return;
        Array.prototype.forEach.call(wrap.querySelectorAll('.pin-marker'), function(el){ el.remove(); });
        var n = 0;
        PINS.filter(function(p){ return p.fileId === fileId; }).forEach(function(p){
          n += 1;
          var marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'pin-marker';
          marker.style.left = p.x + '%';
          marker.style.top = p.y + '%';
          marker.textContent = String(n);
          marker.title = p.author + ': ' + p.body;
          wrap.appendChild(marker);
        });
      }

      function openLightbox(fileId){
        var meta = FILE_META[fileId];
        if (!meta || !lightbox || !stage) return;
        currentFileId = fileId;
        closePinComposer();
        lbTitle.textContent = meta.name;
        stage.innerHTML = '';

        if (meta.kind === 'image' && meta.viewHref) {
          var wrap = document.createElement('div');
          wrap.className = 'lb-image-wrap';
          var img = document.createElement('img');
          img.src = meta.viewHref;
          img.alt = meta.name;
          img.addEventListener('click', function(e){
            var rect = img.getBoundingClientRect();
            var x = ((e.clientX - rect.left) / rect.width) * 100;
            var y = ((e.clientY - rect.top) / rect.height) * 100;
            pendingPin = { x: x, y: y };
            if (pinComposer) {
              pinComposer.hidden = false;
              if (pinNameEl) pinNameEl.value = savedName();
              if (pinBodyEl) pinBodyEl.focus();
            }
          });
          wrap.appendChild(img);
          stage.appendChild(wrap);
          renderPins(fileId);
          if (lbHint) lbHint.style.display = '';
        } else if (meta.kind === 'pdf' && meta.viewHref) {
          var frame = document.createElement('iframe');
          frame.src = meta.viewHref;
          frame.title = meta.name;
          frame.className = 'lb-pdf-frame';
          stage.appendChild(frame);
          if (lbHint) lbHint.style.display = 'none';
        } else if (meta.kind === 'video' && meta.viewHref) {
          var video = document.createElement('video');
          video.src = meta.viewHref;
          video.controls = true;
          video.className = 'lb-video';
          stage.appendChild(video);
          if (lbHint) lbHint.style.display = 'none';
        } else {
          var msg = document.createElement('div');
          msg.className = 'lb-no-preview';
          msg.textContent = 'No inline preview available for this file.';
          stage.appendChild(msg);
          if (lbHint) lbHint.style.display = 'none';
        }

        if (meta.status === 'approved') {
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
      }

      Array.prototype.forEach.call(document.querySelectorAll('.view-btn'), function(btn){
        btn.addEventListener('click', function(){
          var fileId = btn.getAttribute('data-file');
          if (fileId) openLightbox(fileId);
        });
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-pin-file]'), function(el){
        el.addEventListener('click', function(){ openLightbox(el.getAttribute('data-pin-file')); });
      });

      if (lbClose) lbClose.addEventListener('click', closeLightbox);
      if (lightbox) lightbox.addEventListener('click', function(e){ if (e.target === lightbox) closeLightbox(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeLightbox(); });

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
        if (!body) return;
        saveName(author);
        pinPostBtn.disabled = true;
        pinPostBtn.textContent = 'Posting…';
        postComment({ author: author, body: body, fileId: currentFileId, x: pendingPin.x, y: pendingPin.y }, function(){
          location.hash = 'view=' + encodeURIComponent(currentFileId);
          location.reload();
        }).catch(function(){ pinPostBtn.disabled = false; pinPostBtn.textContent = 'Post pin'; alert('Could not post your note. Please try again.'); });
      });

      var hashMatch = /^#view=([^&]+)/.exec(location.hash);
      if (hashMatch) openLightbox(decodeURIComponent(hashMatch[1]));
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
  .logo-text { font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
  .eyebrow { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: ${c.muted}; font-weight: 600; }
  .hero { padding: 8px 0 28px; border-bottom: 1px solid ${c.border}; margin-bottom: 28px; }
  h1 { font-weight: 700; font-size: clamp(30px, 6vw, 46px); line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 12px; }
  .subhead { font-size: 16px; color: ${c.muted}; margin: 0 0 18px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .status { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 12px; border-radius: 999px; color: var(--accent); border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .pill { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${c.muted}; background: ${c.chip}; border: 1px solid ${c.border}; padding: 5px 12px; border-radius: 999px; }
  .welcome { background: ${c.panel}; border: 1px solid ${c.border}; border-radius: 16px; padding: 22px 24px; margin-bottom: 34px; font-size: 15px; color: ${c.text}; }
  .section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  .section-title h2 { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; margin: 0; }
  .section-title .count { font-size: 12px; color: ${c.muted}; }
  .files { display: flex; flex-direction: column; gap: 10px; }
  .file { display: flex; align-items: center; gap: 12px; background: ${c.card}; border: 1px solid ${c.border}; border-radius: 14px; padding: 14px 16px; transition: border-color .15s; flex-wrap: wrap; }
  .file:hover { border-color: var(--accent); }
  .file-badge { flex-shrink: 0; width: 46px; height: 46px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
  .file-info { flex: 1; min-width: 140px; }
  .file-name { font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta { font-size: 11px; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 3px; }
  .approved-note { font-size: 11px; color: var(--accent); margin-top: 3px; }
  .changes-note { font-size: 11px; color: #c0392b; margin-top: 3px; font-weight: 600; }
  .stale-note { font-size: 11px; color: ${c.muted}; margin-top: 3px; font-style: italic; }
  .link-btn { background: none; border: none; padding: 0; margin: 0; color: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: inherit; font-family: inherit; }
  .dl { flex-shrink: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--accent); padding: 9px 16px; border-radius: 999px; cursor: pointer; user-select: none; text-decoration: none; display: inline-block; border: none; }
  .dl:hover { opacity: 0.9; }
  .dl-off { opacity: 0.45; cursor: default; }
  .empty { color: ${c.muted}; font-size: 14px; text-align: center; padding: 28px; border: 1px dashed ${c.border}; border-radius: 14px; }
  .note-btn, .view-btn, .approve-btn, .request-btn { flex-shrink: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: transparent; padding: 8px 12px; border-radius: 999px; cursor: pointer; transition: color .15s, border-color .15s, background .15s; font-family: inherit; }
  .note-btn, .view-btn, .request-btn { color: ${c.muted}; border: 1px solid ${c.border}; }
  .note-btn:hover, .view-btn:hover, .request-btn:hover { color: #c0392b; border-color: #c0392b; }
  .approve-btn { color: var(--accent); border: 1px solid var(--accent); }
  .approve-btn:hover { background: var(--accent); color: #fff; }
  .approve-btn:disabled, .post-btn:disabled, .request-btn:disabled { opacity: 0.6; cursor: default; }

  .disc-sub { font-size: 13px; color: ${c.muted}; margin: -6px 0 16px; }
  .thread { display: flex; flex-direction: column; gap: 12px; margin-bottom: 22px; }
  .comment { background: ${c.card}; border: 1px solid ${c.border}; border-left: 3px solid ${c.border}; border-radius: 12px; padding: 14px 16px; }
  .comment.designer { border-left-color: var(--accent); }
  .c-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .c-head .who { font-weight: 600; font-size: 13px; }
  .c-head .role { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${c.muted}; background: ${c.chip}; border: 1px solid ${c.border}; padding: 2px 8px; border-radius: 999px; }
  .comment.designer .role { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .c-head .on { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .c-head .on[data-pin-file] { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
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
  .post-btn { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--accent); border: none; padding: 11px 22px; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .lb-cancel-btn { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${c.muted}; background: transparent; border: 1px solid ${c.border}; padding: 11px 18px; border-radius: 999px; cursor: pointer; font-family: inherit; }

  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid ${c.border}; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${c.muted}; }
  .footer a { color: var(--accent); text-decoration: none; }

  /* --- Lightbox: always dark, independent of page theme (it's a media viewer) --- */
  .lightbox { position: fixed; inset: 0; background: rgba(6,6,8,0.96); z-index: 999; display: none; flex-direction: column; }
  .lightbox.open { display: flex; }
  .lb-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; flex-shrink: 0; }
  .lb-title { color: #f5f5f7; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lb-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .lb-approved-note { font-size: 11px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
  .lb-close { background: transparent; border: none; color: #f5f5f7; font-size: 16px; cursor: pointer; padding: 6px 10px; line-height: 1; }
  .lb-close:hover { color: var(--accent); }
  .lb-stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 20px; min-height: 0; }
  .lb-image-wrap { position: relative; display: inline-block; max-width: 90vw; max-height: 74vh; }
  .lb-image-wrap img { display: block; max-width: 90vw; max-height: 74vh; object-fit: contain; border-radius: 4px; cursor: crosshair; }
  .lb-pdf-frame { width: 88vw; height: 78vh; border: 0; border-radius: 4px; background: #fff; }
  .lb-video { max-width: 88vw; max-height: 78vh; border-radius: 4px; }
  .lb-no-preview { color: rgba(245,245,247,0.5); font-size: 13px; }
  .lb-hint { text-align: center; color: rgba(245,245,247,0.45); font-size: 11px; margin: 0 0 10px; flex-shrink: 0; }
  .pin-marker { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; border: 2px solid #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
  .pin-composer { flex-shrink: 0; max-width: 480px; width: calc(100% - 40px); margin: 0 auto 20px; background: #1c1c1e; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .pin-composer .c-input { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: #f5f5f7; }
  .pin-composer-actions { display: flex; justify-content: flex-end; gap: 8px; }
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
        ${handover.recipient || handover.clientName ? `<span class="pill">For ${esc([handover.clientName, handover.recipient].filter(Boolean).join(" — "))}</span>` : ""}
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
  ${lightboxHtml}
  ${commentScript}
</body>
</html>`;
}
