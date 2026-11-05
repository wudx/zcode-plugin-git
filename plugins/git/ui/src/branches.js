// ---------------------------------------------------------------------------
// 分支菜单：分支列表渲染与 checkout 动作流程
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import { busy, branchOpen, branchState, setBranchOpen, setBranchState } from "./state.js";
import { $, el } from "./dom.js";
import { runAction, toast } from "./actions.js";

let newName = ""; // 新建分支输入框内容（跨重渲染保留，关闭菜单不清空）

// 分支条目：主行（✓ + 分支名 + ahead/behind）+ 副行（sha subject）。
// current 当前分支禁用高亮；disabled 用于「远程已有同名本地分支」等不可点场景。
function branchItem(entry, { current = false, disabled = false, title = "", onClick } = {}) {
  const b = el("button", "menu-item branch-item" + (current ? " current" : ""));
  b.disabled = current || disabled || busy;
  if (title) b.title = title;
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
  b.append(nameLine, el("span", "branch-sub", sub));
  if (onClick && !b.disabled) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return b;
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
      list.append(branchItem(b, { current: b.current, onClick: () => runCheckout(b.name) }));
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
        branchItem(b, {
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
  renderBranchMenu();
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
