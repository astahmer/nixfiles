import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Diff as BbDiff,
  useBbContext,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { layoutRevisionGraph, type RevisionGraphRow } from "./graph-layout";

type Revision = {
  commitId: string;
  changeId: string;
  changeIdPrefix: string;
  empty: boolean;
  description: string;
  timestamp: number;
  parents: string[];
  bookmarks: string[];
  tags: string[];
  workspaces: string[];
};

type FileChange = { path: string; status: string };
type FileStat = { path: string; additions: number; deletions: number };
type ProjectPath = { name: string; path: string; hostId: string };

type Snapshot = {
  root: string;
  currentRevision: string;
  lastPushAt: number | null;
  lastPushRevision: string | null;
  revisions: Revision[];
  changes: FileChange[];
  workspaces: { name: string; path: string; revision: string }[];
};

type DiffTarget = { revision: string | null; path: string };
type RevisionDiffFile = { path: string; status: string; patch: string };
type PendingRebase = { source: Revision; destination: Revision; branch: Revision[] };
type RevisionContextMenu = { x: number; y: number; revision: Revision };
type DirectoryResult = {
  directory: string;
  parent: string | null;
  entries: { kind: "directory" | "file"; name: string; path: string }[];
};
type GraphItem = { revision: Revision; isPreview: boolean; originalId?: string };

const previewColor = "#a5df6f";
const graphColors = ["#4fc1ff", "#c586c0", "#4ec9b0", "#dcdcaa", "#ce9178", "#b5cea8"];
const laneColor = (lane: number) => graphColors[lane % graphColors.length] ?? "#4fc1ff";
const label = (revision: Revision) =>
  revision.description.trim().split("\n")[0] || "(no description)";
