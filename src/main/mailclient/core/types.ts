// Core data types + the transport-agnostic Api contract.
// Task 5: moved here from shared/api.ts so the core is self-contained (the Electron
// integration copies app/core/ verbatim). shared/api.ts re-exports these names and adds
// the browser HttpTransport — the UI keeps importing from shared/api with no changes.
export type FolderNode = {
  id: string;              // DB folder id (opaque, stable)
  path: string;            // IMAP path (display)
  name: string;            // last segment
  delimiter: string;
  specialUse: string | null;
  unreadCount: number;
  totalCount: number;
  children: FolderNode[];
};

export type MessageListItem = {
  id: number;              // DB row id
  /** the mail's Message-ID as the server sent it (with angle brackets); null if it has none */
  messageId: string | null;
  folderId: string;
  uid: number;
  subject: string;
  fromName: string;
  fromEmail: string;
  date: string | null;     // ISO
  internalDate: string | null;
  hasAttachments: boolean;
  attachmentNames: string[];
  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  snippet: string;
  threadId: string | null; // conversation grouping
  threadCount: number;
};

export type MessageDetail = MessageListItem & {
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  sizeBytes: number;
  // rendering-safe body
  bodyKind: 'html' | 'text';
  html: string | null;     // sanitized + links rewritten + remote srcs neutralized
  text: string | null;
  attachments: AttachmentInfo[];
  emlPath: string;         // server-local path (opaque to UI)
  // security manifest (see sanitize.ts)
  links: SafeLink[];               // extracted links (parent UI shows + opens them)
  remoteImages: RemoteImageRef[];  // blocked remote images (opt-in load)
  remoteImageCount: number;
};

export type SafeLink = {
  index: number;       // matches data-link-idx in the sanitized HTML
  text: string;        // link text as in the email
  url: string;         // ORIGINAL URL (unfiltered) — shown to the user
  scheme: string;      // http, https, mailto, ... (after scheme check)
  openable: boolean;   // false for filtered schemes (javascript:, file:, data:, ...)
};

export type RemoteImageRef = {
  url: string;         // original remote URL
  placeholder: string; // data: URI currently in the HTML (identifies the img)
};

export type AttachmentInfo = {
  partId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId: string | null;
};

export type SearchFilters = {
  query: string;                    // raw user query (server escapes for FTS5)
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  after?: string;                   // ISO date
  before?: string;
  folderId?: string;
  limit?: number;
  offset?: number;                  // pagination (client "load more" appends pages)
  sortBy?: 'date' | 'relevance';    // Task 3: relevance only honored when query is set
  wantFacets?: boolean;             // Task 3: per-folder hit counts in the result
  wantSnippets?: boolean;           // Task 3: highlighted snippets for the page
};

export type SearchResult = {
  items: MessageListItem[];
  total: number;
  elapsedMs: number;
  snippetMap: Record<number, string>; // highlighted snippet per message id
  facets?: { folderId: string; count: number }[];   // Task 3: per-folder hit counts
};

export type MailAccountMode = 'sandbox' | 'production-readonly' | 'canary';

export type AccountInfo = {
  id: string;
  email: string;
  /** A7 part 2: 'canary' is the one real mailbox that may be written to */
  mode: MailAccountMode;                     // drives what the UI enables
  canWrite: boolean;                         // true only for a sandbox account or the canary
};

export type SyncStatus = {
  running: boolean;
  lastSyncAt: string | null;
  idleConnected: boolean;
  foldersSynced: number;
  foldersTotal: number;
  newMessages: number;
  flagChanges: number;
  expunged: number;
  errors: string[];
  // --- Task 3 additions (optional fields, additive only) ---
  currentFolder?: string | null;    // folder being synced right now
  messagesDone?: number;            // messages stored so far (initial download)
  messagesTotal?: number | null;    // server-reported total, when known
  bytesDone?: number;               // downloaded bytes so far
  phase?: 'idle' | 'initial' | 'incremental' | 'paused' | 'error' | 'disk-full';
  paused?: boolean;                 // initial download can be paused/resumed
  accountId?: string;               // which account this status describes
  serverRssMB?: number;             // process-wide server RSS in MB (soak monitoring; not per-account)
  connection?: ConnectionState;     // 'auth-failed' is final until the host restarts the core
  retryAt?: string | null;          // when offline: ISO time of the next attempt
  connectionError?: string | null;  // the last connect failure, as the server or socket said it
  /** Set when a write failed because the disk is full; cleared by resumeSync(). Not a connection state. */
  diskFull?: string | null;
  /** A3: file/row consistency of this account (counts only; see MailCore.checkFileConsistency) */
  fileConsistency?: { rowsWithoutFile: number; filesWithoutRow: number; tmpFiles: number };
};

