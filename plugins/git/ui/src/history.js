// ---------------------------------------------------------------------------
// 历史菜单：提交列表渲染、展开单条提交的文件列表（列表/树切换）、
// 点击文件再展开该文件的 diff、加载更多
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import {
  busy, historyOpen, historyState, splitDiff,
  setSplitDiff, setHistoryOpen, setHistoryState,
} from "./state.js";
import { lsGet, lsSet } from "./storage.js";
import { $, el, iconBtn, loadingEl } from "./dom.js";
import { badgeEl, treeEl } from "./rows.js";
import { unifiedView, splitView } from "./diffview.js";
import { extLang } from "./syntax.js";
import { render } from "./render.js";

const PAGE = 30; // 首屏与「加载更多」步长
const LIMIT_MAX = 100; // 与 server git_log 的参数上限一致
const VIEW_KEY = "zcode-git.historyView"; // 文件列表视图（列表/树），与工作区的 treeMode 分开记

let openHash = null; // 当前展开文件列表的提交（手风琴式，同时只展开一条）
let historyTree = lsGet(VIEW_KEY) === "tree";
// hash -> { loading, error, text, truncated, files, openPath }；关闭菜单时清空。
// files 由 text 按 "diff --git" 切段解析而来；openPath 为点开的文件路径
const cache = new Map();

// 按 "diff --git" 行切成每文件的 diff 段
function fileChunks(text) {
  const chunks = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ") || chunks.length === 0) chunks.push([]);
    chunks[chunks.length - 1].push(line);
  }
  return chunks.map((c) => c.join("\n"));
}

// 从整段 diff 解析文件条目：路径取 ---/+++ 行（deleted 时 +++ 为 /dev/null，
// 回退 --- 侧；server 端 core.quotepath=false，中文等路径不带引号）；
// 二进制段没有 ---/+++ 行，从 "diff --git a/x b/y" 头行兜底（空格路径按 " b/" 切分）
function parseFiles(text) {
  return fileChunks(text).map((chunk) => {
    const oldM = /^---\s+"?[ab]\/(.+?)"?\t?$/m.exec(chunk);
    const newM = /^\+\+\+\s+"?[ab]\/(.+?)"?\t?$/m.exec(chunk);
    let headOld = "";
    let headNew = "";
    if (!oldM && !newM) {
      const head = /^diff --git (.+)$/m.exec(chunk);
      if (head) {
        const idx = head[1].indexOf(" b/");
        if (idx >= 0) {
          headNew = head[1].slice(idx + 3);
          headOld = head[1].slice(2, idx);
        }
      }
    }
    const oldPath = (oldM ? oldM[1] : headOld) || "";
    const newPath = (newM ? newM[1] : headNew) || "";
    const path = newPath || oldPath;
    const origPath = oldPath && oldPath !== path ? oldPath : null;
    let code = "M";
    if (/^new file mode/m.test(chunk)) code = "A";
    else if (/^deleted file mode/m.test(chunk)) code = "D";
    else if (/^(rename|copy) from/m.test(chunk)) code = "R";
    const binary = /^Binary files /m.test(chunk) || /^GIT binary patch/m.test(chunk);
    return { path, origPath, code, binary, chunk };
  });
}

function toggleCommit(hash) {
  if (openHash === hash) {
    openHash = null;
    render();
    return;
  }
  openHash = hash;
  if (!cache.has(hash)) {
    const entry = { loading: true, error: "", text: "", truncated: false, files: [], openPath: null };
    cache.set(hash, entry);
    callTool("git_show", { hash })
      .then((r) => {
        if (cache.get(hash) !== entry) return;
        entry.loading = false;
        entry.text = r?.text || "";
        entry.truncated = !!r?.truncated;
        entry.files = parseFiles(entry.text);
      })
      .catch((err) => {
        if (cache.get(hash) !== entry) return;
        entry.loading = false;
        entry.error = String(err?.message || err).split("\n")[0];
      })
      .finally(() => {
        if (cache.get(hash) === entry && historyOpen) render();
      });
  }
  render();
}

