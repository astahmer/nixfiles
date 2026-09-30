// Pure logic for viewed marks: what a mark is keyed on, how a file's diff is
// fingerprinted, and how a thread's record of marks changes. No DOM, no
// network, no clock — everything here is a function of its arguments so the
// tests can pin the contract without a browser or a server.

/**
 * One thread's marks: repo-relative file path -> the fingerprint of the diff
 * that was reviewed. Storing the fingerprint rather than a bare `true` is what
 * makes a mark clear itself when the file changes again.
 */
export type ViewedRecord = Record<string, string>;

/** A file card as the content script reads it out of the DOM. */
export interface FileMarkTarget {
  /** Repo-relative path, or `old -> new` for a rename. bb's own card label. */
  path: string;
  /** Fingerprint of the diff currently shown for that path. */
  fingerprint: string;
}

/** Storage key for one thread's marks. */
export function recordKey(threadId: string): string {
  return `viewed:${threadId}`;
}

/**
 * The thread a diff belongs to, read from the app route. bb serves thread
 * pages at both `/threads/:id` and `/projects/:projectId/threads/:id`, so both
 * shapes have to resolve to the same id or marks would split across routes.
 */
export function threadIdFromPath(pathname: string): string | null {
  const match = /\/threads\/([^/?#]+)/.exec(pathname);
  const threadId = match?.[1];
  if (threadId === undefined || threadId === "") return null;
  return decodeURIComponent(threadId);
}

/**
 * bb labels a diff card's collapse control "Collapse <label>" or
 * "Expand <label>", and in the changes panel that label is the file path (or
 * `previous -> current` for a rename). A card with nothing to expand gets a
 * different label and no `aria-expanded`, and returns null here.
 */
export function pathFromToggleLabel(label: string | null): string | null {
  if (label === null) return null;
  const match = /^(?:Collapse|Expand) (.+)$/.exec(label);
  const path = match?.[1]?.trim();
  if (path === undefined || path === "") return null;
  return path;
}

/**
 * Fingerprint a file's diff from the insertion/deletion counts bb renders in
 * the card header. This is the only per-file signal available in the header
 * DOM; it is coarse, so an edit that adds and removes the same number of lines
 * keeps its mark. Everything larger — a rebase, new hunks, a reverted file —
 * moves the counts and clears the mark.
 *
 * The header drops a zero count on an added or deleted file and groups
 * thousands with commas, so both are normalized here to the `+a -b` shape
 * `fingerprintFromCounts` produces from bb's file list.
 */
export function fingerprintFromStats(statText: string): string {
  const counts = statText.match(/[+-]\d[\d,]*/g);
  if (counts === null || counts.length === 0) return "none";
  let additions = 0;
  let deletions = 0;
  for (const count of counts) {
    const value = Number(count.slice(1).replaceAll(",", ""));
    if (count.startsWith("+")) additions = value;
    else deletions = value;
  }
  return fingerprintFromCounts({ additions, deletions });
}

/** Fingerprint a file's diff from the counts in bb's file list. */
export function fingerprintFromCounts(counts: {
  additions: number;
  deletions: number;
}): string {
  return `+${counts.additions} -${counts.deletions}`;
}

/** One file in bb's changes panel, as the panel's own file list holds it. */
export interface DiffFileEntry {
  path: string;
  previousPath: string | null;
  changeKind: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * The label bb puts on this file's card, which is what a mark is keyed on:
 * the path, or `previous -> current` for a rename or copy. Mirrors
 * `formatDiffEntryLabel` in bb's DiffFileCard.
 */
export function labelForEntry(entry: DiffFileEntry): string {
  if (
    (entry.changeKind === "renamed" || entry.changeKind === "copied") &&
    entry.previousPath !== null &&
    entry.previousPath !== "" &&
    entry.previousPath !== entry.path
  ) {
    return `${entry.previousPath} -> ${entry.path}`;
  }
  return entry.path;
}

/** How far through a diff the marks go. */
export interface ReviewProgress {
  viewed: number;
  total: number;
}

/**
 * Count the files in `entries` whose current diff is marked viewed. A binary
 * image's header shows its size rather than counts, so its mark was stored as
 * `none` and is counted on that.
 */
export function reviewProgress(
  record: ViewedRecord,
  entries: readonly DiffFileEntry[],
): ReviewProgress {
  let viewed = 0;
  for (const entry of entries) {
    const mark = record[labelForEntry(entry)];
    if (mark === undefined) continue;
    if (mark === fingerprintFromCounts(entry) || (entry.binary && mark === "none")) {
      viewed += 1;
    }
  }
  return { viewed, total: entries.length };
}

/** Whether this exact diff of this file has been marked viewed. */
export function isViewed(record: ViewedRecord, target: FileMarkTarget): boolean {
  return record[target.path] === target.fingerprint;
}

/**
 * Apply a mark change. Returns a new record, or the original when nothing
 * would change — callers use identity to skip a redundant write.
 */
export function withMark(
  record: ViewedRecord,
  target: FileMarkTarget,
  viewed: boolean,
): ViewedRecord {
  if (viewed) {
    if (record[target.path] === target.fingerprint) return record;
    return { ...record, [target.path]: target.fingerprint };
  }
  if (!(target.path in record)) return record;
  const next = { ...record };
  delete next[target.path];
  return next;
}

/**
 * Drop marks for files that are no longer in the diff. Without this a
 * long-lived thread accumulates a mark for every path it ever touched, and a
 * file that leaves the diff and comes back returns already-checked.
 */
export function prune(
  record: ViewedRecord,
  presentPaths: readonly string[],
): ViewedRecord {
  const present = new Set(presentPaths);
  const kept = Object.keys(record).filter((path) => present.has(path));
  if (kept.length === Object.keys(record).length) return record;
  const next: ViewedRecord = {};
  for (const path of kept) next[path] = record[path] as string;
  return next;
}
