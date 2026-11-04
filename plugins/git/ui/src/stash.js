// ---------------------------------------------------------------------------
// stash 菜单：菜单项渲染、列表加载与 pull/stash 系动作流程
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import { status, busy, stashOpen, stashState, setStashOpen, setStashState } from "./state.js";
import { $ } from "./dom.js";
import { runAction, toast } from "./actions.js";

function menuItem(icon, label, disabled, fn) {
  const b = document.createElement("button");
  b.className = "menu-item";
  b.disabled = disabled;
  const ic = document.createElement("span");
  ic.className = "menu-ic";
  ic.innerHTML = icon;
  const tx = document.createElement("span");
  tx.textContent = label;
  b.append(ic, tx);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    fn();
  });
  return b;
}

export function renderStashMenu() {
  const menu = $("stash-menu");
  if (!stashOpen) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  menu.replaceChildren();
  const stashes = status?.stashes ?? 0;
  const nothing = !status || ((status.staged || []).length + (status.unstaged || []).length === 0);
  menu.appendChild(
    menuItem(ICONS.stashIn, t.stashAll, nothing || busy, () => runGitAction("git_stash", {}))
  );
  menu.appendChild(
    menuItem(ICONS.stashOut, t.stashPop, stashes === 0 || busy, () => runGitAction("git_stash_pop", {}))
  );
  const sep = document.createElement("div");
  sep.className = "menu-sep";
  menu.appendChild(sep);
  const title = document.createElement("div");
  title.className = "menu-title";
  title.textContent =
    stashState && stashState.phase === "ready" ? `${t.stashList}（${stashState.entries.length}）` : t.stashList;
  menu.appendChild(title);
  if (!stashState || stashState.phase === "loading") {
    const p = document.createElement("div");
    p.className = "menu-title";
    p.textContent = t.loading;
    menu.appendChild(p);
  } else if (stashState.phase === "error") {
    const p = document.createElement("div");
    p.className = "menu-err";
    p.textContent = stashState.error;
    menu.appendChild(p);
  } else if (stashState.entries.length === 0) {
    const p = document.createElement("div");
    p.className = "menu-title";
    p.textContent = t.stashEmpty;
    menu.appendChild(p);
  } else {
    const list = document.createElement("div");
    list.className = "menu-entries";
    for (const entry of stashState.entries) {
      const rowE = document.createElement("div");
      rowE.className = "menu-entry";
      const msg = document.createElement("span");
      msg.className = "menu-entry-msg";
      msg.textContent = entry.message || entry.ref;
      msg.title = `${entry.ref} ${entry.message}`;
      const apply = document.createElement("button");
      apply.className = "btn icon";
      apply.innerHTML = ICONS.stashOut;
      apply.title = t.stashApply;
      apply.disabled = busy;
      apply.addEventListener("click", (e) => {
        e.stopPropagation();
        runGitAction("git_stash_apply", { ref: entry.ref });
      });
      rowE.append(msg, apply);
      list.appendChild(rowE);
    }
    menu.appendChild(list);
  }
}

export async function loadStashList() {
  setStashState({ phase: "loading", entries: [] });
  renderStashMenu();
  try {
    const r = await callTool("git_stash_list", {});
    if (!stashOpen) return;
    setStashState({ phase: "ready", entries: Array.isArray(r?.entries) ? r.entries : [] });
  } catch (err) {
    if (!stashOpen) return;
    setStashState({ phase: "error", entries: [], error: String(err?.message || err) });
  }
  renderStashMenu();
}

export function closeStash() {
  setStashOpen(false);
  setStashState(null);
  renderStashMenu();
}

/** pull / stash / pop / apply 共用流程：执行 → toast 输出首行 → 刷新状态与存储列表。 */
export function runGitAction(tool, args) {
  return runAction(async () => {
    const r = await callTool(tool, args);
    const line = String(r?.output || "").split("\n")[0].trim();
    if (line) toast(line, "ok");
  }).then(() => {
    if (stashOpen) loadStashList();
  });
}
