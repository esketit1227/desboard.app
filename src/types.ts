/**
 * Shared type definitions.
 *
 * These describe the shapes of the data that flow between the SQLite database,
 * the Express backend, and the React frontend. Keeping them in one file means
 * the server (db.ts / server.ts) and the UI components agree on the exact same
 * structure — if you change a field here, TypeScript will flag every place that
 * needs updating.
 */

export type FileStatus = "Draft" | "Review" | "Approved" | "Delivered";

export interface FileVersion {
  version: string;
  date: string;
  author: string;
  latest?: boolean;
}

/** A file (or folder) stored in the File Vault. */
export interface VaultFile {
  id: string;
  name: string;
  type: "file" | "folder";
  extension?: string;
  size?: string;
  created: string;
  owner: string;
  source: string;
  tags: string[];
  status: FileStatus;
  /** Which vault project the file is filed under (1 = Nebula, 2 = Acme, 3 = GlobalNet), or null. */
  projectId?: number | null;
  clientId?: string | null;
  versions: FileVersion[];
  access: string[];
  /** MIME type of the stored binary, when one was uploaded. */
  mime?: string;
  /** True when Desboard holds the file's actual bytes (real preview/download). */
  hasContent?: boolean;
  /** Raw byte count of the current version's content, for storage-quota accounting — `size` above is a display-formatted string ("8.3 MB"), not usable for that math. */
  sizeBytes?: number;
  /** ISO timestamp of the last time `status` changed. Unset for files predating this column. */
  statusChangedAt?: string;
  /** The folder (another VaultFile with type "folder") this item lives inside, or null/unset for the project's root. Real nesting, not just a label. */
  parentId?: string | null;
}

export type ProjectStatus = "Planning" | "In Progress" | "Review" | "Archived";

export interface ProjectLinked {
  files: number;
  tasks: number;
  messages: number;
  invoices: number;
  handovers: number;
}

/** A full client project/engagement. */
export interface ProjectFull {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  deadline: string;
  owner: string;
  team: string[];
  tags: string[];
  progress: number;
  linked: ProjectLinked;
}

export interface Tag {
  id: number;
  name: string;
}

export type HandoverStatus = "Draft" | "Sent" | "Accepted";

/** How a client gets into a handover's portal page. */
export type PortalAccessMode = "invite" | "password" | "public";

/** Branding for a handover's shareable client-facing landing page. */
export interface HandoverBranding {
  /** Accent color (hex, e.g. "#D85E25"). */
  accent: string;
  theme: "dark" | "light";
  /** Studio / sender name shown in the header. */
  studioName: string;
  /** Optional logo, as a data URL or an image URL. */
  logoUrl?: string;
  headline: string;
  subhead: string;
  /** Welcome message body shown to the client. */
  welcome: string;
}

/**
 * A handover package: a set of files plus a note, delivered to a client for a
 * project. Moves through Draft -> Sent -> Accepted and has a shareable link.
 */
export interface Handover {
  id: string;
  /** The project this handover belongs to (e.g. "p1"). */
  projectId: string;
  title: string;
  /** Receiving company/client (e.g. "Acme Corp"). */
  recipient: string;
  /** Contact person at the client (e.g. "Dana"); shown on the portal page. */
  clientName?: string;
  /** Client contact email — required for reminder emails; never shown on the portal page itself. */
  clientEmail?: string;
  note: string;
  status: HandoverStatus;
  /** Ids of the vault files included in the package. */
  fileIds: string[];
  created: string;
  /**
   * Optional branding for the shareable landing page; unset fields fall back
   * to studio defaults or handover content (see effectiveBranding()).
   */
  branding?: Partial<HandoverBranding>;
  /** Unguessable random token — the only client-facing identifier (/portal/:token). */
  token: string;
  accessMode: PortalAccessMode;
  /** scrypt hash, set only when accessMode is "password". Never serialized to the portal. */
  passwordHash?: string | null;
  /** ISO timestamp after which the portal link stops working; null = no expiry. */
  expiresAt?: string | null;
  revoked: boolean;
  revokedAt?: string | null;
  /** ISO timestamp of the last reminder email sent to clientEmail, manually or automatically. */
  lastReminderAt?: string | null;
}

/**
 * A note in a handover's shared discussion thread — the "meeting ground" between
 * the designer and the client. When `fileId` is set it's an annotation on that
 * specific file; otherwise it's a general note.
 */
export interface HandoverComment {
  id: string;
  handoverId: string;
  author: string;
  role: "client" | "designer";
  body: string;
  fileId?: string | null;
  /**
   * A visual pin's position, as a percentage (0-100) of the previewed file's
   * rendered width/height. Only meaningful when `fileId` is set; unset means
   * this is a general note on the file (or on the handover as a whole), not
   * a point annotation.
   */
  x?: number | null;
  y?: number | null;
  /**
   * A video pin's position, in seconds into playback. Mutually exclusive with
   * x/y — a pin on a file is either a spot on an image or a moment in a video,
   * never both. Only meaningful when `fileId` is set to a video file.
   */
  timecode?: number | null;
  /**
   * The file's version label at the moment this pin was left — lets a pin
   * from an earlier round stay anchored to the version it was actually about,
   * instead of silently relabeling itself onto whatever's now current. Unset
   * on comments that predate this field, or that aren't tied to a specific
   * file (general notes).
   */
  version?: string | null;
  /** ISO 8601 timestamp (used for ordering). */
  created: string;
  /** Studio-only note: never rendered on, or serialized to, the client portal. */
  internalOnly?: boolean;
}

