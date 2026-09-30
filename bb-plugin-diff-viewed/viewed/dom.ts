// Reading and decorating bb's diff card headers.
//
// bb owns this DOM. Everything here anchors on the most stable thing bb
// actually emits — the toolbar's `data-testid`, the collapse button's
// accessible name and `aria-expanded`, and the header's two-child structure —
// and never on a minified class name. Read GitDiffCardHeader in
// app/dist/assets before changing an assumption here; the header renders as:
//
//   <div class="… items-center justify-between …">        <- headerRow
//     <span class="flex min-w-0 items-center">            <- left
//       <button aria-label="Collapse src/a.ts" aria-expanded="true">…</button>
//       <span>… path link, copy, open-in-editor …</span>
//     </span>
//     <span class="flex shrink-0 items-center gap-1">     <- right
//       {actionSlot}{+12 -3}
//     </span>
//   </div>
import {
  fingerprintFromStats,
  pathFromToggleLabel,
  type FileMarkTarget,
} from "./marks";

/** Marks a node this plugin created, so cleanup can find every one of them. */
export const OWNED_ATTR = "data-diff-viewed-owned";
/** Set on a header row whose file is marked viewed. Drives the dimming. */
export const VIEWED_ATTR = "data-diff-viewed";
/** Set on `<html>` while Only unviewed is on. Drives the hiding. */
export const FILTER_ATTR = "data-diff-viewed-only-unviewed";
/** Set on the toolbar's details group while it holds the progress line. */
const PROGRESS_HOST_ATTR = "data-diff-viewed-progress-host";
/** Marks the progress line this plugin adds above bb's line counts. */
const PROGRESS_ATTR = "data-diff-viewed-progress";
/** Marks the Only unviewed item this plugin adds to bb's range dropdown. */
const FILTER_ITEM_ATTR = "data-diff-viewed-filter";
/** Timeline diffs, which are deliberately out of scope: the same path recurs
 * once per message there, so one mark could not mean anything useful. */
const TIMELINE_SELECTOR = "[data-timeline-file-diff]";

/** One diff card header, resolved to the parts this plugin touches. */
export interface DiffCard extends FileMarkTarget {
  headerRow: HTMLElement;
  /** Where the checkbox goes: the header's right-hand action group. */
  actions: HTMLElement;
  toggle: HTMLButtonElement;
  isCollapsed: boolean;
}

/**
 * Resolve a collapse control to the card it belongs to, or null when the
 * element is not a diff card header after all.
 *
 * There is deliberately no "must be inside the changes panel" check: the card
 * list has no container attribute of its own, and requiring one that only
 * looked right is what made an earlier version of this plugin match nothing at
 * all. The structural checks below carry that weight instead, and they are
 * strict enough that a bare `aria-expanded` disclosure elsewhere in the app
 * cannot pass.
 */
export function resolveCard(toggle: Element): DiffCard | null {
  if (!(toggle instanceof HTMLButtonElement)) return null;
  const expanded = toggle.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") return null;
  if (toggle.closest(TIMELINE_SELECTOR) !== null) return null;

  const left = toggle.parentElement;
  if (left === null || left.firstElementChild !== toggle) return null;
  const headerRow = left.parentElement;
  if (headerRow === null || headerRow.childElementCount !== 2) return null;
  if (!headerRow.classList.contains("justify-between")) return null;
  const actions = headerRow.lastElementChild;
  if (!(actions instanceof HTMLElement) || actions === left) return null;

  const path = pathFromToggleLabel(toggle.getAttribute("aria-label"));
  if (path === null) return null;

  return {
    path,
    fingerprint: readFingerprint(actions),
    headerRow,
    actions,
    toggle,
    isCollapsed: expanded === "false",
  };
}

/**
 * The card's insertion/deletion counts, read from the action group with this
 * plugin's own nodes excluded so the checkbox can never feed its own
 * fingerprint back in.
 */
function readFingerprint(actions: HTMLElement): string {
  const statText = Array.from(actions.children)
    .filter((child) => !child.hasAttribute(OWNED_ATTR))
    .map((child) => child.textContent ?? "")
    .join(" ");
  return fingerprintFromStats(statText);
}

