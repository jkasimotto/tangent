/** A thread's frontmatter status; only `open` threads are ever surfaced in threads.md. */
export type ThreadStatus = "open" | "done" | "dropped";

/** One `thread-<slug>.md` file, parsed frontmatter plus documented body-prose signals. */
export type ParsedThread = {
  slug: string;
  /** Vault-relative directory the thread file lives in (its node), e.g. "neara/pgande". Empty string at the vault root. */
  node: string;
  /** Vault-relative path to the thread file. */
  path: string;
  outcome?: string;
  status: ThreadStatus;
  opened?: string;
  closed?: string;
  /** Parsed from a body line "Owner: X". */
  owner?: string;
  /** Parsed from body prose "Check in every N days". */
  cadenceDays?: number;
  /** Earliest date found in the body: prefers 📅 YYYY-MM-DD markers, falls back to bare YYYY-MM-DD dates. */
  deadline?: string;
  /** Full text (including its "Parked"/"Wake when"/"Wake on" prefix) of a body line starting with one of those, case-insensitive, if present. Opaque prose for a human unless parseWakeCondition recognizes a machine-checkable shape. */
  wakeCondition?: string;
  /** Parsed from a body line "Batch: <name>". Groups fanned-out dispatch threads together in the WORKING section. */
  batch?: string;
  /** Truncated body text, used as haiku prompt context. */
  bodyExcerpt: string;
};

/** One unchecked "## On me" commitment from a node's overview.md. */
export type OverviewItem = {
  /** Vault-relative directory of the owning overview.md. */
  node: string;
  text: string;
  /** 📅 YYYY-MM-DD deadline embedded in the item text, if present. */
  deadline?: string;
  /** True when the item links to a thread file or names an existing thread's slug in the same node. */
  owned: boolean;
  /** The thread slug this item is owned by, when resolvable. */
  ownedSlug?: string;
};

/** The result of one deterministic pass over the vault: parsed facts only, no derived state. */
export type VaultScan = {
  threads: ParsedThread[];
  overviewItems: OverviewItem[];
  /** Per-node latest dated-note date (YYYY-MM-DD), read from note filename prefixes, for check-in cadence. */
  noteRecencyByNode: Map<string, string>;
};

/** The small, closed set of states a delegated thread can be in. Derived deterministically; see derive.ts. */
export type ThreadState = "working" | "blocked-on-you" | "ready-for-you" | "needs-you" | "parked" | "done";

/** One thread after state derivation: enough to render a threads.md line and to seed the haiku prompt. */
export type DerivedThread = {
  slug: string;
  node: string;
  owner: string;
  outcome?: string;
  openedAt?: string;
  state: ThreadState;
  /** Deterministic, templated one-line why, built from owner/deadline/cadence/session facts. Used verbatim when the haiku pass is unavailable or fails, and as haiku prompt context otherwise. */
  templateWhy: string;
  /** Carried from ParsedThread.batch. Groups fanned-out dispatch threads together in the WORKING section. */
  batch?: string;
};

/** The kind of the most recent step recorded for a session, used to detect a pending question or permission prompt (the design's "idle at a question or unresolved permission step" signal). */
export type SessionStepKind = "permission" | "assistant_response" | "other";

/** The narrow view of live coding-agent session telemetry the derivation logic needs. */
export type SessionState = {
  status: "active" | "ended" | "unknown";
  /** Wall-clock time since the session's last recorded activity. */
  idleMs: number;
  lastStepKind?: SessionStepKind;
};

/**
 * Resolves live coding-agent session telemetry for registered threads. Narrow and injectable so the
 * pure state-derivation logic, and its tests, never touch the Usage SQLite index directly.
 */
export interface SessionStateReader {
  /** Reads the current state of a known session id, or undefined if the session cannot be found. */
  read(sessionId: string, now: Date): Promise<SessionState | undefined>;
  /**
   * Resolves the most recently active session whose working directory matches a registered
   * worktree, for registry entries dispatched before their session id was observable. Returns
   * undefined when no session matches.
   *
   * `notBefore`, an ISO timestamp, guards against misattribution: a recur thread's cwd is often a
   * long-lived, reused repo directory (unlike a fresh eval worktree), so matching on cwd alone can
   * latch onto a human's own interactive session in that same directory, past or future. Only
   * sessions whose start (or last activity, when start is unknown) falls at or after `notBefore`
   * minus a small slack are eligible; the sweep passes the registry entry's `registeredAt` so only
   * sessions from this dispatch onward can match.
   */
  resolveSessionIdByCwd(worktree: string, now: Date, notBefore?: string): Promise<string | undefined>;
}

