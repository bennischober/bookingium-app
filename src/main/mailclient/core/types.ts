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
  /** #158: the local sync setting ('always' for INBOX and the special-use folders) */
  syncMode: FolderSyncMode;
  /** #158: subscribed on the server at the last folder list; null while not known */
  subscribed: boolean | null;
  /** #158: an 'on_open' folder whose mail was never downloaded (its counts are the server's) */
  notDownloaded: boolean;
  children: FolderNode[];
};

/**
 * #158: how a folder is synced. 'always': by every pass, as before. 'on_open': only when the
 * user opens it; the deep check, the flag sweep and the first download skip it, and the
 * STATUS round only keeps its counts. A local setting: the server's subscriptions are never changed.
 */
export type FolderSyncMode = 'always' | 'on_open';

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
  /** #163: \Answered is set (a reply went out) */
  isAnswered: boolean;
  /** #163: $Forwarded is set (the mail was forwarded) */
  isForwarded: boolean;
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
  complete: boolean;       // S1: false while large parts are not downloaded (attachment sizes are estimates)
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
  /** #158: folders set to 'on_open' whose mail was never downloaded, so not searched */
  notDownloadedFolders?: number;
};

/** 'read-only': set to "Nur lesen" (or refused by the write guard); 'sandbox': the local test server; 'live': a real, writable mailbox */
export type MailAccountMode = 'read-only' | 'sandbox' | 'live';

export type AccountInfo = {
  id: string;
  email: string;
  mode: MailAccountMode;                     // drives what the UI enables
  canWrite: boolean;                         // writable and its server answers
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
  /** #63: the mailbox's size on the server (STATUS SIZE, else QUOTA), when the server says */
  bytesTotal?: number | null;
  /** #63: seconds the first download still needs at its current rate; null until it can tell */
  secondsLeft?: number | null;
  /** #63: the first download waits paused because the drive looks too small; cleared by resumeSync() */
  spaceWarning?: string | null;
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
  /** #156: the sync button's change pass: 'priority' while the open folder, INBOX, Sent, Drafts and
   *  Trash sync, 'check' while every other folder's STATUS is compared; foldersSynced/foldersTotal
   *  count the folders of that half. null or absent otherwise. */
  changePass?: 'priority' | 'check' | null;
  /** #156: the last pass the user started (sync button or deep check), counts only */
  lastPass?: PassSummary | null;
  /** #159: the last passes, user-started or not, newest first (at most 10); counts only */
  passHistory?: PassSummary[];
  /** #159: the sync errors still standing, last seen first; see SyncErrorEntry */
  syncErrors?: SyncErrorEntry[];
};

/**
 * #159: a sync error that outlives its pass. A folder's error stays until that folder syncs
 * without one; an error of the whole pass (path null) until a pass ends without such an error;
 * either until the user hides it (MailCore.dismissSyncErrors). The message is what the server or
 * the socket said, never mail content.
 */
export type SyncErrorEntry = {
  /** stable while the error stands; what dismissSyncErrors takes */
  key: string;
  /** the folder's IMAP path; null for an error of the whole pass, the poll or the connection */
  path: string | null;
  message: string;
  /** ISO times it was first and last seen, and how often */
  firstAt: string;
  lastAt: string;
  count: number;
};

/**
 * #156: what one user-started pass did, to judge the STATUS census pacing against a real server.
 * Counts and times only: no folder names, subjects or addresses.
 */
