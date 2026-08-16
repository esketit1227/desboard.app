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
  recipient: string;
  note: string;
  status: HandoverStatus;
  /** Ids of the vault files included in the package. */
  fileIds: string[];
  created: string;
  /** Optional branding for the shareable landing page; defaults are used when absent. */
  branding?: HandoverBranding;
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
  /** ISO 8601 timestamp (used for ordering). */
  created: string;
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
