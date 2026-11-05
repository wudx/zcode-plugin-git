// ---------------------------------------------------------------------------
// 主渲染：状态 → 全量重绘（行/树/展开的 diff/迷你地图/stash 菜单/提交栏）
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { status, expanded, treeMode, scopeArgs, stagedCollapsed, worktreeCollapsed } from "./state.js";
import { callTool } from "./api.js";
import { $, el, iconBtn, confirmUI } from "./dom.js";
import { rowEl, treeEl } from "./rows.js";
import { diffEl, loadImages } from "./diffbox.js";
import { IMAGE_RE } from "./diffview.js";
import { attachMinimap } from "./minimap.js";
import { renderStashMenu } from "./stash.js";
import { renderBranchMenu } from "./branches.js";
import { runAction, updateCommitBar } from "./actions.js";

export function render() {
  if (!status) return;
  const br = $("branch");
  br.textContent = status.detached ? "(detached)" : status.branch || "…";
  br.title = t.branchMenu;
  const ab = $("ahead-behind");
  if (status.upstream && (status.ahead || status.behind)) {
    // 领先/落后分色：绿=待推送，黄=待拉取
    ab.replaceChildren(
      el("span", "ab-ahead", `↑${status.ahead}`),
      document.createTextNode(" "),
      el("span", "ab-behind", `↓${status.behind}`),
    );
    ab.hidden = false;
  } else ab.hidden = true;

  $("stash-btn").title = t.stashMenu;

  const conflicts = status.conflicts || [];
  $("conflict-box").hidden = conflicts.length === 0;
  if (conflicts.length) {
    const list = $("conflict-list");
    list.replaceChildren(...conflicts.map((c) => rowEl({ code: "U", unmerged: true, path: c.path ?? c }, false)));
  }

  const staged = status.staged || [];
  const unstaged = status.unstaged || [];
  $("staged-count").textContent = staged.length ? `(${staged.length})` : "";
  $("worktree-count").textContent = unstaged.length ? `(${unstaged.length})` : "";
  // 分区折叠：收起时列表与空态一并隐藏，chevron 旋转提示可展开
  $("staged-chev").classList.toggle("collapsed", stagedCollapsed);
  $("worktree-chev").classList.toggle("collapsed", worktreeCollapsed);
  $("staged-chev").title = stagedCollapsed ? t.expandSection : t.collapseSection;
  $("worktree-chev").title = worktreeCollapsed ? t.expandSection : t.collapseSection;
  $("staged-h").setAttribute("aria-expanded", String(!stagedCollapsed));
  $("worktree-h").setAttribute("aria-expanded", String(!worktreeCollapsed));
  $("staged-list").hidden = stagedCollapsed;
  $("worktree-list").hidden = worktreeCollapsed;
  $("staged-empty").hidden = stagedCollapsed || staged.length > 0;
  $("worktree-empty").hidden = worktreeCollapsed || unstaged.length > 0;
  $("clean").hidden = staged.length + unstaged.length > 0;

  // 分区头部的「全部暂存 / 全部取消暂存 / 全部撤销」（悬停浮现的图标按钮）
  $("staged-all").replaceChildren();
  $("worktree-all").replaceChildren();
  mkAllButton($("staged-all"), ICONS.minus, t.unstageAll, staged.map((e) => e.path), "git_unstage");
  mkAllButton($("worktree-all"), ICONS.plus, t.stageAll, unstaged.map((e) => e.path), "git_stage");
  mkAllButton($("worktree-all"), ICONS.undo, t.discardAll, unstaged.map((e) => e.path), "git_discard", true);

  const sList = $("staged-list");
  const wList = $("worktree-list");
  if (treeMode) {
    sList.replaceChildren(staged.length ? treeEl(staged, true) : document.createTextNode(""));
    wList.replaceChildren(unstaged.length ? treeEl(unstaged, false) : document.createTextNode(""));
  } else {
    sList.replaceChildren(...staged.map((e) => rowEl(e, true)));
    wList.replaceChildren(...unstaged.map((e) => rowEl(e, false)));
  }

  for (const [key, info] of expanded) {
    const row = document.querySelector(`.row[data-key="${CSS.escape(key)}"]`);
    if (!row) continue;
    row.classList.add("expanded");
    const dBox = diffEl(key);
    row.after(dBox);
    attachMinimap(dBox); // 挂载后同步挂迷你地图（布局读取会强制同步排版，不依赖帧回调）
    if (info.loading && !info.pending) {
      info.pending = true;
      callTool("git_diff", { path: info.entry.path, staged: info.staged, ...scopeArgs(info.scope) })
        .then((d) => {
          info.diff = d;
          info.loading = false;
          if (expanded.has(key)) render();
        })
        .catch((err) => {
          info.diff = { text: t.actionFailed + err.message, binary: false };
          info.loading = false;
          if (expanded.has(key)) render();
        });
    }
    // 图片文件：diff 判定为二进制后拉取两个版本做预览比对
    if (
      !info.loading && info.diff && info.diff.binary &&
      !info.images && !info.imagesPending &&
      !info.entry.unmerged && IMAGE_RE.test(info.entry.path)
    ) {
      info.imagesPending = true;
      loadImages(info);
    }
  }
  updateCommitBar(staged.length);
  renderStashMenu();
  renderBranchMenu();
}

function mkAllButton(box, icon, label, paths, tool, needConfirm = false) {
  // 每个按钮独占一个 slot，同一分区头可放多个批量按钮（容器由 render 清空）
  const slot = document.createElement("span");
  slot.style.display = "inline-flex";
  slot.style.gap = "4px";
  box.appendChild(slot);
  if (!paths.length) return;
  const run = () => runAction(() => callTool(tool, { paths }));
  // 危险操作（全部撤销）走行内二次确认：问题文案 + 确认按钮，Esc/失焦取消
  const showConfirm = () => {
    confirmUI(slot, {
      question: t.confirmDiscardAll,
      yesLabel: t.confirmYes,
      onYes: run,
      onCancel: showIcon,
      esc: true,
      focus: true,
    });
  };
  const showIcon = () => {
    slot.replaceChildren(iconBtn({ icon, title: label, onClick: () => (needConfirm ? showConfirm() : run()) }));
  };
  slot.addEventListener("focusout", (e) => {
    if (!slot.contains(e.relatedTarget)) showIcon();
  });
  showIcon();
}