export type PassSummary = {
  /** 'changes': the sync button's change pass; 'all': every folder (a first download); 'full': the deep check */
  kind: 'changes' | 'all' | 'full';
  /** the census was one LIST-STATUS command (false: one paced STATUS per folder) */
  listStatus: boolean;
  /** the pause after each STATUS of the census at the end of the pass (#157: floor + learned), in ms */
  censusPauseMs: number;
  /**
   * #157: the pacer's learned pause on top of the fixed floors: at the end of the pass, its
   * highest during the pass, and the throttling signals that raised it (pacer.ts)
   */
  pacing?: { pauseMs: number; maxPauseMs: number; signals: number };
  /** how long the census took, in ms (folder syncs in between not counted) */
  censusMs: number;
  /** folders the census asked for STATUS */
  foldersChecked: number;
  /** folders opened and synced */
  foldersSynced: number;
  /** the whole pass, in ms */
  totalMs: number;
  /** error events during the pass */
  errors: number;
  /** how the pass ended ('idle' = done) and the connection after it */
  phase: string;
  connection: string;
  /** ISO time the pass ended */
  at: string;
  /** #159: who started it: the user (sync button, deep check) or the app (start, retry of a first pass) */
  trigger?: 'user' | 'auto';
  /** #159: what the pass changed in the store */
  newMessages?: number;
  flagChanges?: number;
  expunged?: number;
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
  answered: boolean;                // #163: some message of the thread has \Answered
  forwarded: boolean;               // #163: some message of the thread has $Forwarded
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
  /** #156: `full` is the deep check of every folder; without it only the open folder, INBOX,
   *  Sent, Drafts, Trash and the folders whose STATUS changed are synced (MailCore.triggerSync) */
  triggerSync(full?: boolean): Promise<void>;
  /** #156: the folder the user just opened, synced right away unless a sync of it is running
   *  anyway; a running pass takes it next ('queued'). MailCore.syncOpenedFolder */
  syncOpenedFolder?(folderId: string, accountId?: string): Promise<'synced' | 'queued' | 'skipped' | 'failed'>;
  /** #159: hides sync errors by their key (SyncErrorEntry.key); all of them without keys */
  dismissSyncErrors?(keys?: string[] | null, accountId?: string): Promise<void>;

  // --- Task 3 additions (optional for implementors, additive) ---
  listAccounts?(): Promise<AccountSummary[]>;
  selectAccount?(accountId: string): Promise<AccountInfo>;
  pauseSync?(accountId?: string): Promise<void>;
  resumeSync?(accountId?: string): Promise<void>;
  listThreads?(folderId: string | null, opts: { offset: number; limit: number }): Promise<ThreadSummary[]>;
  /** The unread mails in each account's INBOX, by account id (the menu badge) */
  getInboxUnread?(): Promise<Record<string, number>>;

  // folders
  getFolders(): Promise<FolderNode[]>;

  // messages
  listMessages(folderId: string, opts: { offset: number; limit: number }): Promise<MessageListItem[]>;
  getMessage(id: number): Promise<MessageDetail>;
  completeMessage(id: number): Promise<MessageDetail>;   // S1: a skeleton row's whole message, once
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
  listOpenOps?(accountId?: string): Promise<OpSummary[]>;            // I3: every op not done or cancelled
  cancelOp?(opId: string, accountId?: string): Promise<void>;        // cancel a pending op, or give up a conflict/failed/unknown one (I3)
  undoOp?(opId: string, accountId?: string): Promise<string>;        // inverse op for a done flag/move/delete
  expungeFromTrash?(ids: number[], accountId?: string): Promise<void>; // permanent deletion, Trash only
  replayPendingOps?(accountId?: string): Promise<{ replayed: number; results: Record<string, string> }>;

  // --- C2: mail -> record linking ---
  /** Addresses and ids only, never subjects or bodies (C2). Ordered by row id; names the store (MR-28). */
  listHeadersSince?(cursor: number, limit: number, accountId?: string): Promise<HeaderPage>;
  /** #124: the INBOX mails after `cursor` that match one of the rules; ids and flags only, never subjects */
  matchInboxSince?(cursor: number, limit: number, rules: RuleMatcher[], accountId?: string): Promise<RuleMatchPage>;
  // --- B1: folder create / rename / delete (writable accounts only) ---
  createFolder?(parentPath: string | null, name: string, accountId?: string): Promise<OpSummary>;
  renameFolder?(path: string, newName: string, accountId?: string): Promise<OpSummary>;
  deleteFolder?(path: string, accountId?: string): Promise<OpSummary>;
  /** B2: move a folder under a new parent (same rules as a rename) */
  moveFolder?(path: string, newParentPath: string | null, accountId?: string): Promise<OpSummary>;
  /**
   * #158: the local sync setting of these folders (ids from getFolders). INBOX and the
   * special-use folders stay 'always'. Never subscribes or unsubscribes on the server.
   * Returns how many folders changed; folders switched to 'always' are synced next.
   */
  setFolderSyncMode?(folderIds: string[], mode: FolderSyncMode, accountId?: string): Promise<number>;
  /** #158: „Abonnierte Ordner übernehmen“: subscribed folders 'always', the others 'on_open' */
  adoptSubscriptions?(accountId?: string): Promise<number>;
  /** List items for the history panel of a record (C3), by Message-ID */
  findByMessageIds?(ids: string[], accountId?: string): Promise<MessageListItem[]>;
  /** C4: the mails answering one of these Message-IDs (In-Reply-To/References), newest first */
  findReplies?(parentIds: string[], accountId?: string): Promise<MessageListItem[]>;
}

/** C2: one mail's linking header. Addresses and ids only - no subject, no body. */
/** MR-28: one page of headers and the generation of the store it came from. A row id is a
 * position in one store only; a rebuilt or replaced store has a new generation. */
export type HeaderPage = { generation: string; headers: MessageHeader[] };

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

/** #124: one mail rule's conditions as main hands them in. Each list holds alternatives (one is
 * enough); every non-empty list must match. Compared case-insensitively as "contains". */
export type RuleMatcher = { id: number; from: string[]; to: string[]; subject: string[] };

/** #124: one INBOX mail that matched; the subject never leaves the worker */
export type RuleMatch = {
  id: number;
  messageId: string | null;
  /** sha1(date|from_email|size_bytes|subject), as on MessageHeader */
  fallbackKey: string;
  /** when the server received it (INTERNALDATE), else the Date header */
  receivedAt: string | null;
  date: string | null;
  seen: boolean;
  flagged: boolean;
  /** the matching rules, in the order they were given */
  ruleIds: number[];
};

/** #124: one scanned page. `lastId` is the highest row id read (any folder), the next cursor;
 * `scanned` is 0 once nothing is left. Names the store like HeaderPage (MR-28). */
export type RuleMatchPage = { generation: string; lastId: number; scanned: number; matches: RuleMatch[] };

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
  /** I3: how far a send got - 'smtp': the server may have it, 'sent': only filing is left */
  sendPhase?: string | null;
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
  /** Message (DB id) whose attachments go along (forward): it gets $Forwarded once the mail is sent */
  forwardsFrom?: number | null;
  /**
   * I2: a UUID the editor keeps for one mail. A send uses it as the Message-ID, so sending
   * the same mail again is recognised in Sent and never delivered twice. Drafts ignore it.
   */
  sendKey?: string | null;
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
