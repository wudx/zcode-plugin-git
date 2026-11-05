// ---------------------------------------------------------------------------
// state：共享可变状态。读走导出的 let 活绑定（零改动裸标识符）；
// 写一律走专属 setter（活绑定对导入方只读）。
// ---------------------------------------------------------------------------

import { lsGet, lsSet } from "./storage.js";
import { t } from "./i18n.js";

export let status = null;
export const expanded = new Map(); // key -> { loading, entry, staged, diff }
export let busy = false;
export let lastStatusJson = "";
export let treeMode = lsGet("zcode-git.view") === "tree";
export let splitDiff = lsGet("zcode-git.diffView") === "split";
// diff 上下文范围：line=±10 行；line20=±20 行；file=整个文件
export let diffScope = ["line", "line20", "file"].includes(lsGet("zcode-git.scope")) ? lsGet("zcode-git.scope") : "line";
export let customPrompt = lsGet("zcode-git.customPrompt") ?? "";
export let promptOpen = customPrompt !== "";
export const collapsedDirs = new Set(); // "area:dir/path" -> collapsed
// 分区折叠（暂存/工作区）：持久化记忆，点击分区头切换
export let stagedCollapsed = lsGet("zcode-git.stagedCollapsed") === "1";
export let worktreeCollapsed = lsGet("zcode-git.worktreeCollapsed") === "1";
export let stashOpen = false;
export let stashState = null; // null | { phase: 'loading'|'ready'|'error', entries, error }

export function setStatus(fresh) {
  status = fresh;
  lastStatusJson = JSON.stringify(fresh);
}
export function setBusy(v) { busy = v; }
export function setTreeMode(v) { treeMode = v; }
export function setSplitDiff(v) { splitDiff = v; }
export function setDiffScope(v) { diffScope = v; }
export function setCustomPrompt(v) { customPrompt = v; }
export function setPromptOpen(v) { promptOpen = v; }
export function setStashOpen(v) { stashOpen = v; }
export function setStashState(v) { stashState = v; }
export function setStagedCollapsed(v) {
  stagedCollapsed = v;
  lsSet("zcode-git.stagedCollapsed", v ? "1" : "0");
}
export function setWorktreeCollapsed(v) {
  worktreeCollapsed = v;
  lsSet("zcode-git.worktreeCollapsed", v ? "1" : "0");
}

export function keyOf(staged, p) {
  return (staged ? "s:" : "w:") + p;
}

// 上下文范围切换按钮的文案与循环顺序
const SCOPE_ORDER = ["line", "line20", "file"];
export function scopeLabel(scope) {
  if (scope === "line20") return t.scopeLine20;
  if (scope === "file") return t.scopeFile;
  return t.scopeLine;
}
// scope → git_diff 参数：±20 档复用 scope=line + context=20
export function scopeArgs(scope) {
  if (scope === "line20") return { scope: "line", context: 20 };
  return { scope: scope || "line" };
}
export function nextScope(scope) {
  return SCOPE_ORDER[(SCOPE_ORDER.indexOf(scope || "line") + 1) % SCOPE_ORDER.length];
}
export function scopeTitle(scope) {
  return t.scopeTitle.replace("{cur}", scopeLabel(scope)).replace("{next}", scopeLabel(nextScope(scope)));
}
