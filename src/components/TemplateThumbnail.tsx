import { useMemo } from "react";
import type { Handover, VaultFile, HandoverTemplate } from "../types";
import { renderHandoverPage } from "../lib/handoverPage";

/**
 * Fixed sample content so every template thumbnail (and the two pickers that
 * use them) renders the same scene — only the template/theme/accent differ,
 * which is what actually needs comparing.
 */
const SAMPLE_HANDOVER: Handover = {
  id: "sample",
  projectId: "sample",
  title: "Round 1 — Logo & Palette",
  recipient: "Meridian Coffee",
  clientName: "Jordan",
  note: "Second round is ready — let me know what you think, especially on the color direction.",
  status: "Sent",
  fileIds: ["sample-1", "sample-2"],
  created: "Aug 23, 2026",
  token: "sample",
  accessMode: "public",
  revoked: false,
};

const SAMPLE_FILES: VaultFile[] = [
  {
    id: "sample-1",
    name: "Brand-Guidelines.pdf",
    type: "file",
    extension: "pdf",
    size: "2.1 MB",
    created: "Aug 23, 2026",
    owner: "You",
    source: "Desboard",
    tags: [],
    status: "Approved",
    versions: [{ version: "v1.0", date: "Aug 23, 2026", author: "You", latest: true }],
    access: ["Team"],
  },
  {
    id: "sample-2",
    name: "Homepage-Hero.png",
    type: "file",
    extension: "png",
    created: "Aug 23, 2026",
    owner: "You",
    source: "Desboard",
    tags: [],
    status: "Draft",
    versions: [{ version: "v1.0", date: "Aug 23, 2026", author: "You", latest: true }],
    access: ["Team"],
  },
];

// The real page's .wrap maxes out at 800px; rendering the iframe at its
// natural size and scaling down (rather than trying to author a separate
// small-screen layout) is what keeps a thumbnail pixel-true to the real page.
const NATURAL_WIDTH = 800;
const NATURAL_HEIGHT = 640;

export function TemplateThumbnail({
  template,
  accent,
  theme,
  width = 168,
  height = 118,
  className = "",
}: {
  template: HandoverTemplate;
  accent: string;
  theme: "light" | "dark";
  width?: number;
  height?: number;
  className?: string;
}) {
  const srcDoc = useMemo(
    () =>
      renderHandoverPage({
        handover: { ...SAMPLE_HANDOVER, branding: { accent, theme, template, studioName: "Chen Studio" } },
        files: SAMPLE_FILES,
      }),
    [template, accent, theme]
  );
  const scale = width / NATURAL_WIDTH;

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-line bg-white ${className}`}
      style={{ width, height }}
    >
      <iframe
        srcDoc={srcDoc}
        title=""
        tabIndex={-1}
        aria-hidden="true"
        scrolling="no"
        style={{
          width: NATURAL_WIDTH,
          height: NATURAL_HEIGHT,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