/** One file's approval state within a single handover — keyed by fileId. */
export type ReviewStatus = "approved" | "changes_requested";

export interface HandoverFileApproval {
  status: ReviewStatus;
  approvedBy: string | null;
  approvedAt: string;
  /** The file's version label at the moment this status was set — see isFileApproved for how staleness is detected. */
  version: string | null;
}

export type HandoverApprovals = Record<string, HandoverFileApproval>;

/** A file whose client feedback arrived after it was already approved, on the same version — not just a new revision round. */
export interface ScopeCreepFlag {
  handoverId: string;
  handoverTitle: string;
  projectId: string;
  fileId: string;
  fileName: string;
  approvedAt: string;
  approvedBy: string | null;
  laterComments: { id: string; author: string; body: string; created: string }[];
}

/**
 * Portal-facing DTOs — the explicit allowlist of what a client may see.
 * Anything not listed here (password hashes, internal comments, other
 * projects/handovers, owner identities) is structurally excluded.
 */
export interface PortalFileDTO {
  id: string;
  name: string;
  type: "file" | "folder";
  extension?: string;
  size?: string;
  status: FileStatus;
  tags: string[];
  /** Full version history, oldest first — powers the portal's version picker so a client can review or compare a past round, not just the latest. */
  versions: FileVersion[];
}

export interface PortalCommentDTO {
  id: string;
  author: string;
  role: "client" | "designer";
  body: string;
  fileId: string | null;
  x: number | null;
  y: number | null;
  timecode: number | null;
  version: string | null;
  created: string;
}

export interface PortalHandoverDTO {
  title: string;
  recipient: string;
  clientName?: string;
  note: string;
  status: HandoverStatus;
  created: string;
  branding?: Partial<HandoverBranding>;
  files: PortalFileDTO[];
}

/** One portal visitor action, joined with its handover, for the activity feed. */
export interface PortalActivityItem {
  id: number;
  event: string;
  detail: string | null;
  created: string;
  handoverId: string;
  handoverTitle: string;
  projectId: string;
  /** Author name when the event is a comment. */
  commentAuthor?: string | null;
}

export interface DeadlineItem {
  id: string;
  name: string;
  client: string;
  deadline: string;
  /** Whole days until the deadline; negative = overdue. */
  daysLeft: number;
}

/** A handover with at least one file still awaiting the client's approval. */
export interface PendingApproval {
  handoverId: string;
  handoverTitle: string;
  projectId: string;
  recipient: string;
  clientName?: string;
  totalFiles: number;
  approvedFiles: number;
  created: string;
}

/** A handover whose every file the client has approved, most-recently-completed first. */
export interface CompletedApproval {
  handoverId: string;
  handoverTitle: string;
  projectId: string;
  recipient: string;
  clientName?: string;
  /** Latest of the per-file approvedAt timestamps — when the package became fully approved. */
  completedAt: string;
}

/**
 * The one real, fact-driven line in the home-screen greeting. `lead` and
 * `trail` are the sentence fragments before/after the clickable `entityLabel`
 * (either can be empty); `projectId` is where clicking the entity should
 * navigate, and `openHandovers` additionally opens that project's Handovers
 * list when the fact concerns a handover rather than the project itself.
 */
export interface GreetingFact {
  kind: "approval" | "portal_activity" | "deadline" | "activity" | "neutral";
  lead: string;
  entityLabel: string | null;
  trail: string;
  projectId: string | null;
  openHandovers?: boolean;
}

/** One actionable line in the home-screen insight rail. */
export interface DashboardInsight {
  category: "connection_error" | "portal_unopened" | "review_stuck" | "link_expiring" | "scope_creep";
  lead: string;
  entityLabel: string;
  trail: string;
  action:
    | { kind: "open"; projectId: string; fileId?: string }
    | { kind: "copy_link"; href: string }
    | { kind: "extend_expiry"; handoverId: string; newExpiresAt: string }
    | { kind: "reconnect"; provider: "google" | "dropbox" };
}

/** Payload of GET /api/dashboard — everything the home screen shows live. */
export interface DashboardData {
  projectCount: number;
  deadlines: DeadlineItem[];
  latestFile: { name: string; created: string; status: FileStatus } | null;
  latestHandover: { title: string; status: HandoverStatus; recipient: string; clientName?: string } | null;
  activity: PortalActivityItem[];
  greetingFact: GreetingFact;
  insights: DashboardInsight[];
  /** Handovers with unapproved files, most-recent-first, capped for payload size. */
  pendingApprovals: PendingApproval[];
  /** Handovers fully approved recently, most-recent-first, capped for payload size — feeds the home-screen celebration banner. */
  completedApprovals: CompletedApproval[];
  statusTally: StatusTally;
}