/** One dispatched thread's worktree/tmux/session linkage, as recorded by `tangent threads register`. */
export type RegistryEntry = {
  node: string;
  worktree: string;
  tmux: string;
  /** Optional: dispatch cannot always observe a Claude session id at register time. The sweep resolves and backfills it by matching the worktree's cwd against recent Usage sessions. */
  sessionId?: string;
  registeredAt: string;
};

export type SidecarCounts = {
  needsYou: number;
  blocked: number;
  working: number;
  ready: number;
  parked: number;
  unowned: number;
};

export type NeedsYouEntry = { slug: string; why: string };

/** The full on-disk shape of ~/.tangent/threads-status.json: statusline counts, registry, and notification dedup state. */
export type SidecarState = {
  sweptAt?: string;
  counts: SidecarCounts;
  needsYou: NeedsYouEntry[];
  registry: Record<string, RegistryEntry>;
  /** Last-notified state per slug, for dedup: a thread notifies again only after leaving and re-entering a notifiable state. */
  notified: Record<string, ThreadState>;
  /** Last-fired-instant per recur definition slug, keyed by RecurDef.slug. isDue compares this against each schedule's most recent scheduled instant to decide whether a dispatch has already fired. Optional so older on-disk sidecars without recurring dispatch still parse; readSidecar defaults it to {}. */
  recur?: Record<string, { lastRunAt: string }>;
};

/** Input given to the haiku pass: already-derived states plus enough prose context to describe them. */
export type WhyLineRunnerInput = {
  derived: DerivedThread[];
  threadsBySlug: Map<string, ParsedThread>;
  overviewExcerptsByNode: Map<string, string>;
};

export type WhyLineRunnerResult = {
  whyLines: Record<string, string>;
  drafts: Record<string, string>;
};

/**
 * Describes already-derived thread states in prose (why-lines) and drafts due check-in messages.
 * Never decides state: the sweep discards anything in the result keyed by an unknown slug, and the
 * result shape carries no state field at all, so a runner has no way to influence derivation.
 */
export interface WhyLineRunner {
  run(input: WhyLineRunnerInput): Promise<WhyLineRunnerResult>;
}

/** Fires one push notification. Injectable so tests never spawn a real notifier process. */
export interface Notifier {
  notify(input: { title: string; message: string }): Promise<void>;
}

/** Starts the actual work for one due recurring dispatch (a coding-agent session running a recur definition's prompt). Injectable so runRecur's tests never start a real tmux session or coding-agent process. */
export interface WorkerLauncher {
  launch(args: { slug: string; cwd: string; model: string; prompt: string }): Promise<void>;
}

/**
 * Outcome of splicing a shared node's generated section into its state-of-play.md. "written" and
 * "unchanged" mean the file's marker state was unambiguous (or absent) and handled normally.
 * "malformed" means `updateSharedStateOfPlay` found the begin/end markers in a state it refuses to
 * touch (an orphaned single marker, more than one of either marker, or an end marker before its
 * begin) and left the file exactly as it was; `beginCount`/`endCount` are the raw marker counts it
 * found, for a caller to log a precise diagnostic rather than guessing which pair is real.
 */
export type StateOfPlaySpliceResult = "written" | "unchanged" | { status: "malformed"; beginCount: number; endCount: number };

/**
 * Writes a shared node's generated state-of-play section and, when appropriate, commits it locally.
 * Injectable so the sweep's tests can assert which nodes it calls (and with what section) without
 * touching real git or the filesystem; the default implementation splices via
 * `updateSharedStateOfPlay` and commits just `state-of-play.md` with `commitPath` (never a whole-tree
 * `git add -A`) only when something changed and the shared directory is its own git repo.
 */
export interface SharedStateWriter {
  /** Splices `section` into `<nodeDir>/shared/state-of-play.md`, returning what happened. */
  write(nodeDir: string, section: string): Promise<StateOfPlaySpliceResult>;
}
