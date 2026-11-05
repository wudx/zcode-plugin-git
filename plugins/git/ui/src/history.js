// ---------------------------------------------------------------------------
// 历史菜单：提交列表渲染、展开单条提交的 diff、加载更多
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import {
  busy, historyOpen, historyState, splitDiff,
  setSplitDiff, setHistoryOpen, setHistoryState,
} from "./state.js";
import { lsSet } from "./storage.js";
import { $, el, iconBtn, loadingEl } from "./dom.js";
import { unifiedView, splitView } from "./diffview.js";
import { extLang } from "./syntax.js";
import { render } from "./render.js";

const PAGE = 30; // 首屏与「加载更多」步长
const LIMIT_MAX = 100; // 与 server git_log 的参数上限一致

let openHash = null; // 当前展开 diff 的提交（手风琴式，同时只展开一条）
let diffs = new Map(); // hash -> { loading, text, truncated, error }；关闭菜单时清空

// 按 "diff --git" 行切成每文件的 diff 段，供逐文件选语法高亮语言
function fileChunks(text) {
  const chunks = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ") || chunks.length === 0) chunks.push([]);
    chunks[chunks.length - 1].push(line);
  }
  return chunks.map((c) => c.join("\n"));
}

// 从段落里的 "+++ b/path" 行取路径，供 extLang 按扩展名选语言
function chunkPath(chunk) {
  const m = /^\+\+\+\s+"?b\/(.+?)"?\t?$/m.exec(chunk);
  return m ? m[1] : "";
}

function toggleCommit(hash) {
  if (openHash === hash) {
    openHash = null;
    render();
    return;
  }
  openHash = hash;
  if (!diffs.has(hash)) {
    const entry = { loading: true, text: "", truncated: false, error: "" };
    diffs.set(hash, entry);
    callTool("git_show", { hash })
      .then((r) => {
        if (diffs.get(hash) !== entry) return;
        entry.loading = false;
        entry.text = r?.text || "";
        entry.truncated = !!r?.truncated;
      })
      .catch((err) => {
        if (diffs.get(hash) !== entry) return;
        entry.loading = false;
        entry.error = String(err?.message || err).split("\n")[0];
      })
      .finally(() => {
        if (diffs.get(hash) === entry && historyOpen) render();
      });
  }
  render();
}

// 展开的 diff 区：工具栏（并排/统一切换 + 关闭）+ 逐文件渲染的 diff 体
function commitDiffEl(hash) {
  const box = el("div", "commit-diff");
  const bar = el("div", "commit-diff-bar");
  bar.append(
    iconBtn({
      icon: splitDiff ? ICONS.unified : ICONS.split,
      title: splitDiff ? t.diffUnified : t.diffSplit,
      onClick: () => {
        const next = !splitDiff;
        setSplitDiff(next);
        lsSet("zcode-git.diffView", next ? "split" : "unified");
        render();
      },
    }),
    iconBtn({
      icon: ICONS.close,
      title: t.noticeClose,
      cls: "diff-close",
      onClick: () => {
        openHash = null;
        render();
      },
    }),
  );
  box.append(bar);

  const d = diffs.get(hash);
  if (!d || d.loading) {
    box.append(loadingEl(t.loading));
    return box;
  }
  if (d.error) {
    box.append(el("div", "menu-err", t.actionFailed + d.error));
    return box;
  }
  if (!d.text.trim()) {
    box.append(loadingEl(t.noDiff));
    return box;
  }
  const body = el("div", "commit-diff-body");
  for (const chunk of fileChunks(d.text)) {
    const lang = extLang(chunkPath(chunk));
    body.append(splitDiff ? splitView(chunk, lang) : unifiedView(chunk, lang));
  }
  box.append(body);
  if (d.truncated) box.append(el("div", "menu-err", t.diffTooBig));
  return box;
}

function commitRow(c) {
  const wrap = el("div", "commit-entry");
  const main = el("button", "commit-main" + (openHash === c.hash ? " open" : ""));
  main.disabled = busy;
  const subject = el("span", "commit-subject", c.subject || "(no message)");
  subject.title = c.subject || ""; // 省略号截断时悬停看全文
  main.append(subject, el("span", "commit-sub", [c.hash, c.author, c.date].filter(Boolean).join(" ")));
  main.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCommit(c.hash);
  });
  wrap.append(main);
  if (openHash === c.hash) wrap.append(commitDiffEl(c.hash));
  return wrap;
}

export function renderHistoryMenu() {
  const menu = $("history-menu");
  if (!historyOpen) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  menu.replaceChildren();
  if (!historyState || historyState.phase === "loading") {
    menu.append(el("div", "menu-title", t.loading));
    return;
  }
  if (historyState.phase === "error") {
    menu.append(el("div", "menu-err", historyState.error));
    return;
  }
  const commits = historyState.commits || [];
  menu.append(el("div", "menu-title", `${t.historyList}（${commits.length}）`));
  if (commits.length === 0) {
    menu.append(el("div", "menu-title", t.historyEmpty));
    return;
  }
  const list = el("div", "menu-entries");
  for (const c of commits) list.append(commitRow(c));
  menu.append(list);
  // 拉满 limit 才可能有下一页；再点一次拿到不满的一页后按钮自然消失
  if (commits.length >= historyState.limit && historyState.limit < LIMIT_MAX) {
    const more = el("button", "btn history-more", t.historyMore);
    more.disabled = busy;
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      loadHistory(historyState.limit + PAGE);
    });
    menu.append(more);
  }
}

export async function loadHistory(limit = PAGE) {
  setHistoryState({ phase: "loading", commits: [], limit });
  renderHistoryMenu();
  try {
    const r = await callTool("git_log", { limit });
    if (!historyOpen) return;
    setHistoryState({ phase: "ready", commits: Array.isArray(r?.commits) ? r.commits : [], limit });
  } catch (err) {
    if (!historyOpen) return;
    setHistoryState({ phase: "error", commits: [], limit, error: String(err?.message || err) });
  }
  renderHistoryMenu();
}

export function closeHistory() {
  setHistoryOpen(false);
  setHistoryState(null);
  openHash = null;
  diffs.clear();
  renderHistoryMenu();
}
