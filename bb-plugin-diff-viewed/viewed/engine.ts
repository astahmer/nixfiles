// The sync loop: what actually decorates bb's DOM and keeps it agreeing with
// stored state.
//
// This lives outside app.tsx so it can be driven under jsdom. Every bug this
// plugin has shipped was in here, and each one survived a green test run
// because the only tests were of pure functions and fixtures — the loop that
// wires them together was never exercised. `startEngine` takes its RPC,
// scheduler, and location as parameters for exactly that reason.
import {
  cardForControl,
  createControl,
  createFilterItem,
  existingControl,
  existingFilterItem,
  FILTER_ATTR,
  findCards,
  findOpenSelectorMenu,
  findToolbar,
  paintCard,
  paintFilterItem,
  renderProgress,
  undecorate,
  type DiffCard,
} from "./dom";
import { readDiffFiles, rowOf, type DiffFilesRead } from "./files";
import {
  isViewed,
  labelForEntry,
  reviewProgress,
  threadIdFromPath,
  type ViewedRecord,
} from "./marks";

export type RecordResult = { record: ViewedRecord };
export type FilterResult = {
  onlyUnviewed: boolean;
  autoMarkOnScroll: boolean;
};

export interface EngineDeps {
  /** Calls one of the plugin's RPC methods. */
  rpc: <Result>(method: string, input: unknown) => Promise<Result>;
  /** Aborted when the content script generation is torn down. */
  signal: AbortSignal;
  /** The document to decorate. */
  doc: Document;
  /** The current route, read fresh on every pass. */
  pathname: () => string;
  /** Defer a pass. Returns a cancel function. `requestAnimationFrame` in bb. */
  defer: (run: () => void) => () => void;
  /** Where failures go. */
  warn: (cause: unknown) => void;
}

export interface Engine {
  /** Run a pass now, skipping the scheduler. Tests use this. */
  syncNow: () => void;
  /** Ask for a pass on the next frame. */
  schedule: () => void;
  /** Refresh persisted preferences, for example when this window regains focus. */
  refresh: () => void;
  dispose: () => void;
}

interface CardPosition {
  top: number;
  boundary: number;
}

interface SyncState {
  threadId: string | null;
  record: ViewedRecord;
  /**
   * Files this engine has already collapsed for you, keyed by path and
   * fingerprint. It is why a viewed file can be reopened and stay open: each
   * one is collapsed at most once per diff, not on every pass.
   */
  autoCollapsed: Set<string>;
  pruned: boolean;
  /** Whether files marked viewed are hidden. Shared by every thread. */
  onlyUnviewed: boolean;
  /** Whether scrolling past a file should mark and collapse it. */
  autoMarkOnScroll: boolean;
  /** Last observed header positions, used to detect a downward crossing. */
  cardPositions: Map<string, CardPosition>;
}

function collapseKey(path: string, fingerprint: string): string {
  return `${path} ${fingerprint}`;
}

/** Find the scroll area's top edge, falling back to the browser viewport. */
function scrollBoundaryFor(element: HTMLElement, doc: Document): number {
  const view = doc.defaultView;
  let ancestor = element.parentElement;
  while (ancestor !== null && ancestor !== doc.body) {
    const overflowY = view?.getComputedStyle(ancestor).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      ancestor.scrollHeight > ancestor.clientHeight
    ) {
      return ancestor.getBoundingClientRect().top;
    }
    ancestor = ancestor.parentElement;
  }
  return 0;
}