function toggleSplit() {
  const next = !splitDiff;
  setSplitDiff(next);
  lsSet("zcode-git.diffView", next ? "split" : "unified");
  render();
}

// 展开提交后的文件区：文件条（计数 + 列表/树切换 + 收起）→ 文件列表 → 点开的文件 diff
function commitFilesEl(hash) {
  const box = el("div", "commit-diff");
  const d = cache.get(hash);
  if (!d || d.loading) {
    box.append(loadingEl(t.loading));
    return box;
  }
  if (d.error) {
    box.append(el("div", "menu-err", t.actionFailed + d.error));
    return box;
  }

  const bar = el("div", "commit-diff-bar commit-files-bar");
  bar.append(el("span", "commit-files-count", t.filesChanged.replace("{n}", String(d.files.length))));
  bar.append(
    iconBtn({
      icon: historyTree ? ICONS.list : ICONS.tree,
      title: historyTree ? t.viewList : t.viewTree,
      onClick: () => {
        historyTree = !historyTree;
        lsSet(VIEW_KEY, historyTree ? "tree" : "list");
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

  if (d.files.length === 0) {
    box.append(loadingEl(t.noDiff));
    return box;
  }

  const list = historyTree
    ? treeEl(d.files, null, (f, depth) => fileRowEl(hash, f, depth), "h")
    : el("div", "commit-file-list");
  if (!historyTree) for (const f of d.files) list.append(fileRowEl(hash, f));
  box.append(list);

  // 点开的文件：diff 以手风琴形式插在该文件行下方
  const open = d.openPath && d.files.find((f) => f.path === d.openPath);
  if (open) {
    const row = list.querySelector(`.commit-file[data-hpath="${CSS.escape(d.openPath)}"]`);
    const diff = fileDiffEl(hash, open);
    if (row) row.after(diff);
    else list.append(diff);
  }
  if (d.truncated) box.append(el("div", "menu-err", t.diffTooBig));
  return box;
}

// 文件行：徽标 + 路径（重命名显示 旧 → 新），点击切换该文件的 diff
function fileRowEl(hash, f, depth = 0) {
  const d = cache.get(hash);
  const row = el("div", "row commit-file" + (d?.openPath === f.path ? " expanded" : ""));
  row.dataset.hpath = f.path;
  if (depth > 0) row.style.paddingLeft = 12 + depth * 12 + "px";
  const main = el("div", "row-main");
  main.append(badgeEl(f.code));
  const label = f.origPath ? `${f.origPath} → ${f.path}` : f.path;
  const name = el("span", "path", f._name || label);
  name.title = label;
  main.append(name);
  row.append(main);
  main.addEventListener("click", () => {
    const entry = cache.get(hash);
    if (!entry) return;
    entry.openPath = entry.openPath === f.path ? null : f.path;
    render();
  });
  return row;
}

// 单个文件的 diff：工具栏（并排/统一切换 + 关闭）+ diff 体
function fileDiffEl(hash, f) {
  const box = el("div", "commit-diff commit-file-diff");
  const bar = el("div", "commit-diff-bar");
  bar.append(
    iconBtn({
      icon: splitDiff ? ICONS.unified : ICONS.split,
      title: splitDiff ? t.diffUnified : t.diffSplit,
      onClick: toggleSplit,
    }),
    iconBtn({
      icon: ICONS.close,
      title: t.noticeClose,
      cls: "diff-close",
      onClick: () => {
        const d = cache.get(hash);
        if (d) d.openPath = null;
        render();
      },
    }),
  );
  box.append(bar);

  const body = el("div", "commit-diff-body");
  if (f.binary) body.append(loadingEl(t.binaryFile));
  else if (!f.chunk.trim()) body.append(loadingEl(t.noDiff));
  else body.append(splitDiff ? splitView(f.chunk, extLang(f.path)) : unifiedView(f.chunk, extLang(f.path)));
  box.append(body);
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
  if (openHash === c.hash) wrap.append(commitFilesEl(c.hash));
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
  cache.clear();
  renderHistoryMenu();
}
