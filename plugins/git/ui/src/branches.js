// ---------------------------------------------------------------------------
// 分支菜单：分支列表渲染与 checkout 动作流程
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import { busy, branchOpen, branchState, setBranchOpen, setBranchState } from "./state.js";
import { $, el, confirmUI } from "./dom.js";
import { runAction, toast } from "./actions.js";

let newName = ""; // 新建分支输入框内容（跨重渲染保留，关闭菜单不清空）
let deleteConfirmRef = null; // 正在二次确认删除的分支名
let forceConfirmRef = null; // 未合并分支升级为强制删除的分支名

// 分支条目行：主体（✓ + 分支名 + ahead/behind + sha subject）+ 可选删除按钮。
// current 当前分支禁用高亮且不可删；disabled 用于「远程已有同名本地分支」等不可点场景。
function branchRow(entry, { current = false, disabled = false, title = "", deletable = false, onClick } = {}) {
  const row = el("div", "menu-entry branch-entry");
  // 删除为不可恢复操作：行内二次确认；未合并分支升级为「强制删除」确认
  if (deletable && (deleteConfirmRef === entry.name || forceConfirmRef === entry.name)) {
    const forcing = forceConfirmRef === entry.name;
    confirmUI(row, {
      question: (forcing ? t.branchDelForceConfirm : t.branchDelConfirm).replace("{name}", entry.name),
      yesLabel: forcing ? t.forceDelete : t.confirmYes,
      cancelLabel: t.cancel,
      onYes: () => {
        deleteConfirmRef = null;
        forceConfirmRef = null;
        runBranchDelete(entry.name, { force: forcing });
      },
      onCancel: () => {
        deleteConfirmRef = null;
        forceConfirmRef = null;
        renderBranchMenu();
      },
    });
    return row;
  }
  const main = el("button", "branch-main" + (current ? " current" : ""));
  main.disabled = current || disabled || busy;
  if (title) main.title = title;
  const nameLine = el("span", "branch-name");
  if (current) {
    const ic = el("span", "branch-check");
    ic.innerHTML = ICONS.check;
    nameLine.append(ic);
  }
  nameLine.append(el("span", "branch-name-text", entry.name));
  if (entry.ahead || entry.behind) {
    const badge = el("span", "branch-track");
    if (entry.ahead) badge.append(el("span", "ab-ahead", `↑${entry.ahead}`), document.createTextNode(" "));
    if (entry.behind) badge.append(el("span", "ab-behind", `↓${entry.behind}`));
    nameLine.append(badge);
  }
  const sub = [entry.sha, entry.subject].filter(Boolean).join(" ");
  main.append(nameLine, el("span", "branch-sub", sub));
  if (onClick && !main.disabled) {
    main.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  row.append(main);
  if (deletable && !current) {
    const del = document.createElement("button");
    del.className = "btn icon";
    del.innerHTML = ICONS.trash;
    del.title = t.branchDelete;
    del.disabled = busy;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConfirmRef = entry.name;
      renderBranchMenu();
    });
    row.append(del);
  }
  return row;
}