export function startEngine(deps: EngineDeps): Engine {
  const { rpc, signal, doc, pathname, defer, warn } = deps;
  const state: SyncState = {
    threadId: null,
    record: {},
    autoCollapsed: new Set(),
    pruned: false,
    onlyUnviewed: false,
    autoMarkOnScroll: false,
    cardPositions: new Map(),
  };
  // True while this engine is writing to the DOM, so an observer driving
  // `schedule` does not treat its own edits as a reason to run again.
  let writing = false;
  let cancel: (() => void) | null = null;
  let loading: Promise<void> | null = null;
  // Problems already sent to the server log, so a broken read is logged once
  // per window rather than on every pass.
  const reported = new Set<string>();

  const fail = (cause: unknown) => {
    // A failed write must not leave the checkbox showing a state the server
    // never accepted, so resync from whatever the server does have.
    warn(cause);
    void reload();
  };

  function schedule(): void {
    if (signal.aborted || cancel !== null) return;
    cancel = defer(() => {
      cancel = null;
      syncNow();
    });
  }

  async function reload(): Promise<void> {
    const { threadId } = state;
    if (threadId === null) return;
    try {
      const { record } = await rpc<RecordResult>("viewed_list", { threadId });
      if (signal.aborted || state.threadId !== threadId) return;
      state.record = record;
      schedule();
    } catch (cause) {
      warn(cause);
    }
  }

  /**
   * Handle a click on one file's Viewed checkbox.
   *
   * The card is resolved from the clicked control, never from the pass that
   * injected it — see `cardForControl` for why nothing captured at injection
   * time can be trusted here.
   */
  function setMark(control: Element, viewed: boolean): void {
    const { threadId } = state;
    const card = cardForControl(control);
    if (threadId === null || card === null) return;

    // Paint optimistically: the checkbox has already moved under the user's
    // cursor and snapping it back while a round trip runs reads as a bug.
    state.record = viewed
      ? { ...state.record, [card.path]: card.fingerprint }
      : Object.fromEntries(
          Object.entries(state.record).filter(([path]) => path !== card.path),
        );

    const key = collapseKey(card.path, card.fingerprint);
    writing = true;
    try {
      paintCard(card, viewed);
      if (viewed) {
        state.autoCollapsed.add(key);
        if (!card.isCollapsed) card.toggle.click();
      } else {
        state.autoCollapsed.delete(key);
        if (card.isCollapsed) card.toggle.click();
      }
    } finally {
      writing = false;
    }

    schedule();
    rpc<RecordResult>("viewed_set", {
      threadId,
      path: card.path,
      fingerprint: card.fingerprint,
      viewed,
    }).then(({ record }) => {
      if (signal.aborted || state.threadId !== threadId) return;
      state.record = record;
      schedule();
    }, fail);
  }

  async function loadFilter(): Promise<void> {
    try {
      const { onlyUnviewed, autoMarkOnScroll } = await rpc<FilterResult>("filter_get", null);
      if (signal.aborted) return;
      state.onlyUnviewed = onlyUnviewed;
      state.autoMarkOnScroll = autoMarkOnScroll;
      schedule();
    } catch (cause) {
      warn(cause);
    }
  }

  /** Handle a click on the Only unviewed item in the range dropdown. */
  function setFilter(onlyUnviewed: boolean): void {
    state.onlyUnviewed = onlyUnviewed;
    // Close the menu the way bb's own items do once one is picked. Radix
    // listens for Escape on the document, so a dispatched one is enough.
    doc.dispatchEvent(
      new doc.defaultView!.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    schedule();
    rpc<FilterResult>("filter_set", { onlyUnviewed }).then(
      (result) => {
        if (signal.aborted) return;
        state.onlyUnviewed = result.onlyUnviewed;
        schedule();
      },
      (cause: unknown) => {
        warn(cause);
        void loadFilter();
      },
    );
  }

  function applyFilter(active: boolean): void {
    const root = doc.documentElement;
    if (active && state.onlyUnviewed) {
      if (!root.hasAttribute(FILTER_ATTR)) root.setAttribute(FILTER_ATTR, "");
    } else if (root.hasAttribute(FILTER_ATTR)) {
      root.removeAttribute(FILTER_ATTR);
    }

    const menu = active ? findOpenSelectorMenu(doc) : null;
    if (menu === null) return;
    let item = existingFilterItem(menu);
    if (item === null) {
      const nodes = createFilterItem(setFilter);
      menu.append(...nodes);
      item = nodes[nodes.length - 1]!;
    }
    paintFilterItem(item, state.onlyUnviewed);
  }

  function report(message: string): void {
    if (reported.has(message)) return;
    reported.add(message);
    warn(new Error(message));
    rpc("problem_report", { message }).catch(() => {});
  }

  /**
   * Show review progress for the whole diff, and prune marks against it.
   *
   * Both need every file in the diff, not only the cards bb has drawn, so both
   * come from the panel's own file list. When that list cannot be read the
   * toolbar says so and the problem is logged; nothing is pruned, since
   * pruning against a partial list is what deletes marks that are still good.
   */
  function syncProgress(threadId: string, cards: readonly DiffCard[]): void {
    const first = cards[0];
    if (first === undefined) {
      renderProgress(doc, null);
      return;
    }
    const row = rowOf(first.headerRow);
    const read: DiffFilesRead =
      row === null
        ? { status: "unreadable", reason: "the card is not inside a [data-index] row" }
        : readDiffFiles(row);
    if (read.status === "unreadable") {
      renderProgress(doc, { kind: "unavailable", reason: read.reason });
      report(`Could not read the changes panel's file list: ${read.reason}`);
      return;
    }
    renderProgress(doc, {
      kind: "progress",
      ...reviewProgress(state.record, read.files),
    });

    // Prune once per thread, against the full range only: a narrower range
    // such as Uncommitted leaves out files whose marks are still good.
    if (state.pruned || read.targetType !== "all" || loading === null) return;
    state.pruned = true;
    const presentPaths = read.files.map(labelForEntry);
    void loading.then(() => {
      if (signal.aborted || state.threadId !== threadId) return;
      rpc<RecordResult>("viewed_prune", { threadId, presentPaths }).then(
        ({ record }) => {
          if (signal.aborted || state.threadId !== threadId) return;
          state.record = record;
          schedule();
        },
        fail,
      );
    });
  }

  function decorate(cards: readonly DiffCard[]): void {
    writing = true;
    try {
      for (const card of cards) {
        if (existingControl(card) === null) {
          // The handler is given its own control, not this card object, so the
          // click re-reads the live header instead of a stale snapshot.
          const control: HTMLElement = createControl(card.path, (viewed) =>
            setMark(control, viewed),
          );
          card.actions.append(control);
        }
        const viewed = isViewed(state.record, card);
        paintCard(card, viewed);
        const key = collapseKey(card.path, card.fingerprint);
        if (viewed && !card.isCollapsed && !state.autoCollapsed.has(key)) {
          state.autoCollapsed.add(key);
          card.toggle.click();
        }
      }
    } finally {
      writing = false;
    }
  }

  /** Mark headers that crossed the top edge while the reader scrolled down. */
  function markScrolledPast(cards: readonly DiffCard[]): void {
    const nextPositions = new Map<string, CardPosition>();
    for (const card of cards) {
      const key = collapseKey(card.path, card.fingerprint);
      const rect = card.headerRow.getBoundingClientRect();
      const position = {
        top: rect.top,
        boundary: scrollBoundaryFor(card.headerRow, doc),
      };
      nextPositions.set(key, position);

      const previous = state.cardPositions.get(key);
      if (
        !state.autoMarkOnScroll ||
        previous === undefined ||
        previous.top < previous.boundary ||
        position.top >= position.boundary ||
        position.top >= previous.top ||
        isViewed(state.record, card)
      ) {
        continue;
      }
      const control = existingControl(card);
      if (control !== null) setMark(control, true);
    }
    state.cardPositions = nextPositions;
  }

  function syncNow(): void {
    if (signal.aborted) return;
    const threadId = threadIdFromPath(pathname());
    if (threadId !== state.threadId) {
      state.threadId = threadId;
      state.record = {};
      state.autoCollapsed.clear();
      state.pruned = false;
      state.cardPositions.clear();
      if (threadId !== null) loading = reload();
    }
    // The toolbar's presence is the signal that the changes panel is open. The
    // card list below it has no container attribute, so there is nothing else
    // to test, and scanning the whole document on every pass would be wasteful
    // on the many screens that have no diff at all.
    const toolbar = findToolbar(doc);
    if (toolbar === null || threadId === null) {
      writing = true;
      undecorate(doc.body);
      applyFilter(false);
      renderProgress(doc, null);
      writing = false;
      return;
    }

    const visible = findCards(doc);
    decorate(visible);
    markScrolledPast(visible);
    writing = true;
    try {
      applyFilter(true);
      syncProgress(threadId, visible);
    } finally {
      writing = false;
    }
  }

  // bb re-renders constantly, so the decoration is re-applied from whatever the
  // DOM currently says rather than assumed to survive. Passes are deferred and
  // coalesced, and edits this engine makes itself are skipped.
  const observer = new doc.defaultView!.MutationObserver(() => {
    if (writing) return;
    schedule();
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-label"],
  });

  const onScroll = () => {
    schedule();
  };
  doc.defaultView!.addEventListener("scroll", onScroll, { capture: true, passive: true });

  void loadFilter();
  schedule();

  return {
    syncNow,
    schedule,
    refresh() {
      void loadFilter();
    },
    dispose() {
      observer.disconnect();
      doc.defaultView!.removeEventListener("scroll", onScroll, true);
      if (cancel !== null) cancel();
      cancel = null;
      writing = true;
      undecorate(doc.body);
      applyFilter(false);
      writing = false;
    },
  };
}