/** Every diff card currently rendered, in document order. */
export function findCards(root: ParentNode): DiffCard[] {
  const cards: DiffCard[] = [];
  for (const toggle of root.querySelectorAll("button[aria-expanded]")) {
    const card = resolveCard(toggle);
    if (card !== null) cards.push(card);
  }
  return cards;
}

/**
 * Resolve the card from one of this plugin's own controls.
 *
 * This is the lookup the click handler uses. Holding on to the card object —
 * or even the collapse button — from the pass that injected the checkbox does
 * not survive bb re-rendering the header: the snapshot's `isCollapsed` goes
 * stale, and a replaced button leaves the handler pointing at a node that is
 * no longer in the document, so clicking it does nothing. The control the user
 * just clicked is by definition still mounted, so walking up from it always
 * lands on the live header.
 */
export function cardForControl(control: Element): DiffCard | null {
  const actions = control.parentElement;
  const headerRow = actions?.parentElement;
  const toggle = headerRow?.firstElementChild?.firstElementChild;
  return toggle === undefined || toggle === null ? null : resolveCard(toggle);
}

/** This plugin's control inside a card header, if it is still mounted. */
export function existingControl(card: DiffCard): HTMLLabelElement | null {
  const control = card.actions.querySelector(`label[${OWNED_ATTR}]`);
  return control instanceof HTMLLabelElement ? control : null;
}

/**
 * Build the Viewed control. It is a real `<label>` wrapping a real checkbox so
 * it is keyboard-reachable and announced correctly without any of bb's React
 * state; `onToggle` receives the user's intent, not the DOM's new value.
 */