export function renderBranchMenu() {
  const menu = $("branch-menu");
  if (!branchOpen) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  menu.replaceChildren();

  // 新建分支：输入 + 创建按钮，Enter 与按钮等价
  const input = el("input", "branch-new-input");
  input.value = newName;
  input.placeholder = t.branchNewPlaceholder;
  input.spellcheck = false;
  input.maxLength = 120;
  input.disabled = busy;
  input.addEventListener("input", () => {
    newName = input.value;
  });
  const doCreate = () => {
    const name = newName.trim();
    if (!name || busy) return;
    runCheckout(name, { create: true });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doCreate();
    }
  });
  const createBtn = el("button", "btn icon branch-new-btn");
  createBtn.innerHTML = ICONS.plus;
  createBtn.title = t.branchCreate;
  createBtn.disabled = busy;
  createBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    doCreate();
  });
  const newRow = el("div", "branch-new");
  newRow.append(input, createBtn);
  menu.append(newRow, el("div", "menu-sep"));

  if (!branchState || branchState.phase === "loading") {
    menu.append(el("div", "menu-title", t.loading));
    return;
  }
  if (branchState.phase === "error") {
    menu.append(el("div", "menu-err", branchState.error));
    return;
  }
  const locals = branchState.locals || [];
  const remotes = branchState.remotes || [];
  const localNames = new Set(locals.map((b) => b.name));

  menu.append(el("div", "menu-title", `${t.branchLocals}（${locals.length}）`));
  if (locals.length === 0) {
    menu.append(el("div", "menu-title", t.branchEmpty));
  } else {
    const list = el("div", "menu-entries");
    for (const b of locals) {
      list.append(branchRow(b, { current: b.current, deletable: true, onClick: () => runCheckout(b.name) }));
    }
    menu.append(list);
  }

  menu.append(el("div", "menu-title", `${t.branchRemotes}（${remotes.length}）`));
  if (remotes.length === 0) {
    menu.append(el("div", "menu-title", t.branchEmpty));
  } else {
    const list = el("div", "menu-entries");
    for (const b of remotes) {
      // origin/feat-x -> 本地名 feat-x；同名本地分支已存在时禁用（checkout -b 会失败）
      const slash = b.name.indexOf("/");
      const local = slash > 0 ? b.name.slice(slash + 1) : b.name;
      const exists = localNames.has(local);
      list.append(
        branchRow(b, {
          disabled: exists,
          title: exists ? t.branchRemoteExists : t.branchFromRemote,
          onClick: () => runCheckout(local, { create: true, startPoint: b.name }),
        })
      );
    }
    menu.append(list);
  }
}

export async function loadBranchList() {
  deleteConfirmRef = null; // 列表重新拉取，挂起的确认作废
  forceConfirmRef = null;
  setBranchState({ phase: "loading", locals: [], remotes: [] });
  renderBranchMenu();
  try {
    const r = await callTool("git_branch_list", {});
    if (!branchOpen) return;
    setBranchState({
      phase: "ready",
      locals: Array.isArray(r?.locals) ? r.locals : [],
      remotes: Array.isArray(r?.remotes) ? r.remotes : [],
    });
  } catch (err) {
    if (!branchOpen) return;
    setBranchState({ phase: "error", locals: [], remotes: [], error: String(err?.message || err) });
  }
  renderBranchMenu();
}

export function closeBranchMenu() {
  setBranchOpen(false);
  setBranchState(null);
  deleteConfirmRef = null;
  forceConfirmRef = null;
  renderBranchMenu();
}

/** 删除本地分支：默认 -d（未合并被拒时升级为行内「强制删除」确认）；菜单保持打开便于连续删除。 */
export function runBranchDelete(name, { force = false } = {}) {
  return runAction(async () => {
    try {
      const r = await callTool("git_branch_delete", force ? { name, force: true } : { name });
      const line = String(r?.output || "").split("\n")[0].trim();
      if (line) toast(line, "ok");
    } catch (err) {
      if (!force && err?.code === "BRANCH_UNMERGED") {
        // 吞掉错误不走 toast：该行改渲染为「强制删除」确认
        forceConfirmRef = name;
        renderBranchMenu();
        return;
      }
      throw err;
    }
  }).then(() => {
    if (forceConfirmRef && branchOpen) {
      // 升级中的强制删除确认优先：此时列表未变，重拉会把它清掉
      renderBranchMenu();
      return;
    }
    // 删除后重拉列表：条目即时移除，且以非 busy 状态重渲染（否则行内按钮停留在禁用态）
    if (branchOpen) loadBranchList();
  });
}

/** 切换/新建分支：执行 → 关菜单 → toast git 输出首行（如 Switched to branch 'x'）；状态由 runAction 统一刷新。 */
export function runCheckout(branch, { create = false, startPoint } = {}) {
  return runAction(async () => {
    const args = { branch };
    if (create) args.create = true;
    if (startPoint) args.startPoint = startPoint;
    const r = await callTool("git_checkout", args);
    closeBranchMenu();
    const line = String(r?.output || "").split("\n")[0].trim();
    if (line) toast(line, "ok");
  });
}
