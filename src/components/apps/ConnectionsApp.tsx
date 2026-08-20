import { useEffect, useState } from "react";
import { Cloud, HardDrive, Database, Folder, FileText, Download, ChevronRight, AlertCircle } from "lucide-react";
import { api } from "../../lib/api";
import type { OAuthBrowseItem, OAuthProviderId, OAuthStatus } from "../../types";

const PROVIDERS: { id: OAuthProviderId; label: string; icon: typeof Cloud }[] = [
  { id: "google", label: "Google Drive", icon: Cloud },
  { id: "dropbox", label: "Dropbox", icon: HardDrive },
  { id: "onedrive", label: "OneDrive", icon: Database },
];

/**
 * Real Google Drive / Dropbox / OneDrive connections: connect via OAuth,
 * browse, and import a copy of a file into Desboard's own storage. Replaces
 * the fake `linkedDrive`/`linkedDropbox` toggles that used to live in File
 * Vault. iCloud Drive is deliberately not offered here — Apple has no public
 * API for third-party file access to it (unlike the other three), so a
 * "Connect iCloud" button would have nothing real to do.
 */
export function ConnectionsApp({ showToast }: { showToast: (msg: string) => void }) {
  const [statuses, setStatuses] = useState<Partial<Record<OAuthProviderId, OAuthStatus>>>({});
  const [browsing, setBrowsing] = useState<OAuthProviderId | null>(null);
  const [path, setPath] = useState<{ id: string | undefined; name: string }[]>([{ id: undefined, name: "Root" }]);
  const [items, setItems] = useState<OAuthBrowseItem[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadStatuses = () => {
    PROVIDERS.forEach((p) => {
      api
        .getOAuthStatus(p.id)
        .then((s) => setStatuses((prev) => ({ ...prev, [p.id]: s })))
        .catch(() => {});
    });
  };

  useEffect(loadStatuses, []);

  const loadFolder = (provider: OAuthProviderId, folderId: string | undefined) => {
    setItems(null);
    setBrowseError(null);
    api
      .browseOAuth(provider, folderId)
      .then((r) => setItems(r.items))
      .catch(() => setBrowseError("Couldn't load this connection — it may need to be reconnected."));
  };

  const openBrowser = (provider: OAuthProviderId) => {
    setBrowsing(provider);
    setPath([{ id: undefined, name: "Root" }]);
    loadFolder(provider, undefined);
  };

  const openFolder = (item: OAuthBrowseItem) => {
    if (!browsing) return;
    setPath((p) => [...p, { id: item.id, name: item.name }]);
    loadFolder(browsing, item.id);
  };

  const goToBreadcrumb = (index: number) => {
    if (!browsing) return;
    const next = path.slice(0, index + 1);
    setPath(next);
    loadFolder(browsing, next[next.length - 1].id);
  };

  const disconnect = (provider: OAuthProviderId) => {
    api.disconnectOAuth(provider).then(() => {
      showToast(`Disconnected ${PROVIDERS.find((p) => p.id === provider)?.label}`);
      if (browsing === provider) setBrowsing(null);
      loadStatuses();
    });
  };

  const importFile = (item: OAuthBrowseItem) => {
    if (!browsing) return;
    setImportingId(item.id);
    api
      .importOAuthFile(browsing, { fileId: item.id, name: item.name, mimeType: item.mimeType })
      .then(() => showToast(`Imported "${item.name}"`))
      .catch(() => showToast("Import failed — try again"))
      .finally(() => setImportingId(null));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PROVIDERS.map((p) => {
          const status = statuses[p.id];
          return (
            <div key={p.id} className="rounded-xl bg-panel border border-line p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-9 h-9 rounded-lg bg-chip flex items-center justify-center text-ink/70 shrink-0">
                  <p.icon className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink">{p.label}</div>
                  <div className="text-[12px] text-muted truncate">
                    {status?.connected ? status.accountLabel || "Connected" : "Not connected"}
                  </div>
                </div>
              </div>

              {status?.lastError && (
                <div className="flex items-start gap-1.5 text-[12px] text-amber mb-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{status.lastError}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                {status?.connected ? (
                  <>
                    <button
                      onClick={() => openBrowser(p.id)}
                      className="text-[12.5px] font-medium text-ink bg-paper hover:bg-line/60 rounded-full px-3 py-1.5 transition-colors"
                    >
                      Browse
                    </button>
                    <button
                      onClick={() => disconnect(p.id)}
                      className="text-[12.5px] font-medium text-muted hover:text-ink transition-colors px-3 py-1.5"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <a
                    href={`/api/oauth/${p.id}/connect`}
                    className="text-[12.5px] font-medium text-white bg-primary hover:bg-primary/85 rounded-full px-3 py-1.5 transition-colors"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {browsing && (
        <div className="rounded-xl bg-panel border border-line p-4">
          <div className="flex items-center gap-1 text-[12.5px] text-muted mb-3 flex-wrap">
            {path.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                <button onClick={() => goToBreadcrumb(i)} className="hover:text-ink transition-colors">
                  {p.name}
                </button>
              </span>
            ))}
          </div>

          {browseError ? (
            <div className="text-center py-8 text-[13px] text-muted">{browseError}</div>
          ) : items === null ? (
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-chip animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-muted">This folder is empty.</div>
          ) : (
            <div className="flex flex-col">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-2 border-b border-line last:border-b-0">
                  {item.isFolder ? <Folder className="w-4 h-4 text-muted shrink-0" /> : <FileText className="w-4 h-4 text-muted shrink-0" />}
                  {item.isFolder ? (
                    <button onClick={() => openFolder(item)} className="text-[13px] text-ink text-left truncate hover:underline">
                      {item.name}
                    </button>
                  ) : (
                    <span className="text-[13px] text-ink truncate">{item.name}</span>
                  )}
                  {!item.isFolder && (
                    <button
                      onClick={() => importFile(item)}
                      disabled={importingId === item.id}
                      title="Import a copy into Desboard"
                      className="ml-auto shrink-0 flex items-center gap-1.5 text-[12px] font-medium text-ink bg-paper hover:bg-line/60 disabled:opacity-50 rounded-full px-2.5 py-1 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      {importingId === item.id ? "Importing…" : "Import"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