/** Per-file review status counts across every non-revoked handover in the workspace, for the at-a-glance dashboard tally. */
export interface StatusTally {
  approved: number;
  awaitingClient: number;
  changesRequested: number;
  internalDraft: number;
}

export type OAuthProviderId = "google" | "dropbox" | "onedrive";

/** Payload of GET /api/oauth/:provider/status — never includes tokens. */
export interface OAuthStatus {
  connected: boolean;
  accountLabel?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  scope?: string | null;
}

export interface OAuthBrowseItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: string | null;
  modifiedAt: string | null;
}

export interface OAuthBrowseResult {
  items: OAuthBrowseItem[];
  nextPageToken: string | null;
}

/** Result of the AI file-analysis endpoint (/api/analyze). */
export interface AnalyzeResult {
  summary: string;
  tags: string[];
}

export type ChatRole = "user" | "ai";
export interface ChatMessage {
  role: ChatRole;
  text: string;
}

/** A single to-do item scoped to a project (the "Tasks" tile). */
export interface VaultTask {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  /** ISO yyyy-mm-dd, or unset. */
  dueDate?: string | null;
  assignee?: string | null;
  created: string;
}

/** A scheduled event, optionally tied to a project. Shown on the Calendar. */
export interface CalendarEvent {
  id: string;
  projectId?: string | null;
  title: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  /** "HH:MM" 24h, or unset for an all-day event. */
  startTime?: string | null;
  endTime?: string | null;
  created: string;
}

/** A studio team member — a simple directory, not a login/permissions system. */
export interface TeamMember {
  id: string;
  name: string;
  /** Display-only join key against a project's `team: string[]` (bare initials). */
  initials: string;
  role?: string | null;
  email?: string | null;
  /** Hex color for the avatar. */
  color: string;
}

/** One conversation in the Messaging inbox — independent of any single project. */
export interface Conversation {
  id: string;
  title: string;
  linkedProjectId?: string | null;
  linkedClient?: string | null;
  linkedMemberId?: string | null;
  created: string;
}

export type MessageRole = "me" | "them";

export interface ConversationMessage {
  id: string;
  conversationId: string;
  author: string;
  role: MessageRole;
  body: string;
  /** ISO 8601 timestamp (used for ordering). */
  created: string;
}

/**
 * Studio-wide preferences — a singleton row (there's only one studio). Fields
 * here are the ones with a real effect elsewhere: `defaultOwner` pre-fills new
 * projects, the `brand*`/`studioName`/`logoUrl` fields pre-fill a new
 * handover's branding at creation time.
 */
export interface StudioSettings {
  studioName: string;
  defaultOwner: string;
  logoUrl?: string;
  brandAccent: string;
  brandTheme: "dark" | "light";
}

/** The signed-in studio user, as returned by /api/auth/{signup,login,me}. */
export type WorkspaceRole = "owner" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

/**
 * A workspace's subscription tier. 'trial' is the automatic state every new
 * workspace starts in (no card required) — it isn't something a customer
 * "buys," so there's no Stripe product/price for it.
 */
export type PlanTier = "trial" | "freelance" | "studio" | "enterprise";

/** What a tier allows — `null` means uncapped. Never `Infinity`: it doesn't survive JSON (`JSON.stringify({n: Infinity})` silently becomes `{"n":null}`), so `null` is the one true "uncapped" value everywhere this crosses the API boundary. */
export interface PlanLimits {
  seatCap: number | null;
  storageCapBytes: number | null;
  activeHandoverCap: number | null;
  folderNesting: boolean;
  bulkActions: boolean;
  multiUpload: boolean;
  ai: boolean;
}

/** Payload of GET /api/billing/status — a workspace's current plan, entitlements, and live usage against them. */
export interface BillingStatus {
  tier: PlanTier;
  /** True when there's no active entitlement at all (trial expired, or subscription canceled) — BillingGate shows the blocked screen. */
  blocked: boolean;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  planInterval: "month" | "year" | null;
  seats: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  /** Whether this workspace has ever completed a checkout — gates whether Settings shows "Manage billing" vs. upgrade CTAs. */
  hasStripeCustomer: boolean;
  limits: PlanLimits;
  usage: {
    storageBytes: number;
    activeHandovers: number;
    members: number;
  };
}

/** A signed-in member of the current workspace, for the Settings "Team" list. */
export interface WorkspaceMember {
  id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  created: string;
}

/** A pending, not-yet-accepted invite to join the current workspace. */
export interface PendingInvite {
  token: string;
  email: string | null;
  role: WorkspaceRole;
  created: string;
}

/** Public info shown on the /join/:token page before the invite is accepted. */
export interface InvitePreview {
  workspaceName: string;
  email: string | null;
  valid: boolean;
}