export function createControl(
  path: string,
  onToggle: (viewed: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.setAttribute(OWNED_ATTR, "");
  label.className =
    "flex shrink-0 cursor-pointer select-none items-center gap-1.5 " +
    "rounded-md px-1.5 py-0.5 text-xs font-normal text-muted-foreground " +
    "transition-colors hover:bg-state-hover hover:text-foreground";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "size-3.5 cursor-pointer accent-primary";
  input.setAttribute("aria-label", `Mark ${path} viewed`);
  input.addEventListener("change", () => {
    onToggle(input.checked);
  });
  // bb's card header is itself clickable in places; keep the toggle from
  // reaching anything behind it.
  label.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const text = document.createElement("span");
  text.textContent = "Viewed";

  label.append(input, text);
  return label;
}

/** Reflect a card's viewed state onto its control and header row. */
export function paintCard(card: DiffCard, viewed: boolean): void {
  const control = existingControl(card);
  const input = control?.querySelector("input");
  if (input instanceof HTMLInputElement && input.checked !== viewed) {
    input.checked = viewed;
  }
  if (viewed) {
    card.headerRow.setAttribute(VIEWED_ATTR, "true");
  } else {
    card.headerRow.removeAttribute(VIEWED_ATTR);
  }
}

/**
 * The dimming, injected once. It deliberately does not dim the control itself
 * — a checkbox you have to squint at to uncheck is worse than no checkbox.
 */
export const STYLE_TEXT = `
[${VIEWED_ATTR}="true"] > span:first-child {
  opacity: 0.5;
  transition: opacity 150ms ease;
}
[${VIEWED_ATTR}="true"] label[${OWNED_ATTR}] {
  color: var(--foreground);
}
[${FILTER_ATTR}] [data-index]:has([${VIEWED_ATTR}="true"]) {
  display: none;
}
[${PROGRESS_HOST_ATTR}] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "progress actions" "summary actions";
  align-items: center;
  column-gap: 0.75rem;
}
[${PROGRESS_HOST_ATTR}] > [${PROGRESS_ATTR}] {
  grid-area: progress;
  justify-self: end;
  font-size: 0.6875rem;
  line-height: 0.875rem;
}
[${PROGRESS_HOST_ATTR}] > [data-testid="git-diff-toolbar-summary"] {
  grid-area: summary;
  justify-self: end;
  font-size: 0.6875rem;
  line-height: 0.875rem;
}
/* The progress line above already gives the file count, so keep only bb's
   "+a -b" tally. The "N files, " before it is bare text with no element of
   its own to hide, so the summary's text is shrunk to nothing and the tally
   span is given its size back. A summary with no tally keeps its text. */
[${PROGRESS_HOST_ATTR}] > [data-testid="git-diff-toolbar-summary"]:has(> span) {
  font-size: 0;
}
[${PROGRESS_HOST_ATTR}] > [data-testid="git-diff-toolbar-summary"] > span {
  font-size: 0.6875rem;
}
[${PROGRESS_HOST_ATTR}] > [data-testid="git-diff-toolbar-actions"] {
  grid-area: actions;
}
`;

/**
 * The changes-panel toolbar. This plugin does not touch any of its controls;
 * it looks for the toolbar only because its presence is how the plugin knows
 * the changes panel is open at all, the file card list below it carrying no
 * attribute of its own.
 */
export const TOOLBAR_SELECTOR = '[data-testid="git-diff-toolbar-actions"]';

export function findToolbar(root: ParentNode): HTMLElement | null {
  const toolbar = root.querySelector(TOOLBAR_SELECTOR);
  return toolbar instanceof HTMLElement ? toolbar : null;
}

/**
 * The toolbar group holding bb's "N files, +a -b" summary and the action
 * buttons. The progress line is stacked above the summary inside it.
 */
const DETAILS_SELECTOR = '[data-testid="git-diff-toolbar-details"]';

/** What the progress line shows. */
export type ProgressView =
  | { kind: "progress"; viewed: number; total: number }
  | { kind: "unavailable"; reason: string };

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ringSvg(viewed: number, total: number): string {
  const fraction = total === 0 ? 0 : viewed / total;
  const complete = total > 0 && viewed === total;
  const dash = (fraction * RING_CIRCUMFERENCE).toFixed(2);
  const color = complete ? "var(--success)" : "var(--primary)";
  return (
    '<svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 -rotate-90" aria-hidden="true">' +
    `<circle cx="8" cy="8" r="${RING_RADIUS}" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/>` +
    `<circle cx="8" cy="8" r="${RING_RADIUS}" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-dasharray="${dash} ${RING_CIRCUMFERENCE.toFixed(2)}"` +
    (fraction === 0 ? ' stroke-opacity="0"' : "") +
    "/></svg>"
  );
}

function progressMarkup(view: ProgressView): { html: string; title: string } {
  if (view.kind === "unavailable") {
    return {
      html:
        '<span class="truncate text-muted-foreground">Viewed progress unavailable</span>',
      title:
        `Diff Viewed could not read this panel's file list: ${view.reason}. ` +
        "A bb update probably changed the changes panel; see the plugin's README.",
    };
  }
  const { viewed, total } = view;
  return {
    html:
      ringSvg(viewed, total) +
      '<span class="truncate">' +
      `<span class="text-foreground">${viewed}</span>` +
      '<span class="text-muted-foreground">/</span>' +
      `<span class="text-foreground">${total}</span>` +
      '<span class="text-muted-foreground"> viewed</span></span>',
    title: `${viewed} of ${total} file${total === 1 ? "" : "s"} viewed`,
  };
}

/**
 * Show `view` above bb's line counts, or remove the line when `view` is null.
 * Rewrites the line only when what it says changes, so a pass that finds
 * nothing new does not touch the DOM.
 */
export function renderProgress(doc: Document, view: ProgressView | null): void {
  const details = doc.querySelector(DETAILS_SELECTOR);
  if (!(details instanceof HTMLElement)) return;
  let line = details.querySelector(`:scope > [${PROGRESS_ATTR}]`);
  if (view === null) {
    line?.remove();
    details.removeAttribute(PROGRESS_HOST_ATTR);
    return;
  }
  if (!(line instanceof HTMLElement)) {
    line = doc.createElement("div");
    line.setAttribute(OWNED_ATTR, "");
    line.setAttribute(PROGRESS_ATTR, "");
    line.className =
      "flex min-w-0 items-center gap-1 pl-2.5";
    details.append(line);
  }
  if (!details.hasAttribute(PROGRESS_HOST_ATTR)) {
    details.setAttribute(PROGRESS_HOST_ATTR, "");
  }
  // Compared on a key rather than on innerHTML, which the browser
  // re-serializes and so would never equal the markup it was given.
  const element = line as HTMLElement;
  const key = JSON.stringify(view);
  if (element.getAttribute(PROGRESS_ATTR) === key) return;
  const { html, title } = progressMarkup(view);
  element.innerHTML = html;
  element.title = title;
  element.setAttribute(PROGRESS_ATTR, key);
}

/**
 * The range dropdown's menu ("All changes", "Uncommitted changes", …), when it
 * is open. The menu is portaled out of the toolbar, so it is found through the
 * trigger: Radix points the trigger's `aria-controls` at the menu's id and sets
 * `aria-expanded` while it is open.
 *
 * On a narrow viewport bb renders the menu as a sheet of plain buttons with no
 * such id, so this finds nothing there and the filter is not offered.
 */
export const SELECTOR_SLOT_SELECTOR =
  '[data-testid="git-diff-toolbar-selector-slot"]';

export function findOpenSelectorMenu(doc: Document): HTMLElement | null {
  const trigger = doc.querySelector(
    `${SELECTOR_SLOT_SELECTOR} button[aria-expanded="true"]`,
  );
  const menuId = trigger?.getAttribute("aria-controls");
  if (menuId === null || menuId === undefined || menuId === "") return null;
  const menu = doc.getElementById(menuId);
  if (!(menu instanceof HTMLElement)) return null;
  return menu.getAttribute("role") === "menu" ? menu : null;
}

/** This plugin's Only unviewed item inside the open menu, if it is there. */
export function existingFilterItem(menu: HTMLElement): HTMLElement | null {
  const item = menu.querySelector(`[${FILTER_ITEM_ATTR}]`);
  return item instanceof HTMLElement ? item : null;
}

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"/></svg>';

/**
 * Build the separator and Only unviewed item that go at the bottom of the
 * range dropdown, styled like bb's own items with the check on the right.
 *
 * Radix does not know about this item, so arrow keys skip it; it is reachable
 * by pointer only. `onToggle` receives the user's intent.
 */
export function createFilterItem(
  onToggle: (onlyUnviewed: boolean) => void,
): HTMLElement[] {
  const separator = document.createElement("div");
  separator.setAttribute(OWNED_ATTR, "");
  separator.setAttribute("role", "separator");
  separator.className = "-mx-1 my-1 h-px bg-muted";

  const item = document.createElement("div");
  item.setAttribute(OWNED_ATTR, "");
  item.setAttribute(FILTER_ITEM_ATTR, "");
  item.setAttribute("role", "menuitemcheckbox");
  item.setAttribute("aria-checked", "false");
  item.className =
    "relative flex cursor-default select-none items-center justify-between " +
    "gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none " +
    "hover:bg-state-hover hover:text-foreground";

  const text = document.createElement("span");
  text.textContent = "Only unviewed";
  const check = document.createElement("span");
  check.className = "flex items-center opacity-0";
  check.innerHTML = CHECK_SVG;
  item.append(text, check);

  item.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggle(item.getAttribute("aria-checked") !== "true");
  });

  return [separator, item];
}

/** Reflect the filter onto its menu item. */
export function paintFilterItem(item: HTMLElement, onlyUnviewed: boolean): void {
  const value = String(onlyUnviewed);
  if (item.getAttribute("aria-checked") !== value) {
    item.setAttribute("aria-checked", value);
  }
  const check = item.lastElementChild;
  if (check instanceof HTMLElement) {
    check.classList.toggle("opacity-0", !onlyUnviewed);
    check.classList.toggle("opacity-100", onlyUnviewed);
  }
}

/** Remove every node, attribute, and class this plugin added under `root`. */
export function undecorate(root: ParentNode): void {
  for (const owned of root.querySelectorAll(`[${OWNED_ATTR}]`)) owned.remove();
  for (const row of root.querySelectorAll(`[${VIEWED_ATTR}]`)) {
    row.removeAttribute(VIEWED_ATTR);
  }
  for (const host of root.querySelectorAll(`[${PROGRESS_HOST_ATTR}]`)) {
    host.removeAttribute(PROGRESS_HOST_ATTR);
  }
}
