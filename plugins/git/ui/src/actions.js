// ---------------------------------------------------------------------------
// 状态应用 / 刷新对账 / 动作执行 / toast
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { callTool, isNoGit, isNoRepo } from "./api.js";
import { status, busy, expanded, diffScope, setStatus, setBusy, keyOf, scopeArgs } from "./state.js";
import { $ } from "./dom.js";
import { render } from "./render.js";

/** 应用一次 git_status 结果：正常则渲染，非仓库等状态显示致命提示。 */
export function applyStatus(fresh) {
  setStatus(fresh);
  if (fresh && fresh.ok !== false) {
    $("fatal").hidden = true;
    reconcileExpanded(fresh);
    render();
  } else {
    const msg = fresh?.reason === "not_a_git_repo" ? t.notRepo : String(fresh?.error || "unknown");
    showFatal(msg + (fresh?.cwd ? "\n" + fresh.cwd : ""));
  }
}

export async function refresh() {
  try {
    applyStatus(await callTool("git_status", {}));
  } catch (err) {
    if (isNoGit(err)) return showFatal(t.noGit);
    if (isNoRepo(err)) return showFatal(t.notRepo + "\n" + String(err.message || "").split("\n")[0]);
    return showFatal(String(err.message || err));
  }
}

/**
 * 状态刷新后对账已展开的行：
 * - 文件仍在原分区：静默刷新其 diff（内容可能已被外部改动）；
 * - 文件被暂存/取消暂存到另一分区：展开行跟随迁移并重新加载 diff；
 * - 文件已消失（提交/撤销/删除）：收起。
 */
function reconcileExpanded(st) {
  const stagedList = st.staged || [];
  const workList = st.unstaged || [];
  for (const [key, info] of [...expanded]) {
    const inList = (list) => list.some((e) => e.path === info.entry.path);
    const here = inList(info.staged ? stagedList : workList);
    const other = inList(info.staged ? workList : stagedList);
    if (here) {
      refreshDiffSilent(key);
    } else if (other) {
      expanded.delete(key);
      expanded.set(keyOf(!info.staged, info.entry.path), {
        entry: info.entry,
        staged: !info.staged,
        diff: null,
        loading: true,
        scope: info.scope || diffScope,
      });
    } else {
      expanded.delete(key);
    }
  }
}

function refreshDiffSilent(key) {
  const info = expanded.get(key);
  if (!info || info.loading || !info.diff) return;
  callTool("git_diff", { path: info.entry.path, staged: info.staged, ...scopeArgs(info.scope) })
    .then((d) => {
      if (expanded.get(key) === info) {
        info.diff = d;
        // 图片内容可能已被外部修改：作废旧预览，触发重新拉取
        if (d?.binary && info.images) {
          info.images = null;
          info.imagesPending = false;
        }
        render();
      }
    })
    .catch(() => {
      /* 静默刷新失败保留旧 diff，等下一次变化再试 */
    });
}

export function showFatal(msg) {
  $("fatal").textContent = msg;
  $("fatal").hidden = false;
  $("staged-list").replaceChildren();
  $("worktree-list").replaceChildren();
  $("staged-count").textContent = "";
  $("worktree-count").textContent = "";
  $("staged-all").replaceChildren();
  $("worktree-all").replaceChildren();
  $("clean").hidden = true;
  updateCommitBar(0);
}

export function toggleDiff(row, entry, staged) {
  const key = keyOf(staged, entry.path);
  if (expanded.has(key)) {
    expanded.delete(key);
    render();
    return;
  }
  expanded.set(key, { loading: true, entry, staged, diff: null, scope: diffScope });
  render();
}

export function updateCommitBar(stagedCount) {
  $("commit-btn").disabled = busy || stagedCount === 0;
  $("commit-btn").textContent = stagedCount ? `${t.commit} (${stagedCount})` : t.commit;
  $("commit-btn").title = stagedCount === 0 ? t.nothingStaged : t.stagedTip;
}

export async function runAction(fn) {
  if (busy) return;
  setBusy(true);
  for (const id of ["view-btn", "pull-btn", "stash-btn"]) $(id).disabled = true;
  try {
    await fn();
    await refresh();
  } catch (err) {
    toast(t.actionFailed + String(err.message || err).split("\n")[0], "err");
  } finally {
    setBusy(false);
    for (const id of ["view-btn", "pull-btn", "stash-btn"]) $(id).disabled = false;
    updateCommitBar(status?.staged?.length || 0);
  }
}

// Toast: success auto-dismisses; errors stay until closed manually.
const TOAST_MS_OK = 5000;
const TOAST_MS_INFO = 3200;
let toastTimer = null;
export function toast(msg, tone) {
  const box = $("toast");
  box.replaceChildren();
  const tx = document.createElement("span");
  tx.className = "toast-text";
  tx.textContent = msg;
  const x = document.createElement("button");
  x.className = "toast-x";
  x.textContent = "×";
  x.title = t.noticeClose;
  x.addEventListener("click", () => {
    box.classList.remove("show");
  });
  box.append(tx, x);
  box.classList.toggle("err", tone === "err");
  box.classList.add("show");
  clearTimeout(toastTimer);
  if (tone !== "err") toastTimer = setTimeout(() => box.classList.remove("show"), tone === "ok" ? TOAST_MS_OK : TOAST_MS_INFO);
}