/** How an IMAP connection is encrypted: TLS from the first byte, upgraded with STARTTLS, or
 * not at all (sandbox only). Set explicitly, never guessed from the port. */
export type ImapSecurity = 'tls' | 'starttls' | 'none';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'auth-failed';

// --- Task 3 additions: account list + per-thread listing -------------------
export type AccountSummary = {
  id: string;
  email: string;
  mode: MailAccountMode;
  canWrite: boolean;
  active: boolean;                  // whether this account is the one the UI session targets
};

export type ThreadSummary = {
  threadId: string;
  count: number;                    // messages in thread (locally known)
  subject: string;                  // subject of the newest message
  fromName: string;                 // sender of the newest message
  date: string | null;              // newest message date
  unread: number;
  hasAttachments: boolean;
  snippet: string;
  messageIds: number[];             // newest-first row ids (open newest directly)
};

// The single API surface. Every method the UI needs must be declared here.
// Task 3 rule: NO breaking changes. Existing methods keep their signature
// (accountId params are trailing optional where needed); new methods are additive.
export interface Api {
  // account / system
  getAccount(): Promise<AccountInfo>;
  getSyncStatus(): Promise<SyncStatus>;
  triggerSync(full?: boolean): Promise<void>;

  // --- Task 3 additions (optional for implementors, additive) ---
  listAccounts?(): Promise<AccountSummary[]>;
  selectAccount?(accountId: string): Promise<AccountInfo>;
  pauseSync?(accountId?: string): Promise<void>;
  resumeSync?(accountId?: string): Promise<void>;
  listThreads?(folderId: string | null, opts: { offset: number; limit: number }): Promise<ThreadSummary[]>;

  // folders
  getFolders(): Promise<FolderNode[]>;

  // messages
  listMessages(folderId: string, opts: { offset: number; limit: number }): Promise<MessageListItem[]>;
  getMessage(id: number): Promise<MessageDetail>;
  getRawEml(id: number): Promise<Uint8Array>;
  getAttachment(id: number, partId: string): Promise<Uint8Array>;
  loadRemoteImages(id: number, remoteImages: RemoteImageRef[]): Promise<MessageDetail>;   // opt-in per message

  // search
  search(filters: SearchFilters): Promise<SearchResult>;

  // write operations — MUST only work against sandbox (server enforces; UI disables)
  markRead(ids: number[], read: boolean): Promise<void>;
  markFlagged(ids: number[], flagged: boolean): Promise<void>;
  // the moves resolve to their journaled ops (one per moved message), for undo and errors
  moveToFolder(ids: number[], targetFolderId: string): Promise<OpSummary[]>;
  deleteToTrash(ids: number[]): Promise<OpSummary[]>;
  archive(ids: number[]): Promise<OpSummary[]>;

  // compose (sandbox only)
  getContacts(partial: string): Promise<{ name: string; email: string }[]>;
  /** Stores the draft in Drafts and returns its UID there; `replaceUid` (the UID an earlier
   *  save returned, or SavedDraft.uid) is removed once the new version is stored */
  saveDraft(draft: DraftInput, replaceUid?: number | null): Promise<number>;
  /** `draftUid`: the saved draft this mail was written in, removed once it is sent */
  sendMail(mail: DraftInput, draftUid?: number | null): Promise<{ messageId: string }>;
  deleteDraft(id: number): Promise<void>;
  /** Moves the saved draft with this UID (from saveDraft) to Trash */
  discardDraft(uid: number): Promise<void>;
  getDraft(id: number): Promise<SavedDraft>;