const relativeTime = (timestamp: number) => {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo`;
  return `${Math.floor(seconds / 31_536_000)}y`;
};
const revisionDay = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
};

const styles = `
.jj-page{--jj-line:var(--border);--jj-rail:color-mix(in srgb,var(--muted-foreground) 48%,var(--background));--jj-workspace:#4ec9b0;--jj-evolved:#b982ff;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative;background:var(--background);color:var(--foreground);font:13px/1.45 var(--font-sans,system-ui);container-type:inline-size}
.jj-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--jj-line);flex:none}
.jj-brand{font-size:14px;font-weight:650;white-space:nowrap;margin-right:4px}.jj-tabs{display:flex;gap:4px;margin-right:auto}.jj-tab,.jj-button{border:1px solid var(--jj-line);border-radius:6px;background:var(--card);color:var(--foreground);padding:6px 10px;cursor:pointer}.jj-tab[aria-selected=true],.jj-button-primary{background:var(--accent);font-weight:600}.jj-button:hover,.jj-tab:hover{background:var(--accent)}.jj-button:disabled{opacity:.5;cursor:not-allowed}
.jj-input{border:1px solid var(--jj-line);border-radius:6px;background:var(--background);color:var(--foreground);padding:7px 9px;min-width:0}.jj-host{width:150px}.jj-path{flex:1;width:auto;min-width:140px}.jj-toolbar .jj-refresh{white-space:nowrap}
.jj-context{display:flex;align-items:center;gap:8px;flex:none;padding:7px 12px;border-bottom:1px solid var(--jj-line);color:var(--muted-foreground);font:11px var(--font-mono,monospace);overflow:hidden}.jj-context-path{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.jj-error{padding:9px 12px;color:var(--destructive);border-bottom:1px solid var(--jj-line)}.jj-empty{display:grid;place-items:center;min-height:140px;padding:26px;color:var(--muted-foreground);text-align:center}
.jj-history{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain}.jj-revision{border-bottom:1px solid color-mix(in srgb,var(--jj-line) 70%,transparent)}.jj-revision[data-selected=true]{background:color-mix(in srgb,var(--accent) 35%,transparent)}.jj-revision-button{width:100%;min-height:42px;display:grid;grid-template-columns:var(--jj-graph-width) minmax(0,1fr) auto;gap:4px;align-items:center;padding:3px 10px 3px 0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.jj-revision-button:hover,.jj-revision-button:focus-visible{background:var(--accent);outline:none}.jj-graph-cell{position:relative;display:block;height:42px;overflow:visible}.jj-graph-cell svg{position:absolute;inset:0;overflow:visible}.jj-revision-main{min-width:0;display:flex;flex-direction:column;gap:2px}.jj-revision-title{display:flex;gap:7px;align-items:center;min-width:0}.jj-revision-subject{font-weight:550;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.jj-revision-meta{display:flex;gap:5px;align-items:center;color:var(--muted-foreground);font:10px var(--font-mono,monospace);white-space:nowrap}.jj-current{color:var(--primary);font-weight:700}.jj-chevron{width:16px;color:var(--muted-foreground);transition:transform .12s}.jj-revision[data-selected=true] .jj-chevron{transform:rotate(90deg)}
.jj-labels{display:flex;gap:4px;flex-wrap:wrap;max-height:22px;overflow:hidden}.jj-badge{display:inline-flex;align-items:center;max-width:180px;padding:1px 6px;border:1px solid var(--jj-line);border-radius:99px;color:var(--muted-foreground);font-size:10px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.jj-badge-bookmark{background:color-mix(in srgb,var(--primary) 18%,transparent);border-color:color-mix(in srgb,var(--primary) 45%,var(--jj-line));color:var(--foreground)}.jj-badge-workspace{background:var(--secondary);color:var(--secondary-foreground)}.jj-revision-details{padding:10px 14px 14px 24px;border-top:1px solid var(--jj-line);background:color-mix(in srgb,var(--card) 65%,var(--background))}.jj-detail-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.jj-description-edit{flex:1;min-width:220px;min-height:50px;resize:vertical}.jj-section-heading{display:flex;align-items:center;gap:8px;padding:7px 0;color:var(--muted-foreground);font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.04em}.jj-file-list{display:flex;flex-direction:column;min-width:0}.jj-file-entry{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;min-width:0}.jj-file-button{min-width:0;display:flex;align-items:center;gap:8px;padding:5px 6px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:left;cursor:pointer}.jj-file-button:hover,.jj-file-button[data-selected=true]{background:var(--accent)}.jj-status{width:18px;flex:none;text-align:center;color:var(--muted-foreground);font:11px var(--font-mono,monospace)}.jj-status-added{color:#4ec9b0}.jj-status-deleted{color:#f48771}.jj-status-renamed{color:#dcdcaa}.jj-file-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jj-file-directory{color:var(--muted-foreground)}.jj-file-name{font-weight:550}.jj-file-preview{margin:5px 0 10px 27px;border:1px solid var(--jj-line);border-radius:6px;overflow:hidden}.jj-diff-empty{padding:16px;color:var(--muted-foreground)}.jj-detail-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:10px}.jj-detail-actions .jj-input{flex:1}
.jj-scm{min-height:0;flex:1;display:flex;flex-direction:column;overflow:auto}.jj-scm-heading{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--jj-line);font-weight:650}.jj-count{min-width:18px;padding:1px 6px;border-radius:99px;background:var(--secondary);color:var(--secondary-foreground);font-size:10px;text-align:center}.jj-scm-layout{min-height:220px;flex:1;display:grid;grid-template-columns:minmax(220px,36%) minmax(0,1fr)}.jj-scm-list{min-height:0;overflow:auto;border-right:1px solid var(--jj-line)}.jj-group{border-bottom:1px solid var(--jj-line)}.jj-group-header{width:100%;display:flex;align-items:center;gap:7px;padding:9px 10px;border:0;background:transparent;color:inherit;text-align:left;font-weight:600;cursor:pointer}.jj-group-header:hover{background:var(--accent)}.jj-group-header .jj-count{margin-left:auto}.jj-group-content{padding:0 5px 8px}.jj-working-actions{display:grid;gap:7px;padding:8px 8px 11px;border-bottom:1px solid var(--jj-line)}.jj-working-actions textarea{width:100%;min-height:48px;resize:vertical}.jj-working-actions-row{display:flex;gap:6px;flex-wrap:wrap}.jj-working-actions-row .jj-button{flex:1}.jj-selection-hint{padding:5px 4px;color:var(--muted-foreground);font-size:11px}.jj-history-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:center}.jj-history-select{min-width:0;display:flex;gap:7px;align-items:center;padding:7px 5px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:left;cursor:pointer}.jj-history-select:hover,.jj-history-select[data-selected=true]{background:var(--accent)}.jj-history-index{flex:none;color:var(--muted-foreground);font:10px var(--font-mono,monospace)}.jj-history-subject{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jj-mini-action{padding:3px 5px;border:0;border-radius:4px;background:transparent;color:var(--muted-foreground);font-size:10px;cursor:pointer}.jj-mini-action:hover{background:var(--accent);color:var(--foreground)}.jj-history-depth{display:flex;align-items:center;gap:5px;padding:8px 6px;color:var(--muted-foreground);font-size:11px}.jj-history-depth input{width:54px;padding:4px 5px}
.jj-preview{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:auto}.jj-preview-header{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--jj-line);font-weight:600}.jj-preview-header span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jj-preview-body{min-height:100px;flex:1;overflow:auto}.jj-preview-body>div{min-height:100%}.jj-revision-ops{padding:8px;border-top:1px solid var(--jj-line)}.jj-revision-ops textarea{width:100%;min-height:48px;resize:vertical}.jj-revision-file-list{max-height:200px;overflow:auto;margin-top:6px}.jj-checkbox{width:14px;height:14px;margin:0 0 0 4px;accent-color:var(--primary)}
.jj-workspaces{display:flex;gap:5px;flex-wrap:wrap;padding:7px 10px;border-top:1px solid var(--jj-line)}.jj-error-inline{padding:8px 10px;color:var(--destructive);font-size:12px}
.jj-confirm-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgb(0 0 0 / 55%)}.jj-confirm{width:min(440px,100%);padding:18px;border:1px solid var(--jj-line);border-radius:10px;background:var(--popover,var(--background));box-shadow:0 14px 50px rgb(0 0 0 / 35%)}.jj-confirm h2{margin:0 0 8px;font-size:15px}.jj-confirm p{color:var(--muted-foreground)}.jj-confirm-code{display:block;overflow-wrap:anywhere;padding:8px;border-radius:5px;background:var(--secondary);font:11px var(--font-mono,monospace)}.jj-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
@container(max-width:720px){.jj-toolbar{gap:6px;padding:8px}.jj-brand{width:100%}.jj-tabs{margin-right:0}.jj-host{width:125px}.jj-path{min-width:110px}.jj-scm-layout{grid-template-columns:minmax(0,1fr);}.jj-scm-list{max-height:45%;border-right:0;border-bottom:1px solid var(--jj-line)}.jj-preview{min-height:220px}.jj-revision-details{padding-left:12px}}
.jj-revision-button{min-height:34px;padding:1px 8px 1px 0}.jj-graph-cell{height:32px}.jj-revision-main{gap:0}.jj-revision-title{gap:8px}.jj-revision-subject{font-size:12px}.jj-revision-meta{gap:7px}.jj-revision-age{font:10px var(--font-sans,system-ui)}.jj-labels{min-height:15px;max-height:16px;gap:3px}.jj-badge{height:15px;padding:0 5px;font-size:9px}.jj-badge-current{height:18px;padding:0 7px;background:var(--primary);border-color:var(--primary);color:var(--primary-foreground,var(--background));font-size:10px;font-weight:800;letter-spacing:.03em}.jj-badge-workspace{background:color-mix(in srgb,#4ec9b0 18%,var(--background));border-color:color-mix(in srgb,#4ec9b0 48%,var(--jj-line));color:var(--foreground)}.jj-day-heading{position:sticky;top:0;z-index:2;padding:5px 10px 4px;border-bottom:1px solid var(--jj-line);background:var(--background);color:var(--muted-foreground);font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}.jj-revision[data-current=true]{background:color-mix(in srgb,var(--primary) 9%,var(--background));box-shadow:inset 3px 0 var(--primary)}.jj-revision[data-current=true] .jj-revision-subject{font-weight:700}.jj-graph-cell svg{height:32px}.jj-scm{overflow:hidden}.jj-scm-layout{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.jj-scm-list{min-height:0;flex:1;overflow:auto;border-right:0}.jj-group-content{padding:0 7px 5px}.jj-working-actions{gap:5px;padding:6px 8px}.jj-working-actions textarea{min-height:34px}.jj-workspaces{padding:5px 6px}.jj-history-depth{padding:5px 6px}.jj-ancestor-group{border-bottom:1px solid var(--jj-line)}.jj-ancestor-header{width:100%;display:flex;align-items:center;gap:7px;padding:7px 8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.jj-ancestor-header:hover,.jj-ancestor-header[aria-expanded=true]{background:var(--accent)}.jj-ancestor-label{flex:none;color:var(--muted-foreground);font:10px var(--font-mono,monospace)}.jj-ancestor-subject{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}.jj-ancestor-meta{color:var(--muted-foreground);font-size:10px;white-space:nowrap}.jj-ancestor-files{padding:0 8px 7px 18px}.jj-ancestor-ops{display:grid;gap:6px;padding:7px 8px 5px 18px}.jj-ancestor-ops textarea{width:100%;min-height:34px;resize:vertical}.jj-ancestor-actions{display:flex;gap:5px;flex-wrap:wrap}.jj-preview{min-height:0;flex:1;border-top:1px solid var(--jj-line)}.jj-preview-header{padding:6px 9px}.jj-preview-body{min-height:0;flex:1}.jj-preview-close{margin-left:auto;padding:2px 7px;border:0;border-radius:4px;background:transparent;color:var(--muted-foreground);cursor:pointer}.jj-preview-close:hover{background:var(--accent);color:var(--foreground)}
.jj-revision-age{white-space:nowrap;flex:none}.jj-working-content{max-height:min(42vh,320px);overflow:auto}.jj-working-actions textarea{min-height:28px;max-height:42px;overflow:auto}.jj-group-header[aria-expanded=true] .jj-chevron{transform:rotate(90deg)}
.jj-tabs{display:flex;align-items:center;gap:2px;margin-right:auto;border-bottom:1px solid var(--jj-line)}.jj-tab{position:relative;border:0;border-radius:0;background:transparent;color:var(--muted-foreground);padding:8px 10px;cursor:pointer}.jj-tab[aria-selected=true]{background:transparent;color:var(--foreground);font-weight:650}.jj-tab[aria-selected=true]::after{position:absolute;right:8px;bottom:-1px;left:8px;height:2px;background:var(--primary);content:""}.jj-tab:hover{color:var(--foreground);background:color-mix(in srgb,var(--accent) 45%,transparent)}.jj-badge-current{height:15px;padding:0 5px;background:var(--primary);border-color:var(--primary);color:var(--primary-foreground,var(--background));font-size:9px}.jj-badge-bookmark,.jj-badge-tag{background:color-mix(in srgb,#dcdcaa 18%,var(--background));border-color:color-mix(in srgb,#dcdcaa 45%,var(--jj-line));color:var(--foreground)}.jj-badge-workspace{background:color-mix(in srgb,#4ec9b0 18%,var(--background));border-color:color-mix(in srgb,#4ec9b0 48%,var(--jj-line));color:var(--foreground)}.jj-badge-workspace-default{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground,var(--background))}.jj-detail-toolbar{display:flex;flex-direction:column;align-items:stretch}.jj-detail-toolbar .jj-description-edit{width:100%;flex:none}.jj-detail-actions-row{display:flex;gap:7px;flex-wrap:wrap}.jj-button-squash::before{content:"↓ ";font-weight:700}
.jj-scm-list{display:flex;flex-direction:column;overflow:hidden;max-height:none}.jj-working-group{min-height:0;display:flex;flex-direction:column;overflow:hidden;flex-grow:0;flex-shrink:1}.jj-working-group-fill{flex:1 1 auto}.jj-working-content{max-height:none;min-height:0;flex:1;overflow:auto}.jj-history-group{min-height:0;flex:1 1 0;overflow:auto}.jj-scm-resizer{position:relative;z-index:1;display:flex;flex:0 0 7px;align-items:center;justify-content:center;border-block:1px solid var(--jj-line);background:var(--background);cursor:row-resize;touch-action:none}.jj-scm-resizer::after{width:28px;height:2px;border-radius:2px;background:var(--muted-foreground);content:""}.jj-scm-resizer:hover,.jj-scm-resizer:focus-visible{background:var(--accent);outline:none}.jj-scm-resizer:hover::after,.jj-scm-resizer:focus-visible::after{background:var(--primary)}
.jj-day-heading{position:sticky;top:0;z-index:2;width:100%;display:flex;align-items:center;gap:7px;padding:6px 10px;border:0;border-bottom:1px solid var(--jj-line);background:var(--background);color:var(--muted-foreground);font-size:11px;font-weight:700;letter-spacing:.06em;text-align:left;text-transform:uppercase;cursor:pointer}.jj-day-heading:hover{background:var(--accent);color:var(--foreground)}.jj-day-heading .jj-count{margin-left:auto}.jj-day-heading .jj-chevron{transform:rotate(90deg)}.jj-day-heading[aria-expanded=false] .jj-chevron{transform:rotate(0)}.jj-move-mode{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--jj-line);background:var(--card);box-shadow:0 3px 12px #0003}.jj-revision[data-dragged=true]{opacity:.42;transform:scale(.99);transition:opacity .12s,transform .12s}.jj-revision[data-drop-target=true]>.jj-revision-button{background:color-mix(in srgb,var(--primary) 18%,var(--background));box-shadow:inset 0 2px var(--primary)}.jj-rebase-preview{position:relative;margin:7px 12px 12px 24px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--primary) 55%,var(--jj-line));border-radius:8px;background:color-mix(in srgb,var(--primary) 7%,var(--card));animation:jj-rebase-enter .18s ease-out;box-shadow:0 8px 24px #0002}.jj-rebase-preview::before{position:absolute;left:-15px;top:-7px;bottom:calc(100% - 12px);width:2px;background:var(--primary);content:""}.jj-rebase-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:12px}.jj-rebase-preview-heading>span:last-child{color:var(--muted-foreground);font-size:11px;white-space:nowrap}.jj-rebase-preview-branch{max-height:180px;overflow:auto;border-left:2px solid var(--primary);margin-left:5px;padding-left:10px}.jj-rebase-preview-row{display:flex;align-items:center;gap:8px;min-height:27px;animation:jj-rebase-row-enter .18s ease-out both}.jj-rebase-preview-row:nth-child(2){animation-delay:25ms}.jj-rebase-preview-row:nth-child(3){animation-delay:50ms}.jj-rebase-preview-row:nth-child(4){animation-delay:75ms}.jj-rebase-preview-node{width:9px;height:9px;flex:none;border:2px solid var(--primary);border-radius:50%;background:var(--background);margin-left:-16px}.jj-rebase-preview-row code{margin-left:auto;color:var(--muted-foreground);font:10px var(--font-mono,monospace)}.jj-rebase-preview .jj-confirm-code{display:block;max-width:100%;overflow:auto;margin-top:9px}.jj-rebase-preview-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:9px}@keyframes jj-rebase-enter{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}@keyframes jj-rebase-row-enter{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
.jj-context-backdrop{position:fixed;inset:0;z-index:40}.jj-context-menu{position:fixed;z-index:41;min-width:190px;padding:5px;border:1px solid var(--jj-line);border-radius:8px;background:var(--popover,var(--card));box-shadow:0 12px 36px #0008}.jj-context-menu button{width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}.jj-context-menu button:hover,.jj-context-menu button:focus-visible{background:var(--accent);outline:none}.jj-context-menu button:disabled{opacity:.45;cursor:default}.jj-context-menu-separator{height:1px;margin:4px 2px;background:var(--jj-line)}
.jj-path-picker{display:flex;min-width:0;flex:1}.jj-path-picker .jj-path{border-radius:6px 0 0 6px}.jj-path-picker .jj-browse{border-radius:0 6px 6px 0;white-space:nowrap}.jj-picker-backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:rgb(0 0 0/.58)}.jj-picker{display:flex;flex-direction:column;width:min(720px,92vw);max-height:min(760px,84vh);padding:12px;border:1px solid var(--jj-line);border-radius:14px;background:var(--card);box-shadow:0 18px 60px #000a}.jj-picker-header{display:flex;align-items:center;gap:8px}.jj-picker-path{min-width:0;flex:1}.jj-picker-path input{width:100%;box-sizing:border-box;border:0;background:transparent;color:var(--foreground);font:14px/1.4 var(--font-mono,monospace);outline:none}.jj-picker-section{padding:12px 4px 6px;color:var(--muted-foreground);font-size:11px}.jj-picker-list{min-height:120px;overflow:auto}.jj-picker-entry{display:flex;width:100%;align-items:center;gap:10px;padding:7px 9px;border:0;border-radius:6px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.jj-picker-entry[data-active=true],.jj-picker-entry:hover{background:var(--accent)}.jj-picker-entry:focus-visible{outline:2px solid var(--ring,var(--primary))}.jj-picker-entry-icon{width:18px;color:var(--muted-foreground)}.jj-picker-footer{display:flex;justify-content:center;gap:14px;padding:10px 4px 2px;border-top:1px solid var(--jj-line);color:var(--muted-foreground);font-size:11px}.jj-picker-footer kbd{padding:2px 5px;border:1px solid var(--jj-line);border-radius:4px;color:var(--foreground)}
.jj-picker{width:min(1000px,86vw);max-height:min(780px,84vh);padding:16px 10px 0;overflow:hidden}.jj-picker-header{padding:0 10px 12px;border-bottom:1px solid var(--jj-line)}.jj-picker-path input{height:44px;padding:0 8px;font:16px/1.4 var(--font-sans,system-ui)}.jj-picker-section{padding:16px 16px 8px;font-size:12px}.jj-picker-list{max-height:min(620px,65vh);min-height:160px;padding:0 7px 8px;overflow:auto}.jj-project-option{display:flex;width:100%;min-height:70px;align-items:center;gap:12px;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.jj-project-option[data-active=true],.jj-project-option:hover{background:var(--accent)}.jj-project-option:focus-visible{outline:2px solid var(--ring,var(--primary))}.jj-project-option kbd{margin-left:auto;color:var(--muted-foreground)}.jj-project-mark{display:grid;width:28px;height:28px;flex:none;place-items:center;border-radius:7px;background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary);font-size:10px;font-weight:700}.jj-project-option:nth-child(6n + 2) .jj-project-mark{background:#ff910022;color:#ff9100}.jj-project-option:nth-child(6n + 3) .jj-project-mark{background:#00bcd422;color:#00bcd4}.jj-project-option:nth-child(6n + 4) .jj-project-mark{background:#8b5cf622;color:#a78bfa}.jj-project-option:nth-child(6n + 5) .jj-project-mark{background:#10b98122;color:#10b981}.jj-project-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;font-size:15px}.jj-project-copy small{overflow:hidden;color:var(--muted-foreground);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.jj-picker-footer{justify-content:flex-start;gap:18px;padding:12px 16px;background:var(--background)}.jj-picker-entry{min-height:42px;padding:8px 12px;border-radius:8px}.jj-picker-error{padding:10px 16px;color:var(--destructive)}
.jj-context{flex-wrap:wrap}.jj-filter{width:180px;margin-left:auto;padding:4px 7px;font:11px var(--font-sans,system-ui)}.jj-push-marker{display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--jj-line);background:color-mix(in srgb,var(--muted) 10%,var(--background));color:var(--muted-foreground);font-size:10px}.jj-push-marker strong{font-weight:600;letter-spacing:.04em;text-transform:uppercase}.jj-push-marker time{margin-left:auto;font:10px var(--font-mono,monospace)}.jj-revision[data-moved=true]{opacity:.28;filter:saturate(.25)}.jj-revision[data-preview=true]{background:color-mix(in srgb,#a5df6f 10%,var(--background));box-shadow:inset 3px 0 #a5df6f}.jj-revision[data-preview=true] .jj-revision-subject,.jj-revision[data-preview=true] .jj-change-id{color:#a5df6f}.jj-revision[data-preview=true] .jj-badge{border-color:#a5df6f;color:#a5df6f}.jj-revision-title{gap:0}.jj-revision-meta{justify-content:flex-end;gap:8px}.jj-revision-age{color:var(--muted-foreground);font:10px var(--font-mono,monospace)}.jj-change-id{font:10px var(--font-mono,monospace);font-weight:650;letter-spacing:.02em}.jj-change-id-prefix{color:#4fc1ff}.jj-badge-evolved{background:color-mix(in srgb,#b982ff 18%,var(--background));border-color:color-mix(in srgb,#b982ff 55%,var(--jj-line));color:#b982ff}
.jj-revision-button{min-height:29px;padding-block:0}.jj-graph-cell,.jj-graph-cell svg{height:29px}.jj-revision-main{min-width:0;flex-direction:row;align-items:center;gap:7px}.jj-revision-title{flex:1;min-width:0}.jj-revision-subject{font-size:12px}.jj-labels{min-width:0;max-width:42%;min-height:0;max-height:17px;flex:none;flex-wrap:nowrap}.jj-revision-meta{gap:6px}.jj-change-id{min-width:2ch;text-align:right}.jj-revision[data-empty=true] .jj-revision-subject{color:var(--muted-foreground);font-style:italic}.jj-badge-empty{background:color-mix(in srgb,#8b8b8b 14%,var(--background));border-color:#777;color:#aaa;font-size:9px}.jj-rebase-preview-branch[hidden]{display:none}.jj-preview-toggle{padding:3px 6px;border:1px solid var(--jj-line);border-radius:5px;background:var(--background);color:var(--foreground);font:inherit;cursor:pointer}.jj-context-menu{max-height:min(80vh,520px);overflow-y:auto;overscroll-behavior:contain}.jj-push-marker{min-height:26px;padding:4px 10px;border-block:1px solid color-mix(in srgb,var(--muted-foreground) 28%,var(--jj-line));background:color-mix(in srgb,var(--muted) 13%,var(--background));box-shadow:inset 3px 0 color-mix(in srgb,var(--muted-foreground) 38%,transparent)}
.jj-day-heading{position:sticky;top:0;z-index:2;width:100%;height:23px;min-height:23px;display:grid;align-items:center;gap:4px;padding:0 8px 0 0;border:0;border-bottom:1px solid var(--jj-line);background:var(--background);color:var(--muted-foreground);font-size:10px;font-weight:700;letter-spacing:.07em;text-align:left;text-transform:uppercase;cursor:pointer}
.jj-day-heading:hover{background:var(--accent);color:var(--foreground)}
.jj-day-graph{position:relative;display:block;height:22px}
.jj-day-graph svg{position:absolute;inset:0}
.jj-day-heading-content{display:flex;min-width:0;align-items:center;gap:7px}
.jj-day-heading-content .jj-count{margin-left:auto}
.jj-day-heading .jj-chevron{transform:rotate(90deg)}
.jj-day-heading[aria-expanded=false] .jj-chevron{transform:rotate(0)}
.jj-revision-title{display:flex;flex:1;min-width:0;align-items:center;gap:4px;overflow:hidden;white-space:nowrap}
.jj-revision-title .jj-badge{flex:none;max-width:160px}
.jj-revision-subject{min-width:0;flex:1}
.jj-day-heading-content{width:100%}
.jj-revision-details{position:relative;padding:10px 12px 14px;border:1px solid color-mix(in srgb,var(--primary) 38%,var(--jj-line));border-top:0;border-radius:0 0 7px 7px;background:color-mix(in srgb,var(--card) 94%,var(--background));box-shadow:inset 3px 0 color-mix(in srgb,var(--primary) 65%,transparent)}
.jj-description-edit{min-height:96px;line-height:1.4}
.jj-section-heading-toggle{width:100%;border:0;border-radius:5px;background:transparent;text-align:left;cursor:pointer}
.jj-section-heading-toggle:hover,.jj-section-heading-toggle[aria-expanded=true]{background:var(--accent)}
.jj-file-stats{display:flex;gap:5px;margin-left:auto;color:var(--muted-foreground);font:10px var(--font-mono,monospace);white-space:nowrap}
.jj-file-additions{color:#4ec9b0}.jj-file-deletions{color:#f48771}
.jj-revision-details .jj-file-list{padding:3px 6px;border-left:2px solid color-mix(in srgb,var(--primary) 40%,var(--jj-line));margin-left:9px}
.jj-revision-details .jj-file-button{width:100%}
.jj-ancestor-files{margin:0 8px 8px 18px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--primary) 32%,var(--jj-line));border-left:3px solid color-mix(in srgb,var(--primary) 58%,var(--jj-line));border-radius:0 0 7px 7px;background:color-mix(in srgb,var(--card) 94%,var(--background));box-shadow:inset 0 1px color-mix(in srgb,var(--primary) 18%,transparent)}
.jj-rebase-preview-heading{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:5px 12px}
.jj-rebase-preview-title{grid-column:1/-1}
.jj-rebase-preview-meta{display:flex;align-items:center;justify-content:space-between;gap:10px}
.jj-rebase-preview-meta>span{color:var(--muted-foreground);font-size:11px;white-space:nowrap}
.jj-ancestor-ops .jj-description-edit{min-height:96px}
.jj-full-diff-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:24px;background:rgb(0 0 0 / 60%)}
.jj-full-diff{width:min(1200px,100%);height:min(900px,100%);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--jj-line);border-radius:9px;background:var(--background);box-shadow:0 18px 60px #0009}
.jj-full-diff-header{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--jj-line);font-weight:600}
.jj-full-diff-header span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jj-full-diff-body{min-height:0;flex:1;overflow:auto}.jj-full-diff-body>div{min-height:100%}
.jj-toolbar{display:flex;flex-direction:column;align-items:stretch;gap:8px}.jj-tabs{width:max-content;max-width:100%;margin:0}.jj-repository-controls{display:flex;min-width:0;align-items:center;gap:7px;flex-wrap:wrap}.jj-repository-controls .jj-host{flex:0 1 180px;width:auto}.jj-repository-controls .jj-path-picker{flex:1 1 180px}.jj-repository-controls .jj-path{width:100%;border-radius:6px}.jj-refresh{display:grid;width:34px;height:34px;flex:none;place-items:center;padding:0}.jj-revision-diff-file{border-bottom:1px solid var(--jj-line)}.jj-revision-diff-file h3{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;margin:0;padding:8px 12px;border-bottom:1px solid var(--jj-line);background:var(--card);font:600 12px var(--font-mono,monospace)}.jj-revision-diff-file h3 .jj-status{width:auto}.jj-revision-diff-renderer{padding:8px 10px}.jj-revision-diff-renderer>div{min-height:0}
.jj-toolbar{gap:5px;padding:6px 9px}.jj-tab{padding:6px 9px}.jj-repository-controls{gap:5px}.jj-repository-controls .jj-input{padding:5px 8px}.jj-refresh{width:30px;height:30px}.jj-picker{width:min(580px,calc(100vw - 32px));max-height:min(480px,72vh);padding:6px 6px 0;border-radius:10px}.jj-picker-header{padding:0 6px 4px;gap:4px}.jj-picker-path input{height:32px;font-size:13px}.jj-picker-section{padding:5px 8px 3px;font-size:10px}.jj-picker-list{max-height:min(360px,58vh);min-height:0;padding:0 3px 4px}.jj-project-option{min-height:36px;gap:7px;padding:4px 6px;border-radius:5px}.jj-project-mark{width:18px;height:18px;border-radius:4px;font-size:8px}.jj-project-copy{gap:0;font-size:12px}.jj-project-copy small{font-size:9px}.jj-picker-entry{min-height:29px;padding:3px 7px;border-radius:5px}.jj-picker-footer{gap:8px;padding:5px 8px;font-size:9px}.jj-picker-footer kbd{padding:1px 3px}
.jj-ancestor-files-heading{display:flex;align-items:center;gap:6px}.jj-ancestor-files-heading .jj-section-heading-toggle{flex:1;min-width:0}.jj-ancestor-full-diff{flex:none;padding:4px 7px;font-size:10px}
`;

const RevisionGraphCell = ({
  row,
  width,
  laneGap,
  current,
  preview,
  empty,
  evolved,
}: {
  row: RevisionGraphRow;
  width: number;
  laneGap: number;
  current: boolean;
  preview: boolean;
  empty: boolean;
  evolved: boolean;
}) => {
  const center = (lane: number) => 10 + lane * laneGap;
  const middle = 21;
  const nodeColor = preview
    ? previewColor
    : current
      ? "var(--primary)"
      : evolved
        ? "var(--jj-evolved)"
        : laneColor(row.commitLane);
  const fill = preview ? previewColor : current ? "var(--primary)" : "var(--background)";

  return (
    <span className="jj-graph-cell" style={{ width }} aria-hidden="true">
      <svg width={width} height="42" viewBox={`0 0 ${width} 42`}>
        {row.edges.map((edge, index) =>
          edge.kind === "straight" ? (
            <line
              key={`edge-${index}`}
              x1={center(edge.fromLane)}
              y1={middle}
              x2={center(edge.toLane)}
              y2="42"
              stroke={preview ? previewColor : laneColor(edge.fromLane)}
              strokeWidth="1.5"
            />
          ) : (
            <path
              key={`edge-${index}`}
              d={`M ${center(edge.fromLane)} ${middle} C ${center(edge.fromLane)} ${middle + 8}, ${center(edge.toLane)} ${middle + 8}, ${center(edge.toLane)} 42`}
              fill="none"
              stroke={preview ? previewColor : laneColor(edge.fromLane)}
              strokeWidth="1.5"
            />
          ),
        )}
        {row.topLanes.map((lane) => (
          <line
            key={`top-${lane}`}
            x1={center(lane)}
            y1="0"
            x2={center(lane)}
            y2={middle}
            stroke={preview ? previewColor : laneColor(lane)}
            strokeWidth="1.5"
          />
        ))}
        {!row.startsHere && (
          <line
            x1={center(row.commitLane)}
            y1="0"
            x2={center(row.commitLane)}
            y2={middle}
            stroke={preview ? previewColor : laneColor(row.commitLane)}
            strokeWidth="1.5"
          />
        )}
        {row.bottomLanes.map((lane) => (
          <line
            key={`bottom-${lane}`}
            x1={center(lane)}
            y1={middle}
            x2={center(lane)}
            y2="42"
            stroke={preview ? previewColor : laneColor(lane)}
            strokeWidth="1.5"
          />
        ))}
        {empty ? (
          <rect
            x={center(row.commitLane) - 4.5}
            y={middle - 4.5}
            width="9"
            height="9"
            transform={`rotate(45 ${center(row.commitLane)} ${middle})`}
            fill={fill}
            stroke={nodeColor}
            strokeWidth="2"
            strokeDasharray="2 1"
          />
        ) : (
          <circle
            cx={center(row.commitLane)}
            cy={middle}
            r="5"
            fill={fill}
            stroke={nodeColor}
            strokeWidth="2"
          />
        )}
      </svg>
    </span>
  );
};

const DiffPreview = ({
  path,
  patch,
  loading,
  error,
}: {
  path: string | null;
  patch: string | null;
  loading: boolean;
  error: string | null;
}) => {
  if (!path) return <div className="jj-diff-empty">Select a changed file to preview its diff.</div>;
  if (loading)
    return (
      <div className="jj-diff-empty" role="status">
        Loading diff…
      </div>
    );
  if (error)
    return (
      <div className="jj-error-inline" role="alert">
        {error}
      </div>
    );
  if (!patch) return <div className="jj-diff-empty">No textual diff for this file.</div>;
  return <BbDiff patch={patch} path={path} overflow="scroll" />;
};

const FilePath = ({ path }: { path: string }) => {
  const parts = path.split("/");
  const fileName = parts.pop() ?? path;
  const directory = parts.join("/");
  return (
    <span className="jj-file-path" title={path}>
      {directory && <span className="jj-file-directory">{directory}/</span>}
      <span className="jj-file-name">{fileName}</span>
    </span>
  );
};

const statusClass = (status: string) => {
  if (status === "A" || status === "?" || status.toLowerCase().includes("added"))
    return "jj-status-added";
  if (status === "D" || status.toLowerCase().includes("deleted")) return "jj-status-deleted";
  if (status === "R" || status.toLowerCase().includes("renamed")) return "jj-status-renamed";
  return "";
};

const ThreadHeaderAction = () => {
  const navigation = useBbNavigate();
  return (
    <button
      type="button"
      className="jj-button"
      aria-label="Open Jujutsu workbench"
      onClick={() => navigation.openThreadPanel({ actionId: "thread-workbench", title: "Jujutsu" })}
    >
      JJ
    </button>
  );
};

const Page = ({ threadId: panelThreadId }: { threadId?: string } = {}) => {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const context = useBbContext();
  const [tab, setTab] = useState<"graph" | "source">("graph");
  const [graphQuery, setGraphQuery] = useState("");
  const [path, setPath] = useState(() => localStorage.getItem("jj-plugin-path") ?? "");
  const [hostId, setHostId] = useState(() => localStorage.getItem("jj-plugin-host") ?? "");
  const [hosts, setHosts] = useState<{ id: string; name: string; status: string }[]>([]);
  const [projectPaths, setProjectPaths] = useState<ProjectPath[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<Revision | null>(null);
  const [revisionFiles, setRevisionFiles] = useState<FileChange[]>([]);
  const [revisionFileStats, setRevisionFileStats] = useState<FileStat[]>([]);
  const [revisionFilesLoading, setRevisionFilesLoading] = useState(false);
  const [revisionFileStatsLoading, setRevisionFileStatsLoading] = useState(false);
  const [revisionFilesError, setRevisionFilesError] = useState<string | null>(null);
  const [loadedRevisionFilesFor, setLoadedRevisionFilesFor] = useState<string | null>(null);
  const [filesExpandedRevisionId, setFilesExpandedRevisionId] = useState<string | null>(null);
  const revisionDiffRequest = useRef(0);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [revisionDiffView, setRevisionDiffView] = useState<{
    revision: Revision;
    files: RevisionDiffFile[];
  } | null>(null);
  const [revisionDiffLoading, setRevisionDiffLoading] = useState(false);
  const [revisionDiffError, setRevisionDiffError] = useState<string | null>(null);
  const [diffPatch, setDiffPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [fullDiffOpen, setFullDiffOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [workingDescription, setWorkingDescription] = useState("");
  const [editingWorkingDescription, setEditingWorkingDescription] = useState(false);
  const [splitMessage, setSplitMessage] = useState("Split selected files from @");
  const [recentDepth, setRecentDepth] = useState(() =>
    Number(localStorage.getItem("jj-plugin-recent") ?? 10),
  );
  const [selectedWorkingFiles, setSelectedWorkingFiles] = useState<string[]>([]);
  const [selectedRevisionFiles, setSelectedRevisionFiles] = useState<string[]>([]);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [changesPanePercent, setChangesPanePercent] = useState(() => {
    const savedPercent = Number(localStorage.getItem("jj-plugin-source-split") ?? 55);
    return Number.isFinite(savedPercent) ? Math.min(80, Math.max(20, savedPercent)) : 55;
  });
  const sourceListRef = useRef<HTMLDivElement>(null);
  const [expandedSourceRevisionId, setExpandedSourceRevisionId] = useState<string | null>(null);
  const [pendingRebase, setPendingRebase] = useState<PendingRebase | null>(null);
  const [rebasePreviewExpanded, setRebasePreviewExpanded] = useState(false);
  const [pendingAbandon, setPendingAbandon] = useState<Revision | null>(null);
  const [draggedRevisionId, setDraggedRevisionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [revisionContextMenu, setRevisionContextMenu] = useState<RevisionContextMenu | null>(null);
  const [moveSource, setMoveSource] = useState<Revision | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  const [directoryBrowser, setDirectoryBrowser] = useState<DirectoryResult | null>(null);
  const [directoryIndex, setDirectoryIndex] = useState(0);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectIndex, setProjectIndex] = useState(0);
  const directoryRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inspectAt = useCallback(
    async (targetPath: string, targetHostId: string) => {
      if (!targetPath.trim() || !targetHostId.trim()) return;
      setBusy(true);
      try {
        const normalizedPath = targetPath.trim();
        const normalizedHostId = targetHostId.trim();
        const result = await rpc.call("inspect", {
          path: normalizedPath,
          hostId: normalizedHostId,
        });
        setSnapshot(result);
        revisionDiffRequest.current += 1;
        setPendingRebase(null);
        setMoveSource(null);
        setRevisionContextMenu(null);
        setSelectedRevision(null);
        setRevisionFiles([]);
        setDiffTarget(null);
        setSelectedWorkingFiles([]);
        setSelectedRevisionFiles([]);
        setError(null);
        localStorage.setItem("jj-plugin-path", normalizedPath);
        localStorage.setItem("jj-plugin-host", normalizedHostId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [rpc],
  );
  const refresh = useCallback(() => inspectAt(path, hostId), [hostId, inspectAt, path]);

  useEffect(() => {
    const savedPath = localStorage.getItem("jj-plugin-path") ?? "";
    const savedHostId = localStorage.getItem("jj-plugin-host") ?? "";
    if (savedPath && savedHostId) void inspectAt(savedPath, savedHostId);
  }, [inspectAt]);

  useEffect(() => {
    let active = true;
    sdk.hosts
      .list()
      .then((availableHosts) => {
        if (!active) return;
        const nextHosts = availableHosts.map((host) => ({
          id: host.id,
          name: host.name,
          status: host.status,
        }));
        setHosts(nextHosts);
        const connectedHosts = nextHosts.filter((host) => host.status === "connected");
        if (connectedHosts.length === 1) {
          const onlyHost = connectedHosts[0];
          setHostId(onlyHost.id);
          const savedPath = localStorage.getItem("jj-plugin-path") ?? "";
          const savedHostId = localStorage.getItem("jj-plugin-host") ?? "";
          if (savedPath && savedHostId !== onlyHost.id) void inspectAt(savedPath, onlyHost.id);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    sdk.projects
      .list({ includePersonal: true })
      .then((projects) => {
        if (!active) return;
        setProjectPaths(
          projects.flatMap((project) =>
            project.sources.map((source) => ({
              name: project.name,
              path: source.path,
              hostId: source.hostId,
            })),
          ),
        );
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [inspectAt, sdk]);

  useEffect(() => {
    let active = true;
    const resolveEnvironment = async () => {
      const selectedThreadId = panelThreadId ?? context.threadId;
      if (selectedThreadId) {
        const thread = await sdk.threads.get({ threadId: selectedThreadId });
        if (!thread.environmentId) return;
        const environment = await sdk.environments.get({ environmentId: thread.environmentId });
        if (!active || !environment.path) return;
        setPath(environment.path);
        setHostId(environment.hostId);
        void inspectAt(environment.path, environment.hostId);
        return;
      }
      if (!context.projectId) return;
      const environments = await sdk.environments.list({
        projectId: context.projectId,
        status: "ready",
      });
      const environment = environments.find((candidate) => candidate.path !== null);
      if (!active || !environment?.path) return;
      setPath(environment.path);
      setHostId(environment.hostId);
      void inspectAt(environment.path, environment.hostId);
    };
    resolveEnvironment().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [context.projectId, context.threadId, inspectAt, panelThreadId, sdk]);

  const availableProjectPaths = useMemo(
    () =>
      projectPaths
        .filter((projectPath) => !hostId || projectPath.hostId === hostId)
        .filter(
          (projectPath, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.path === projectPath.path && candidate.name === projectPath.name,
            ) === index,
        ),
    [hostId, projectPaths],
  );
  const changePath = (nextPath: string) => {
    setPath(nextPath);
    const matchingProjects = projectPaths.filter((projectPath) => projectPath.path === nextPath);
    if (!hostId && matchingProjects.length === 1) setHostId(matchingProjects[0].hostId);
  };

  const filteredProjectPaths = useMemo(() => {
    const query = projectQuery.trim().toLocaleLowerCase();
    return availableProjectPaths.filter(
      (projectPath) =>
        !query || `${projectPath.name} ${projectPath.path}`.toLocaleLowerCase().includes(query),
    );
  }, [availableProjectPaths, projectQuery]);
  const isDirectoryQuery = projectQuery.startsWith("/");

  const browseDirectory = async (nextPath?: string) => {
    if (!hostId) return;
    const requestId = ++directoryRequest.current;
    try {
      const result = await sdk.hosts.directory({ hostId, ...(nextPath ? { path: nextPath } : {}) });
      if (requestId !== directoryRequest.current) return;
      setDirectoryBrowser(result);
      setProjectQuery(result.directory);
      setDirectoryIndex(0);
      setError(null);
    } catch (cause) {
      if (requestId !== directoryRequest.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseDirectory = () => {
    const selectedPath = projectQuery.trim();
    if (!selectedPath) return;
    directoryRequest.current += 1;
    changePath(selectedPath);
    setDirectoryBrowser(null);
    setProjectPickerOpen(false);
    void inspectAt(selectedPath, hostId);
  };

  const chooseProjectPath = (projectPath: ProjectPath) => {
    directoryRequest.current += 1;
    setHostId(projectPath.hostId);
    setPath(projectPath.path);
    setProjectPickerOpen(false);
    setDirectoryBrowser(null);
    void inspectAt(projectPath.path, projectPath.hostId);
  };

  const openProjectPicker = () => {
    directoryRequest.current += 1;
    setProjectQuery("");
    setProjectIndex(0);
    setDirectoryIndex(0);
    setDirectoryBrowser(null);
    setProjectPickerOpen(true);
  };

  const directoryEntries =
    directoryBrowser?.entries.filter((entry) => entry.kind === "directory") ?? [];
  const handleDirectoryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDirectoryQuery && event.metaKey && /^[1-9]$/.test(event.key)) {
      const projectPath = filteredProjectPaths[Number(event.key) - 1];
      if (projectPath) chooseProjectPath(projectPath);
      return;
    }
    if (!isDirectoryQuery && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setProjectIndex((current) =>
        Math.max(
          0,
          event.key === "ArrowDown"
            ? Math.min(current + 1, filteredProjectPaths.length - 1)
            : current - 1,
        ),
      );
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setDirectoryIndex((current) =>
        event.key === "ArrowDown"
          ? Math.max(0, Math.min(current + 1, directoryEntries.length - 1))
          : Math.max(current - 1, 0),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        chooseDirectory();
        return;
      }
      if (!isDirectoryQuery) {
        const projectPath = filteredProjectPaths[projectIndex];
        if (projectPath) chooseProjectPath(projectPath);
        return;
      }
      const directory = directoryEntries[directoryIndex];
      if (directory) void browseDirectory(directory.path);
      else if (projectQuery.trim()) void browseDirectory(projectQuery.trim());
      return;
    }
    if (
      isDirectoryQuery &&
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === 0 &&
      directoryBrowser?.parent
    ) {
      event.preventDefault();
      setProjectQuery(directoryBrowser.parent);
    }
    if (event.key === "Escape") {
      directoryRequest.current += 1;
      setProjectPickerOpen(false);
      setDirectoryBrowser(null);
    }
  };

  useEffect(() => {
    if (projectPickerOpen && isDirectoryQuery) {
      const timeout = window.setTimeout(() => void browseDirectory(projectQuery), 250);
      return () => window.clearTimeout(timeout);
    }
  }, [projectPickerOpen, isDirectoryQuery, projectQuery, hostId]);

  useEffect(() => {
    document
      .getElementById(
        `${isDirectoryQuery ? "jj-picker-entry" : "jj-project-option"}-${isDirectoryQuery ? directoryIndex : projectIndex}`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [directoryBrowser, directoryIndex, isDirectoryQuery, projectIndex]);

  useEffect(() => {
    if (!snapshot) return;
    const workingRevision = snapshot.revisions.find(
      (revision) => revision.commitId === snapshot.currentRevision,
    );
    setWorkingDescription(workingRevision?.description ?? "");
  }, [snapshot]);

  useEffect(() => {
    const shouldLoadSourceFiles =
      tab === "source" && expandedSourceRevisionId === selectedRevision?.commitId;
    if (
      !selectedRevision ||
      (filesExpandedRevisionId !== selectedRevision.commitId && !shouldLoadSourceFiles) ||
      !snapshot ||
      !path ||
      !hostId
    ) {
      if (!selectedRevision || loadedRevisionFilesFor !== selectedRevision.commitId) {
        setRevisionFiles([]);
        setRevisionFileStats([]);
        setRevisionFilesError(null);
      }
      setRevisionFilesLoading(false);
      setRevisionFileStatsLoading(false);
      return;
    }
    if (loadedRevisionFilesFor === selectedRevision.commitId) return;
    let active = true;
    setRevisionFiles([]);
    setRevisionFileStats([]);
    setSelectedRevisionFiles([]);
    setRevisionFilesLoading(true);
    setRevisionFileStatsLoading(true);
    setRevisionFilesError(null);
    const input = { path, hostId, revision: selectedRevision.commitId };
    let filesLoaded = false;
    void Promise.allSettled([
      rpc.call("revisionFiles", input),
      rpc.call("revisionFileStats", input),
    ])
      .then(([filesResult, statsResult]) => {
        if (!active) return;
        if (filesResult.status === "fulfilled") {
          setRevisionFiles(filesResult.value);
          filesLoaded = true;
        }
        if (filesResult.status === "rejected") {
          setRevisionFilesError(
            filesResult.reason instanceof Error
              ? filesResult.reason.message
              : String(filesResult.reason),
          );
        }
        if (statsResult.status === "fulfilled") setRevisionFileStats(statsResult.value);
      })
      .catch((cause) => {
        if (active) setRevisionFilesError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) {
          if (filesLoaded) setLoadedRevisionFilesFor(selectedRevision.commitId);
          setRevisionFilesLoading(false);
          setRevisionFileStatsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    expandedSourceRevisionId,
    filesExpandedRevisionId,
    hostId,
    loadedRevisionFilesFor,
    path,
    rpc,
    selectedRevision?.commitId,
    snapshot,
    tab,
  ]);

  useEffect(() => {
    if (!diffTarget || !path || !hostId) {
      setDiffPatch(null);
      setDiffLoading(false);
      setDiffError(null);
      return;
    }
    let active = true;
    setDiffPatch(null);
    setDiffLoading(true);
    setDiffError(null);
    const input = {
      path,
      hostId,
      file: diffTarget.path,
      ...(diffTarget.revision ? { revision: diffTarget.revision } : {}),
    };
    void rpc
      .call("fileDiff", input)
      .then((result) => {
        if (active) setDiffPatch(result.patch);
      })
      .catch((cause) => {
        if (active) setDiffError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [diffTarget?.path, diffTarget?.revision, hostId, path, rpc]);

  const revisions = snapshot?.revisions ?? [];
  const evolvedChangeIds = useMemo(() => {
    const newestByChangeId = new Map<string, number>();
    revisions.forEach((revision) =>
      newestByChangeId.set(
        revision.changeId,
        Math.max(newestByChangeId.get(revision.changeId) ?? 0, revision.timestamp),
      ),
    );
    return new Set(
      revisions
        .filter(
          (revision) =>
            revision.timestamp < (newestByChangeId.get(revision.changeId) ?? revision.timestamp),
        )
        .map((revision) => revision.commitId),
    );
  }, [revisions]);
  const graphItems = useMemo(() => {
    const originalItems: GraphItem[] = revisions.map((revision) => ({
      revision,
      isPreview: false,
    }));
    if (!pendingRebase) return originalItems;
    const branchIds = new Set(pendingRebase.branch.map((revision) => revision.commitId));
    const projectedItems: GraphItem[] = pendingRebase.branch.map((revision) => ({
      isPreview: true,
      originalId: revision.commitId,
      revision: {
        ...revision,
        commitId: `${revision.commitId}:preview`,
        timestamp: pendingRebase.destination.timestamp,
        parents:
          revision.commitId === pendingRebase.source.commitId
            ? [pendingRebase.destination.commitId]
            : revision.parents.map((parentId) =>
                branchIds.has(parentId) ? `${parentId}:preview` : parentId,
              ),
      },
    }));
    const result: GraphItem[] = [];
    revisions.forEach((revision) => {
      if (revision.commitId === pendingRebase.destination.commitId) result.push(...projectedItems);
      result.push({ revision, isPreview: false });
    });
    return result;
  }, [pendingRebase, revisions]);
  const graphRows = useMemo(
    () => layoutRevisionGraph(graphItems.map((item) => item.revision)),
    [graphItems],
  );
  const graphGroups = useMemo(() => {
    const groups: {
      day: string;
      rows: { revision: Revision; row: RevisionGraphRow; index: number; isPreview: boolean }[];
    }[] = [];
    graphItems.forEach(({ revision, isPreview }, index) => {
      const row = graphRows[index];
      if (!row) return;
      const day = revisionDay(revision.timestamp);
      let group = groups[groups.length - 1];
      if (!group || group.day !== day) {
        group = { day, rows: [] };
        groups.push(group);
      }
      group.rows.push({ revision, row, index, isPreview });
    });
    const dayCounts = new Map<string, number>();
    groups.forEach((group) =>
      dayCounts.set(group.day, (dayCounts.get(group.day) ?? 0) + group.rows.length),
    );
    const seenDays = new Set<string>();
    return groups.map((group) => {
      const firstRow = group.rows[0];
      const showHeading = !seenDays.has(group.day);
      seenDays.add(group.day);
      return {
        ...group,
        activeLanes: [
          ...firstRow.row.topLanes,
          ...(firstRow.row.startsHere ? [] : [firstRow.row.commitLane]),
        ].sort((left, right) => left - right),
        dayCount: dayCounts.get(group.day) ?? group.rows.length,
        showHeading,
      };
    });
  }, [graphItems, graphRows]);
  const revisionById = useMemo(
    () => new Map(revisions.map((revision) => [revision.commitId, revision])),
    [revisions],
  );
  const maximumLaneCount = graphRows.reduce((maximum, row) => Math.max(maximum, row.laneCount), 1);
  const graphWidth = Math.min(92, 20 + (maximumLaneCount - 1) * 12);
  const laneGap = maximumLaneCount <= 1 ? 0 : (graphWidth - 20) / (maximumLaneCount - 1);
  const recentRevisions = useMemo(() => {
    if (!snapshot) return [];
    const revisionsById = new Map(revisions.map((revision) => [revision.commitId, revision]));
    const recent: Revision[] = [];
    let current = snapshot.currentRevision;
    while (recent.length <= Math.max(1, recentDepth)) {
      const revision = revisionsById.get(current);
      if (!revision) break;
      recent.push(revision);
      current = revision.parents[0] ?? "";
    }
    return recent;
  }, [recentDepth, revisions, snapshot]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selectRevision = (revision: Revision) => {
    revisionDiffRequest.current += 1;
    setSelectedRevision((current) => (current?.commitId === revision.commitId ? null : revision));
    setDescription(revision.description);
    setFilesExpandedRevisionId(null);
    setLoadedRevisionFilesFor(null);
    setDiffTarget(null);
    setFullDiffOpen(false);
  };
  const showRevisionDiff = async (revision: Revision) => {
    setSelectedRevision(revision);
    setDescription(revision.description);
    setDiffTarget(null);
    setRevisionDiffView({ revision, files: [] });
    setRevisionDiffLoading(true);
    setRevisionDiffError(null);
    setFullDiffOpen(true);
    const requestId = ++revisionDiffRequest.current;
    try {
      const files = await rpc.call("revisionFiles", { path, hostId, revision: revision.commitId });
      const diffs = await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          status: file.status,
          ...(await rpc.call("fileDiff", {
            path,
            hostId,
            file: file.path,
            revision: revision.commitId,
          })),
        })),
      );
      if (requestId === revisionDiffRequest.current)
        setRevisionDiffView({ revision, files: diffs });
    } catch (cause) {
      if (requestId === revisionDiffRequest.current) {
        setRevisionDiffError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestId === revisionDiffRequest.current) setRevisionDiffLoading(false);
    }
  };
  const toggleSourceRevision = (revision: Revision) => {
    revisionDiffRequest.current += 1;
    const isExpanded = expandedSourceRevisionId === revision.commitId;
    setExpandedSourceRevisionId(isExpanded ? null : revision.commitId);
    setSelectedRevision(isExpanded ? null : revision);
    setDescription(revision.description);
    setFilesExpandedRevisionId(null);
    setSelectedRevisionFiles([]);
    setDiffTarget(null);
    setLoadedRevisionFilesFor(null);
  };
  const selectFileDiff = (filePath: string, revisionId: string | null) => {
    setDiffTarget({ path: filePath, revision: revisionId });
  };
  const openFullDiff = (filePath: string, revisionId: string | null) => {
    revisionDiffRequest.current += 1;
    setRevisionDiffView(null);
    setDiffTarget({ path: filePath, revision: revisionId });
    setFullDiffOpen(true);
  };
  const changeSourcePanePercent = (nextPercent: number) => {
    const percent = Math.round(Math.min(80, Math.max(20, nextPercent)));
    setChangesPanePercent(percent);
    localStorage.setItem("jj-plugin-source-split", String(percent));
  };
  const resizeSourcePane = (clientY: number) => {
    const bounds = sourceListRef.current?.getBoundingClientRect();
    if (!bounds || bounds.height === 0) return;
    changeSourcePanePercent(((clientY - bounds.top) / bounds.height) * 100);
  };
  const saveRevisionDescription = async (revision: Revision) => {
    const didSave = await runAction(() =>
      rpc.call("describe", {
        path,
        hostId,
        revision: revision.commitId,
        description,
      }),
    );
    if (didSave) setSelectedRevision({ ...revision, description });
  };
  const dropOnRevision = (destination: Revision, event: React.DragEvent) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/jj-revision");
    const source = revisionById.get(sourceId);
    if (source && source.commitId !== destination.commitId) beginRebasePreview(source, destination);
    setDropTargetId(null);
  };
  const branchFrom = (sourceId: string) =>
    revisions.filter((candidate) => {
      const pending = [...candidate.parents];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const revisionId = pending.pop();
        if (!revisionId || visited.has(revisionId)) continue;
        if (revisionId === sourceId) return true;
        visited.add(revisionId);
        pending.push(...(revisionById.get(revisionId)?.parents ?? []));
      }
      return candidate.commitId === sourceId;
    });
  const draggedBranchIds = new Set(
    draggedRevisionId ? branchFrom(draggedRevisionId).map((revision) => revision.commitId) : [],
  );
  const beginRebasePreview = (source: Revision, destination: Revision) => {
    const branch = branchFrom(source.commitId);
    if (branch.some((revision) => revision.commitId === destination.commitId)) {
      setError("A branch cannot be rebased onto one of its own revisions.");
      setMoveSource(null);
      return;
    }
    setPendingRebase({ source, destination, branch });
    setRebasePreviewExpanded(false);
    setDraggedRevisionId(null);
    setDropTargetId(null);
    setMoveSource(null);
    setRevisionContextMenu(null);
    setSelectedRevision(null);
  };
  const cancelRebasePreview = () => {
    setPendingRebase(null);
    setRebasePreviewExpanded(false);
    setDraggedRevisionId(null);
    setDropTargetId(null);
  };
  const handleRevisionClick = (revision: Revision) => {
    if (moveSource) {
      beginRebasePreview(moveSource, revision);
      return;
    }
    selectRevision(revision);
  };
  const openRevisionContextMenu = (revision: Revision, x: number, y: number) => {
    setRevisionContextMenu({ x, y, revision });
  };
  const confirmRebase = async () => {
    if (!pendingRebase) return;
    const didRebase = await runAction(() =>
      rpc.call("rebase", {
        path,
        hostId,
        revision: pendingRebase.source.commitId,
        destination: pendingRebase.destination.commitId,
      }),
    );
    if (didRebase) setPendingRebase(null);
  };

  const renderRevisionDetails = (revision: Revision) => (
    <section
      className="jj-revision-details"
      aria-label={`Details for ${label(revision)}`}
      style={{ marginLeft: graphWidth }}
    >
      <div className="jj-detail-toolbar">
        <textarea
          className="jj-input jj-description-edit"
          aria-label="Revision description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="jj-detail-actions-row">
          <button
            className="jj-button"
            disabled={busy || description === revision.description}
            onClick={() => void saveRevisionDescription(revision)}
          >
            Describe
          </button>
          {revision.commitId !== snapshot?.currentRevision && (
            <button
              className="jj-button"
              disabled={busy}
              onClick={() =>
                void runAction(() =>
                  rpc.call("edit", { path, hostId, revision: revision.commitId }),
                )
              }
            >
              Edit This Change
            </button>
          )}
          <button
            className="jj-button jj-button-squash"
            disabled={busy || revision.parents.length === 0}
            onClick={() =>
              void runAction(() =>
                rpc.call("squash", {
                  path,
                  hostId,
                  revision: revision.commitId,
                  destination: revision.parents[0] ?? "@-",
                }),
              )
            }
          >
            Squash into parent
          </button>
        </div>
      </div>
      <button
        className="jj-section-heading jj-section-heading-toggle"
        aria-expanded={filesExpandedRevisionId === revision.commitId}
        onClick={() =>
          setFilesExpandedRevisionId((current) =>
            current === revision.commitId ? null : revision.commitId,
          )
        }
      >
        <span className="jj-chevron">›</span>
        Changed files{" "}
        {filesExpandedRevisionId === revision.commitId && (
          <span className="jj-count">{revisionFilesLoading ? "…" : revisionFiles.length}</span>
        )}
      </button>
      {filesExpandedRevisionId === revision.commitId && revisionFilesError && (
        <div className="jj-error-inline" role="alert">
          {revisionFilesError}
        </div>
      )}
      {filesExpandedRevisionId === revision.commitId && revisionFilesLoading && (
        <div className="jj-selection-hint" role="status">
          Loading changed files…
        </div>
      )}
      {filesExpandedRevisionId === revision.commitId &&
        !revisionFilesLoading &&
        revisionFiles.length === 0 && (
          <div className="jj-selection-hint">No file changes in this revision.</div>
        )}
      {filesExpandedRevisionId === revision.commitId && (
        <div className="jj-file-list">
          {revisionFiles.map((file) => {
            const stats = revisionFileStats.find((entry) => entry.path === file.path);
            return (
              <div key={file.path}>
                <button
                  className="jj-file-button"
                  onClick={() => openFullDiff(file.path, revision.commitId)}
                >
                  <span className={`jj-status ${statusClass(file.status)}`}>{file.status}</span>
                  <FilePath path={file.path} />
                  <span className="jj-file-stats">
                    {revisionFileStatsLoading && <span>…</span>}
                    {!revisionFileStatsLoading && stats && (
                      <>
                        <span className="jj-file-additions">+{stats.additions}</span>
                        <span className="jj-file-deletions">−{stats.deletions}</span>
                      </>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="jj-page">
      <style>{styles}</style>
      <header className="jj-toolbar">
        <nav className="jj-tabs" aria-label="Jujutsu views">
          <button
            className="jj-tab"
            aria-selected={tab === "graph"}
            onClick={() => setTab("graph")}
          >
            Revision graph
          </button>
          <button
            className="jj-tab"
            aria-selected={tab === "source"}
            onClick={() => setTab("source")}
          >
            Source Control
          </button>
        </nav>
        <div className="jj-repository-controls">
          {hosts.length > 1 && (
            <select
              className="jj-input jj-host"
              aria-label="BB machine"
              value={hostId}
              onChange={(event) => setHostId(event.target.value)}
            >
              <option value="">Select machine</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id} disabled={host.status !== "connected"}>
                  {host.name}
                  {host.status === "connected" ? "" : " (disconnected)"}
                </option>
              ))}
            </select>
          )}
          <div className="jj-path-picker">
            <input
              className="jj-input jj-path"
              aria-label="Project path"
              placeholder="Choose a project folder…"
              value={path}
              readOnly
              aria-haspopup="dialog"
              onClick={openProjectPicker}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openProjectPicker();
              }}
            />
          </div>
          <button
            className="jj-button jj-refresh"
            aria-label={busy ? "Refreshing repository" : "Refresh repository"}
            title={busy ? "Refreshing repository" : "Refresh repository"}
            disabled={busy || !path || !hostId}
            onClick={() => void refresh()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
              <path
                d="M13.2 6A5.3 5.3 0 0 0 3.6 4.1L2.2 5.5M2.2 5.5V2.7m0 2.8H5M2.8 10a5.3 5.3 0 0 0 9.6 1.9l1.4-1.4m0 0v2.8m0-2.8H11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="jj-error">
          {error}
        </div>
      )}
      {!snapshot ? (
        <div className="jj-empty">
          Choose a BB project path or paste a path inside a Jujutsu workspace.
        </div>
      ) : (
        <>
          <div className="jj-context">
            <span className="jj-context-path" title={snapshot.root}>
              {snapshot.root}
            </span>
            <span>·</span>
            <span>{snapshot.revisions.length} revisions</span>
            <span>·</span>
            <span>{snapshot.workspaces.length} workspaces</span>
            <input
              className="jj-input jj-filter"
              aria-label="Filter revisions by description"
              placeholder="Filter descriptions…"
              value={graphQuery}
              onChange={(event) => setGraphQuery(event.target.value)}
            />
          </div>
          {tab === "graph" ? (
            <main className="jj-history" aria-label="Jujutsu revision graph">
              {moveSource && (
                <div className="jj-move-mode" role="status">
                  <span>
                    Choose where to move the branch from <strong>{label(moveSource)}</strong>.
                  </span>
                  <button className="jj-button" onClick={() => setMoveSource(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {graphGroups
                .filter((group) =>
                  group.rows.some(
                    ({ revision }) =>
                      !graphQuery.trim() ||
                      label(revision).toLowerCase().includes(graphQuery.trim().toLowerCase()),
                  ),
                )
                .map((group) => (
                  <section
                    className="jj-day-group"
                    key={`${group.day}:${group.rows[0]?.revision.commitId ?? "empty"}`}
                  >
                    {group.showHeading && (
                      <button
                        className="jj-day-heading"
                        style={{ gridTemplateColumns: `${graphWidth}px minmax(0,1fr)` }}
                        aria-expanded={!collapsedDays.has(group.day)}
                        onClick={() =>
                          setCollapsedDays((current) => {
                            const next = new Set(current);
                            if (next.has(group.day)) next.delete(group.day);
                            else next.add(group.day);
                            return next;
                          })
                        }
                      >
                        <span className="jj-day-graph" aria-hidden="true">
                          <svg width={graphWidth} height="22" viewBox={`0 0 ${graphWidth} 22`}>
                            {group.activeLanes.map((lane) => (
                              <line
                                key={lane}
                                x1={10 + lane * laneGap}
                                y1="0"
                                x2={10 + lane * laneGap}
                                y2="22"
                                stroke={laneColor(lane)}
                                strokeWidth="1.5"
                              />
                            ))}
                          </svg>
                        </span>
                        <span
                          className="jj-day-heading-content"
                          style={{ paddingLeft: (group.rows[0]?.row.commitLane ?? 0) * laneGap }}
                        >
                          <span>{group.day}</span>
                          <span className="jj-chevron">›</span>
                          <span className="jj-count">{group.dayCount}</span>
                        </span>
                      </button>
                    )}
                    {!collapsedDays.has(group.day) &&
                      group.rows
                        .filter(
                          ({ revision }) =>
                            !graphQuery.trim() ||
                            label(revision).toLowerCase().includes(graphQuery.trim().toLowerCase()),
                        )
                        .map(({ revision, row: graphRow, isPreview }) => {
                          const isCurrent = revision.commitId === snapshot.currentRevision;
                          const isSelected = selectedRevision?.commitId === revision.commitId;
                          const isDragged =
                            draggedBranchIds.has(revision.commitId) ||
                            Boolean(
                              pendingRebase?.branch.some(
                                (branchRevision) => branchRevision.commitId === revision.commitId,
                              ),
                            );
                          const pendingHere =
                            pendingRebase?.destination.commitId === revision.commitId;
                          const changePrefix = revision.changeIdPrefix;
                          const isEvolved = !isPreview && evolvedChangeIds.has(revision.commitId);
                          return (
                            <Fragment key={revision.commitId}>
                              {!isPreview && revision.commitId === snapshot.lastPushRevision && (
                                <div className="jj-push-marker" role="separator">
                                  <strong>Last recorded push</strong>
                                  <span>to a jj Git remote</span>
                                  {snapshot.lastPushAt !== null && (
                                    <time
                                      title={new Date(snapshot.lastPushAt * 1000).toLocaleString()}
                                    >
                                      {relativeTime(snapshot.lastPushAt)}
                                    </time>
                                  )}
                                </div>
                              )}
                              <article
                                className="jj-revision"
                                data-selected={isSelected}
                                data-current={isCurrent}
                                data-dragged={isDragged && !isPreview}
                                data-moved={isDragged && !isPreview}
                                data-preview={isPreview}
                                data-empty={revision.empty}
                                data-drop-target={dropTargetId === revision.commitId}
                                onDragEnter={(event) => {
                                  if (!isPreview) {
                                    event.preventDefault();
                                    setDropTargetId(revision.commitId);
                                  }
                                }}
                                onDragOver={(event) => {
                                  if (!isPreview) {
                                    event.preventDefault();
                                    setDropTargetId(revision.commitId);
                                  }
                                }}
                                onDragLeave={(event) => {
                                  if (
                                    !(event.relatedTarget instanceof Node) ||
                                    !event.currentTarget.contains(event.relatedTarget)
                                  )
                                    setDropTargetId(null);
                                }}
                                onDrop={(event) => {
                                  if (!isPreview) dropOnRevision(revision, event);
                                }}
                                onContextMenu={(event) => {
                                  if (!isPreview) {
                                    event.preventDefault();
                                    openRevisionContextMenu(revision, event.clientX, event.clientY);
                                  }
                                }}
                              >
                                <button
                                  className="jj-revision-button"
                                  style={{
                                    gridTemplateColumns: `${graphWidth}px minmax(0,1fr) auto`,
                                  }}
                                  aria-current={isCurrent ? "true" : undefined}
                                  aria-expanded={isSelected}
                                  onClick={() => !isPreview && handleRevisionClick(revision)}
                                  onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (!isPreview)
                                      void runAction(() =>
                                        rpc.call("edit", {
                                          path,
                                          hostId,
                                          revision: revision.commitId,
                                        }),
                                      );
                                  }}
                                  onKeyDown={(event) => {
                                    if (
                                      !isPreview &&
                                      (event.key === "ContextMenu" ||
                                        (event.shiftKey && event.key === "F10"))
                                    ) {
                                      event.preventDefault();
                                      const bounds = event.currentTarget.getBoundingClientRect();
                                      openRevisionContextMenu(
                                        revision,
                                        bounds.left + 28,
                                        bounds.top + 24,
                                      );
                                    }
                                  }}
                                  draggable={!isPreview}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "text/jj-revision",
                                      revision.commitId,
                                    );
                                    setDraggedRevisionId(revision.commitId);
                                    const ghost = document.createElement("div");
                                    ghost.style.cssText =
                                      "position:absolute;top:-1000px;left:-1000px;width:300px;padding:8px 12px;border:1px solid #54a5ff;border-radius:8px;background:#20242b;color:#fff;font:12px system-ui;box-shadow:0 8px 24px #0008";
                                    branchFrom(revision.commitId)
                                      .slice(0, 6)
                                      .forEach((branchRevision, index) => {
                                        const ghostRow = document.createElement("div");
                                        ghostRow.textContent = `${index === 0 ? "●" : "│"}  ${label(branchRevision)}`;
                                        ghostRow.style.cssText =
                                          "padding:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
                                        ghost.append(ghostRow);
                                      });
                                    if (branchFrom(revision.commitId).length > 6) {
                                      const remainder = document.createElement("div");
                                      remainder.textContent = `… and ${branchFrom(revision.commitId).length - 6} more revisions`;
                                      remainder.style.cssText = "padding:4px 0;color:#aaa";
                                      ghost.append(remainder);
                                    }
                                    document.body.append(ghost);
                                    event.dataTransfer.setDragImage(ghost, 16, 16);
                                    window.setTimeout(() => ghost.remove(), 0);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedRevisionId(null);
                                    setDropTargetId(null);
                                  }}
                                >
                                  <RevisionGraphCell
                                    row={graphRow}
                                    width={graphWidth}
                                    laneGap={laneGap}
                                    current={isCurrent}
                                    preview={isPreview}
                                    empty={revision.empty}
                                    evolved={isEvolved}
                                  />
                                  <span
                                    className="jj-revision-main"
                                    style={{ marginLeft: graphRow.commitLane * laneGap }}
                                  >
                                    <span className="jj-revision-title">
                                      {isCurrent && (
                                        <span className="jj-badge jj-badge-current">@</span>
                                      )}
                                      {revision.workspaces.map((workspace) => (
                                        <span
                                          className={`jj-badge jj-badge-workspace${workspace === "default" ? " jj-badge-workspace-default" : ""}`}
                                          key={workspace}
                                        >
                                          {workspace}
                                        </span>
                                      ))}
                                      {revision.bookmarks.map((bookmark) => (
                                        <span className="jj-badge jj-badge-bookmark" key={bookmark}>
                                          {bookmark}
                                        </span>
                                      ))}
                                      {revision.tags.map((tag) => (
                                        <span className="jj-badge jj-badge-tag" key={tag}>
                                          {tag}
                                        </span>
                                      ))}
                                      {isEvolved && (
                                        <span className="jj-badge jj-badge-evolved">Evolved</span>
                                      )}
                                      {revision.empty && (
                                        <span className="jj-badge jj-badge-empty">Empty</span>
                                      )}
                                      <span className="jj-revision-subject">{label(revision)}</span>
                                    </span>
                                  </span>
                                  <span className="jj-revision-meta">
                                    <time
                                      className="jj-revision-age"
                                      title={new Date(revision.timestamp * 1000).toLocaleString()}
                                    >
                                      {relativeTime(revision.timestamp)}
                                    </time>
                                    <code
                                      className="jj-change-id"
                                      title={`Unique change ID prefix ${changePrefix}`}
                                    >
                                      <span className="jj-change-id-prefix">{changePrefix}</span>
                                    </code>
                                    <span className="jj-chevron">›</span>
                                  </span>
                                </button>
                                {isSelected && renderRevisionDetails(revision)}
                                {pendingHere && (
                                  <div
                                    className="jj-rebase-preview"
                                    role="group"
                                    aria-label="Preview branch rebase"
                                  >
                                    <div className="jj-rebase-preview-heading">
                                      <strong className="jj-rebase-preview-title">
                                        Move branch onto {label(revision)}
                                      </strong>
                                      <div className="jj-rebase-preview-meta">
                                        <span>
                                          {pendingRebase.branch.length}{" "}
                                          {pendingRebase.branch.length === 1
                                            ? "revision"
                                            : "revisions"}{" "}
                                          will move
                                        </span>
                                        <button
                                          className="jj-preview-toggle"
                                          aria-expanded={rebasePreviewExpanded}
                                          onClick={() =>
                                            setRebasePreviewExpanded((expanded) => !expanded)
                                          }
                                        >
                                          {rebasePreviewExpanded ? "Hide" : "Show"} graph
                                        </button>
                                      </div>
                                    </div>
                                    {rebasePreviewExpanded && (
                                      <div className="jj-rebase-preview-branch">
                                        {pendingRebase.branch.map((branchRevision) => (
                                          <div
                                            className="jj-rebase-preview-row"
                                            key={branchRevision.commitId}
                                          >
                                            <span
                                              className="jj-rebase-preview-node"
                                              aria-hidden="true"
                                            />
                                            {label(branchRevision)}
                                            <code>{branchRevision.changeIdPrefix}</code>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <code className="jj-confirm-code">
                                      jj rebase -s {pendingRebase.source.commitId} -d{" "}
                                      {pendingRebase.destination.commitId}
                                    </code>
                                    <div className="jj-rebase-preview-actions">
                                      <button
                                        className="jj-button"
                                        disabled={busy}
                                        onClick={cancelRebasePreview}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        className="jj-button jj-button-primary"
                                        disabled={busy}
                                        onClick={() => void confirmRebase()}
                                      >
                                        {busy ? "Moving…" : "Rebase branch"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </article>
                            </Fragment>
                          );
                        })}
                  </section>
                ))}
            </main>
          ) : (
            <main className="jj-scm">
              <div className="jj-scm-heading">
                Changes <span className="jj-count">{snapshot.changes.length}</span>
              </div>
              <div className="jj-scm-layout">
                <div className="jj-scm-list" ref={sourceListRef}>
                  <section
                    className={`jj-group jj-working-group${diffTarget ? "" : " jj-working-group-fill"}`}
                    style={diffTarget ? { flexBasis: `${changesPanePercent}%` } : undefined}
                  >
                    <button
                      className="jj-group-header"
                      aria-expanded={changesExpanded}
                      onClick={() => setChangesExpanded((expanded) => !expanded)}
                    >
                      <span className="jj-chevron">›</span>
                      <span>Working Copy</span>
                      <span className="jj-badge jj-badge-current">@</span>
                      <span className="jj-count">{snapshot.changes.length}</span>
                    </button>
                    {changesExpanded && (
                      <div className="jj-group-content jj-working-content">
                        {snapshot.changes.length === 0 ? (
                          <div className="jj-selection-hint">Working copy clean</div>
                        ) : (
                          snapshot.changes.map((file) => (
                            <div className="jj-file-entry" key={file.path}>
                              <input
                                className="jj-checkbox"
                                type="checkbox"
                                aria-label={`Select ${file.path} for split`}
                                checked={selectedWorkingFiles.includes(file.path)}
                                onChange={(event) =>
                                  setSelectedWorkingFiles((current) =>
                                    event.target.checked
                                      ? [...current, file.path]
                                      : current.filter(
                                          (selectedPath) => selectedPath !== file.path,
                                        ),
                                  )
                                }
                              />
                              <button
                                className="jj-file-button"
                                data-selected={
                                  diffTarget?.revision === null && diffTarget.path === file.path
                                }
                                onClick={() => selectFileDiff(file.path, null)}
                              >
                                <span className={`jj-status ${statusClass(file.status)}`}>
                                  {file.status}
                                </span>
                                <FilePath path={file.path} />
                              </button>
                            </div>
                          ))
                        )}
                        <div className="jj-working-actions">
                          {editingWorkingDescription && (
                            <textarea
                              className="jj-input"
                              aria-label="Working copy description"
                              placeholder="Describe working copy…"
                              value={workingDescription}
                              onChange={(event) => setWorkingDescription(event.target.value)}
                            />
                          )}
                          <div className="jj-working-actions-row">
                            <button
                              className="jj-button"
                              disabled={busy}
                              onClick={() =>
                                editingWorkingDescription
                                  ? void runAction(() =>
                                      rpc.call("describe", {
                                        path,
                                        hostId,
                                        revision: snapshot.currentRevision,
                                        description: workingDescription,
                                      }),
                                    )
                                  : setEditingWorkingDescription(true)
                              }
                            >
                              {editingWorkingDescription ? "Save description" : "Describe @"}
                            </button>
                            {editingWorkingDescription && (
                              <button
                                className="jj-button"
                                disabled={busy}
                                onClick={() => setEditingWorkingDescription(false)}
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              className="jj-button jj-button-primary"
                              disabled={busy || selectedWorkingFiles.length === 0}
                              onClick={() =>
                                void runAction(() =>
                                  rpc.call("split", {
                                    path,
                                    hostId,
                                    revision: snapshot.currentRevision,
                                    files: selectedWorkingFiles,
                                    message: splitMessage,
                                  }),
                                )
                              }
                            >
                              Split {selectedWorkingFiles.length || "selected"}
                            </button>
                          </div>
                          {selectedWorkingFiles.length > 0 && (
                            <input
                              className="jj-input"
                              aria-label="New revision description"
                              value={splitMessage}
                              onChange={(event) => setSplitMessage(event.target.value)}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                  {diffTarget && (
                    <div
                      className="jj-scm-resizer"
                      role="separator"
                      aria-label="Resize Changes and Recent revisions panes"
                      aria-orientation="horizontal"
                      aria-valuemin={20}
                      aria-valuemax={80}
                      aria-valuenow={changesPanePercent}
                      tabIndex={0}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        resizeSourcePane(event.clientY);
                      }}
                      onPointerMove={(event) => resizeSourcePane(event.clientY)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          event.preventDefault();
                          changeSourcePanePercent(
                            changesPanePercent + (event.key === "ArrowUp" ? -5 : 5),
                          );
                        }
                      }}
                    />
                  )}
                  <section className="jj-group jj-history-group">
                      <button
                        className="jj-group-header"
                        aria-expanded={historyExpanded}
                        onClick={() => setHistoryExpanded((expanded) => !expanded)}
                      >
                        <span className="jj-chevron">›</span>
                        <span>Recent revisions</span>
                      </button>
                      {historyExpanded && (
                        <div className="jj-group-content">
                          <label className="jj-history-depth">
                            Show @ through @-
                            <input
                              className="jj-input"
                              type="number"
                              min={1}
                              max={80}
                              value={recentDepth}
                              onChange={(event) => {
                                const next = Math.max(1, Math.min(80, Number(event.target.value)));
                                setRecentDepth(next);
                                localStorage.setItem("jj-plugin-recent", String(next));
                              }}
                            />
                          </label>
                          {recentRevisions.slice(1).map((revision, index) => {
                            const isExpanded = expandedSourceRevisionId === revision.commitId;
                            return (
                              <section className="jj-ancestor-group" key={revision.commitId}>
                                <div className="jj-history-item">
                                  <button
                                    className="jj-ancestor-header"
                                    aria-expanded={isExpanded}
                                    onClick={() => toggleSourceRevision(revision)}
                                  >
                                    <span className="jj-chevron">›</span>
                                    <code className="jj-ancestor-label">@-{index + 1}</code>
                                    <span className="jj-ancestor-subject" title={label(revision)}>
                                      {label(revision)}
                                    </span>
                                    <span
                                      className="jj-ancestor-meta"
                                      title={new Date(revision.timestamp * 1000).toLocaleString()}
                                    >
                                      {relativeTime(revision.timestamp)}
                                    </span>
                                  </button>
                                  {revision.parents[0] && (
                                    <button
                                      className="jj-mini-action"
                                      disabled={busy}
                                      title={`Squash ${label(revision)} into its parent`}
                                      onClick={() =>
                                        void runAction(() =>
                                          rpc.call("squash", {
                                            path,
                                            hostId,
                                            revision: revision.commitId,
                                            destination: revision.parents[0] ?? "@-",
                                          }),
                                        )
                                      }
                                    >
                                      Squash
                                    </button>
                                  )}
                                </div>
                                {isExpanded && selectedRevision?.commitId === revision.commitId && (
                                  <div className="jj-ancestor-files">
                                    <div className="jj-ancestor-files-heading">
                                      <button
                                        className="jj-section-heading jj-section-heading-toggle"
                                        aria-expanded={filesExpandedRevisionId === revision.commitId}
                                        onClick={() =>
                                          setFilesExpandedRevisionId((current) =>
                                            current === revision.commitId
                                              ? null
                                              : revision.commitId,
                                          )
                                        }
                                      >
                                        <span className="jj-chevron">›</span>
                                        Changed files
                                        <span className="jj-count">
                                          {revisionFilesLoading
                                            ? "…"
                                            : revisionFilesError
                                              ? "!"
                                              : revisionFiles.length}
                                        </span>
                                      </button>
                                      <button
                                        className="jj-button jj-ancestor-full-diff"
                                        title={`View the full diff for ${label(revision)}`}
                                        onClick={() => void showRevisionDiff(revision)}
                                      >
                                        Full diff
                                      </button>
                                    </div>
                                    {filesExpandedRevisionId === revision.commitId &&
                                      revisionFilesError && (
                                        <div className="jj-error-inline" role="alert">
                                          {revisionFilesError}
                                        </div>
                                      )}
                                    {filesExpandedRevisionId === revision.commitId && (
                                      <>
                                        {revisionFilesLoading ? (
                                          <div className="jj-selection-hint">Loading files…</div>
                                        ) : (
                                          <>
                                            {revisionFiles.map((file) => (
                                              <div className="jj-file-entry" key={file.path}>
                                                <input
                                                  className="jj-checkbox"
                                                  type="checkbox"
                                                  aria-label={`Select ${file.path} for split`}
                                                  checked={selectedRevisionFiles.includes(
                                                    file.path,
                                                  )}
                                                  onChange={(event) =>
                                                    setSelectedRevisionFiles((current) =>
                                                      event.target.checked
                                                        ? [...current, file.path]
                                                        : current.filter(
                                                            (selectedPath) =>
                                                              selectedPath !== file.path,
                                                          ),
                                                    )
                                                  }
                                                />
                                                <button
                                                  className="jj-file-button"
                                                  onClick={() =>
                                                    openFullDiff(file.path, revision.commitId)
                                                  }
                                                >
                                                  <span
                                                    className={`jj-status ${statusClass(file.status)}`}
                                                  >
                                                    {file.status}
                                                  </span>
                                                  <FilePath path={file.path} />
                                                </button>
                                              </div>
                                            ))}
                                            {revisionFiles.length === 0 && (
                                              <div className="jj-selection-hint">
                                                No file changes in this revision.
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </>
                                    )}
                                    <div className="jj-ancestor-ops">
                                      <textarea
                                        className="jj-input jj-description-edit"
                                        aria-label="Revision description"
                                        value={description}
                                        onChange={(event) => setDescription(event.target.value)}
                                      />
                                      <div className="jj-ancestor-actions">
                                        <button
                                          className="jj-button"
                                          disabled={busy || description === revision.description}
                                          onClick={() => void saveRevisionDescription(revision)}
                                        >
                                          Describe
                                        </button>
                                        <button
                                          className="jj-button"
                                          disabled={busy || selectedRevisionFiles.length === 0}
                                          onClick={() =>
                                            void runAction(() =>
                                              rpc.call("split", {
                                                path,
                                                hostId,
                                                revision: revision.commitId,
                                                files: selectedRevisionFiles,
                                                message: splitMessage,
                                              }),
                                            )
                                          }
                                        >
                                          Split selected
                                        </button>
                                        {revision.parents[0] && (
                                          <button
                                            className="jj-button"
                                            disabled={busy}
                                            onClick={() =>
                                              void runAction(() =>
                                                rpc.call("squash", {
                                                  path,
                                                  hostId,
                                                  revision: revision.commitId,
                                                  destination: revision.parents[0] ?? "@-",
                                                }),
                                              )
                                            }
                                          >
                                            Squash into parent
                                          </button>
                                        )}
                                      </div>
                                      {selectedRevisionFiles.length > 0 && (
                                        <input
                                          className="jj-input"
                                          aria-label="New revision description"
                                          value={splitMessage}
                                          onChange={(event) => setSplitMessage(event.target.value)}
                                        />
                                      )}
                                    </div>
                                  </div>
                                )}
                              </section>
                            );
                          })}
                        </div>
                      )}
                  </section>
                </div>
                {diffTarget && (
                  <aside className="jj-preview">
                    <div className="jj-preview-header">
                      <span>{diffTarget.path}</span>
                      <button
                        className="jj-preview-close"
                        aria-label="Close diff preview"
                        onClick={() => setDiffTarget(null)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="jj-preview-body">
                      <DiffPreview
                        path={diffTarget.path}
                        patch={diffPatch}
                        loading={diffLoading}
                        error={diffError}
                      />
                    </div>
                  </aside>
                )}
              </div>
            </main>
          )}
        </>
      )}
      {fullDiffOpen && (diffTarget || revisionDiffView) && (
        <div
          className="jj-full-diff-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              revisionDiffRequest.current += 1;
              setFullDiffOpen(false);
              setDiffTarget(null);
              setRevisionDiffView(null);
            }
          }}
        >
          <section
            className="jj-full-diff"
            role="dialog"
            aria-modal="true"
            aria-label={
              revisionDiffView
                ? `Diff for ${label(revisionDiffView.revision)}`
                : `Diff for ${diffTarget?.path ?? "revision"}`
            }
          >
            <header className="jj-full-diff-header">
              <span>
                {revisionDiffView
                  ? `${label(revisionDiffView.revision)} · ${revisionDiffView.files.length} files`
                  : diffTarget?.path}
              </span>
              <button
                className="jj-button"
                aria-label="Close diff"
                onClick={() => {
                  revisionDiffRequest.current += 1;
                  setFullDiffOpen(false);
                  setDiffTarget(null);
                  setRevisionDiffView(null);
                }}
              >
                Close
              </button>
            </header>
            <div className="jj-full-diff-body">
              {revisionDiffView ? (
                <>
                  {revisionDiffLoading && (
                    <div className="jj-selection-hint">Loading revision diff…</div>
                  )}
                  {revisionDiffError && (
                    <div className="jj-error-inline" role="alert">
                      {revisionDiffError}
                    </div>
                  )}
                  {!revisionDiffLoading &&
                    !revisionDiffError &&
                    revisionDiffView.files.length === 0 && (
                      <div className="jj-diff-empty">This revision has no changed files.</div>
                    )}
                  {revisionDiffView.files.map((file) => (
                    <section className="jj-revision-diff-file" key={file.path}>
                      <h3>
                        <span className={`jj-status ${statusClass(file.status)}`}>
                          {file.status}
                        </span>
                        {file.path}
                      </h3>
                      <div className="jj-revision-diff-renderer">
                        <BbDiff patch={file.patch} path={file.path} />
                      </div>
                    </section>
                  ))}
                </>
              ) : diffTarget ? (
                <DiffPreview
                  path={diffTarget.path}
                  patch={diffPatch}
                  loading={diffLoading}
                  error={diffError}
                />
              ) : null}
            </div>
          </section>
        </div>
      )}
      {projectPickerOpen && (
        <div
          className="jj-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              directoryRequest.current += 1;
              setProjectPickerOpen(false);
            }
          }}
        >
          <section
            className="jj-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Choose project"
          >
            <div className="jj-picker-header">
              {isDirectoryQuery && (
                <button
                  className="jj-button"
                  aria-label="Back to projects"
                  onClick={() => {
                    setProjectQuery("");
                    setDirectoryBrowser(null);
                  }}
                >
                  ←
                </button>
              )}
              <div className="jj-picker-path">
                <input
                  autoFocus
                  aria-label="Search projects or enter a folder path"
                  placeholder="Search projects or type / for a folder…"
                  value={projectQuery}
                  onChange={(event) => {
                    const query = event.target.value;
                    setProjectQuery(query);
                    setProjectIndex(0);
                    setDirectoryIndex(0);
                    setDirectoryBrowser(null);
                    setError(null);
                    if (!query.startsWith("/")) directoryRequest.current += 1;
                  }}
                  onKeyDown={handleDirectoryKeyDown}
                />
              </div>
              {isDirectoryQuery && (
                <button className="jj-button" onClick={chooseDirectory}>
                  Choose <kbd>⌘ Enter</kbd>
                </button>
              )}
            </div>
            <div className="jj-picker-section">{isDirectoryQuery ? "Folders" : "Projects"}</div>
            <div
              className="jj-picker-list"
              role="listbox"
              aria-label={isDirectoryQuery ? "Folders" : "Projects"}
            >
              {isDirectoryQuery
                ? directoryEntries.map((entry, index) => (
                    <button
                      id={`jj-picker-entry-${index}`}
                      className="jj-picker-entry"
                      key={entry.path}
                      role="option"
                      aria-selected={directoryIndex === index}
                      data-active={directoryIndex === index}
                      onMouseEnter={() => setDirectoryIndex(index)}
                      onFocus={() => setDirectoryIndex(index)}
                      onClick={() => {
                        setDirectoryIndex(index);
                        void browseDirectory(entry.path);
                      }}
                    >
                      <span className="jj-picker-entry-icon" aria-hidden="true"></span>
                      {entry.name}
                    </button>
                  ))
                : filteredProjectPaths.map((projectPath, index) => (
                    <button
                      id={`jj-project-option-${index}`}
                      className="jj-project-option"
                      key={`${projectPath.hostId}:${projectPath.name}:${projectPath.path}`}
                      role="option"
                      aria-selected={projectIndex === index}
                      data-active={projectIndex === index}
                      onMouseEnter={() => setProjectIndex(index)}
                      onFocus={() => setProjectIndex(index)}
                      onClick={() => chooseProjectPath(projectPath)}
                    >
                      <span className="jj-project-mark" aria-hidden="true">
                        {projectPath.name.slice(0, 2).toLocaleUpperCase()}
                      </span>
                      <span className="jj-project-copy">
                        <span>{projectPath.name}</span>
                        <small>
                          {hosts.find((host) => host.id === projectPath.hostId)?.name ?? "Machine"}{" "}
                          · {projectPath.path}
                        </small>
                      </span>
                      {index < 9 && <kbd>⌘ {index + 1}</kbd>}
                    </button>
                  ))}
              {isDirectoryQuery && !directoryBrowser && (
                <div className="jj-selection-hint">Loading folders…</div>
              )}
              {isDirectoryQuery && directoryBrowser && directoryEntries.length === 0 && (
                <div className="jj-selection-hint">No subfolders here.</div>
              )}
              {!isDirectoryQuery && filteredProjectPaths.length === 0 && (
                <div className="jj-selection-hint">
                  No known projects match. Type / to browse folders.
                </div>
              )}
              {error && (
                <div className="jj-error-inline" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="jj-picker-footer">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>Enter</kbd> {isDirectoryQuery ? "Open" : "Select"}
              </span>
              {isDirectoryQuery && (
                <>
                  <span>
                    <kbd>⌘ Enter</kbd> Choose folder
                  </span>
                  <span>
                    <kbd>Backspace</kbd> Back
                  </span>
                </>
              )}
              <span>
                <kbd>Esc</kbd> Close
              </span>
            </footer>
          </section>
        </div>
      )}
      {revisionContextMenu && (
        <>
          <div className="jj-context-backdrop" onClick={() => setRevisionContextMenu(null)} />
          <div
            className="jj-context-menu"
            role="menu"
            aria-label={`Actions for ${label(revisionContextMenu.revision)}`}
            style={{
              left: Math.max(8, Math.min(revisionContextMenu.x, window.innerWidth - 245)),
              top: Math.max(8, Math.min(revisionContextMenu.y, window.innerHeight - 520)),
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRevisionContextMenu(null);
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                const revision = revisionContextMenu.revision;
                void showRevisionDiff(revision);
                setRevisionContextMenu(null);
              }}
            >
              Show Diff
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setSelectedRevision(revision);
                setDescription(revision.description);
                setDiffTarget(null);
                setRevisionContextMenu(null);
              }}
            >
              Describe…
            </button>
            {revisionContextMenu.revision.commitId !== snapshot?.currentRevision && (
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  const revision = revisionContextMenu.revision;
                  setRevisionContextMenu(null);
                  void runAction(() =>
                    rpc.call("edit", { path, hostId, revision: revision.commitId }),
                  );
                }}
              >
                Edit This Change
              </button>
            )}
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setRevisionContextMenu(null);
                void runAction(() =>
                  rpc.call("newChange", { path, hostId, revision: revision.commitId }),
                );
              }}
            >
              New Change Here
            </button>
            <div className="jj-context-menu-separator" />
            <button
              role="menuitem"
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setSelectedRevision(revision);
                setDescription(revision.description);
                setSelectedRevisionFiles([]);
                setDiffTarget(null);
                setRevisionContextMenu(null);
              }}
            >
              Split…
            </button>
            <button
              role="menuitem"
              disabled={revisionContextMenu.revision.parents.length === 0 || busy}
              onClick={() => {
                const revision = revisionContextMenu.revision;
                const parent = revision.parents[0];
                setRevisionContextMenu(null);
                if (parent)
                  void runAction(() =>
                    rpc.call("squash", {
                      path,
                      hostId,
                      revision: revision.commitId,
                      destination: parent,
                    }),
                  );
              }}
            >
              Squash
            </button>
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setPendingAbandon(revisionContextMenu.revision);
                setRevisionContextMenu(null);
              }}
            >
              Abandon…
            </button>
            <div className="jj-context-menu-separator" />
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setRevisionContextMenu(null);
                void runAction(() =>
                  rpc.call("duplicate", { path, hostId, revision: revision.commitId }),
                );
              }}
            >
              Duplicate
            </button>
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setRevisionContextMenu(null);
                void runAction(() =>
                  rpc.call("revert", {
                    path,
                    hostId,
                    revision: revision.commitId,
                    destination: "@",
                  }),
                );
              }}
            >
              Revert
            </button>
            <div className="jj-context-menu-separator" />
            {!revisionContextMenu.revision.bookmarks.includes("main") && (
              <button
                role="menuitem"
                disabled={
                  busy || !revisions.some((revision) => revision.bookmarks.includes("main"))
                }
                onClick={() => {
                  const revision = revisionContextMenu.revision;
                  const mainRevision = revisions.find((candidate) =>
                    candidate.bookmarks.includes("main"),
                  );
                  setRevisionContextMenu(null);
                  if (mainRevision) beginRebasePreview(revision, mainRevision);
                }}
              >
                Rebase on Main
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setRevisionContextMenu(null);
                const name = window.prompt("Bookmark name", revision.bookmarks[0] ?? "");
                if (name?.trim())
                  void runAction(() =>
                    rpc.call("setBookmark", {
                      path,
                      hostId,
                      revision: revision.commitId,
                      name: name.trim(),
                    }),
                  );
              }}
            >
              Set Bookmark Here…
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const revision = revisionContextMenu.revision;
                setRevisionContextMenu(null);
                void navigator.clipboard.writeText(revision.changeId).catch((cause) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                });
              }}
            >
              Copy Change ID
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMoveSource(revisionContextMenu.revision);
                setPendingRebase(null);
                setRevisionContextMenu(null);
              }}
            >
              Rebase branch onto…
            </button>
          </div>
        </>
      )}
      {pendingAbandon && (
        <div className="jj-confirm-backdrop" role="presentation">
          <section
            className="jj-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="jj-abandon-title"
          >
            <h2 id="jj-abandon-title">Abandon this change?</h2>
            <p>
              JJ will abandon “{label(pendingAbandon)}” and rebase its descendants onto its parent.
            </p>
            <code className="jj-confirm-code">jj abandon {pendingAbandon.changeIdPrefix}</code>
            <div className="jj-confirm-actions">
              <button className="jj-button" disabled={busy} onClick={() => setPendingAbandon(null)}>
                Cancel
              </button>
              <button
                className="jj-button jj-button-primary"
                disabled={busy}
                onClick={() => {
                  const revision = pendingAbandon;
                  void runAction(() =>
                    rpc.call("abandon", { path, hostId, revision: revision.commitId }),
                  ).then((success) => {
                    if (success) setPendingAbandon(null);
                  });
                }}
              >
                {busy ? "Abandoning…" : "Abandon change"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "jj-workbench",
    title: "Jujutsu",
    icon: "GitBranch",
    path: "jj",
    component: () => <Page />,
    fixedTabs: [
      {
        panelId: "jj-workbench",
        id: "jj-right-sidebar",
        title: "Jujutsu",
        icon: "GitBranch",
        layout: "flush",
        component: () => <Page />,
      },
    ],
  });
  app.slots.threadPanelAction({
    id: "thread-workbench",
    title: "Jujutsu workbench",
    icon: "GitBranch",
    layout: "flush",
    component: ({ threadId }) => <Page threadId={threadId} />,
  });
  app.slots.experimental_threadHeaderAction({
    id: "open-thread-workbench",
    title: "Jujutsu workbench",
    component: ThreadHeaderAction,
  });
});