  // --- Task 4 additions (optional for implementors, additive) ---
  // write-path observability + recovery: the op journal surfaced to the UI
  listOps?(accountId?: string): Promise<OpSummary[]>;
  getOpCounts?(accountId?: string): Promise<Record<string, number>>;
  retryOp?(opId: string, accountId?: string): Promise<OpResult>;
  resolveOp?(opId: string, accountId?: string): Promise<OpResult>;   // probe an unknown send (never resend)
  cancelOp?(opId: string, accountId?: string): Promise<void>;        // cancel a pending op (undo before server saw it)
  undoOp?(opId: string, accountId?: string): Promise<string>;        // inverse op for a done flag/move/delete
  expungeFromTrash?(ids: number[], accountId?: string): Promise<void>; // permanent deletion, Trash only
  replayPendingOps?(accountId?: string): Promise<{ replayed: number; results: Record<string, string> }>;

  // --- C2: mail -> record linking ---
  /** Addresses and ids only, never subjects or bodies (C2). Ordered by row id. */
  listHeadersSince?(cursor: number, limit: number, accountId?: string): Promise<MessageHeader[]>;
  // --- B1: folder create / rename / delete (writable accounts only) ---
  createFolder?(parentPath: string | null, name: string, accountId?: string): Promise<OpSummary>;
  renameFolder?(path: string, newName: string, accountId?: string): Promise<OpSummary>;
  deleteFolder?(path: string, accountId?: string): Promise<OpSummary>;
  /** B2: move a folder under a new parent (same rules as a rename) */
  moveFolder?(path: string, newParentPath: string | null, accountId?: string): Promise<OpSummary>;
  /** List items for the history panel of a record (C3), by Message-ID */
  findByMessageIds?(ids: string[], accountId?: string): Promise<MessageListItem[]>;
  /** C4: the mails answering one of these Message-IDs (In-Reply-To/References), newest first */
  findReplies?(parentIds: string[], accountId?: string): Promise<MessageListItem[]>;
}

/** C2: one mail's linking header. Addresses and ids only - no subject, no body. */
export type MessageHeader = {
  id: number;
  messageId: string | null;
  /** sha1(date|from_email|size_bytes|subject); the subject only ever enters this hash */
  fallbackKey: string;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  date: string | null;
};

/** Task 4: journaled write operation, UI-safe summary (no mail content). */export type OpSummary = {
  id: string;
  kind: 'flag' | 'move' | 'move_batch' | 'delete' | 'expunge' | 'send' | 'draft_save' | 'draft_delete' | 'folder_create' | 'folder_rename' | 'folder_delete';
  state: 'pending' | 'running' | 'done' | 'failed' | 'conflict' | 'cancelled' | 'unknown';
  folderPath: string | null;
  targetFolderPath: string | null;
  uid: number | null;
  messageId: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

/** Task 4: result of one op execution (mirrors server OpResult). */
export type OpResult = {
  outcome: 'done' | 'conflict' | 'failed' | 'noop' | 'unknown';
  detail?: string;
  reason?: string;
};

export type DraftInput = {
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  bcc: { name: string; email: string }[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: { filename: string; contentType: string; base64: string }[];
  signature?: string;
  /** Message (DB id) this one answers: it gets \Answered once the reply is sent */
  repliesTo?: number | null;
  /** Message (DB id) whose attachments go along (forward) */
  forwardsFrom?: number | null;
};

/** A draft opened again: its own content, attachments included, and where it is stored */
export type SavedDraft = DraftInput & { id: number; uid: number };

// Transport interface (used by the UI to obtain an Api instance).
// `Api[K]` includes optional methods (Task 3 additions), hence the `-?` and
// non-undefined constraint: the transport must accept calls to methods that
// may be absent on a given backend (the server answers 404 in that case).
export interface Transport {
  call<K extends keyof Api>(method: K, ...args: Parameters<NonNullable<Api[K]>>): Promise<Awaited<ReturnType<NonNullable<Api[K]>>>>;
}
