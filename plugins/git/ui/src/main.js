/* Git workbench panel for ZCode (MCP Apps view). */
import { App } from "@modelcontextprotocol/ext-apps";

const $ = (id) => document.getElementById(id);

const app = new App({ name: "git-panel", version: __APP_VERSION__ }); // 构建时由 build.mjs 注入 plugin.json 的版本

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const STR = {
  "zh-CN": {
    stagedChanges: "暂存的更改",
    worktreeChanges: "工作区更改",
    conflicts: "合并冲突",
    resolveMark: "标记已解决",
    untracked: "未跟踪",
    stage: "暂存",
    unstage: "取消暂存",
    discard: "撤销",
    confirmDiscard: "确认撤销?",
    deleteFile: "删除",
    confirmDelete: "确认删除?",
    confirmYes: "确认",
    cancel: "取消",
    stageAll: "全部暂存",
    unstageAll: "全部取消暂存",
    discardAll: "全部撤销",
    confirmDiscardAll: "确认全部撤销?",
    commit: "提交",
    aiGenerate: "AI 生成",
    commitPlaceholder: "输入提交信息，首行为标题…",
    cleanTree: "工作区很干净，没有需要提交的变更",
    binaryFile: "二进制文件，无法显示 diff",
    noDiff: "（暂无变更）",
    notRepo: "当前目录不是 Git 仓库",
    noGit: "未找到 git 可执行文件，请确认已安装 Git 并加入 PATH",
    committed: "已提交",
    aiFailed: "AI 生成失败：",
    noSampling: "宿主不支持模型采样。可在聊天中使用 /git:commit 命令生成提交信息。",
    aiThinking: "生成中…",
    nothingStaged: "请先暂存要提交的文件",
    actionFailed: "操作失败：",
    diffTooBig: "diff 过大，已截断",
    loading: "加载中…",
    stagedTip: "已暂存的内容将包含在提交中",
    pullTitle: "拉取远程更新（git pull）",
    stashMenu: "存储菜单",
    stashAll: "存储全部改动",
    stashPop: "恢复最近一次存储",
    stashApply: "应用这条存储（保留条目）",
    stashList: "存储列表",
    stashEmpty: "暂无存储",
    viewTree: "切换为树结构",
    viewList: "切换为列表",
    diffSplit: "并排比对",
    diffUnified: "统一视图",
    diffPrev: "上一个更改",
    diffNext: "下一个更改",
    aiBudgetHit: "输出预算被模型的思考过程耗尽，请再点一次重试",
    imgOldHead: "旧 · HEAD",
    imgNewIndex: "新 · 暂存",
    imgOldIndex: "旧 · 暂存",
    imgNewWorktree: "新 · 工作区",
    imgNew: "新",
    imgOld: "旧",
    imgTooLarge: "图片超过 2MB，未加载预览",
    imgLoadFail: "图片加载失败",
    promptCustomize: "自定义 AI 提示词",
    promptPlaceholder: "留空则只用默认规则。可写风格/语言/格式要求，如：用英文，conventional commits 格式",
    noticeClose: "关闭",
  },
  en: {
    stagedChanges: "Staged Changes",
    worktreeChanges: "Working Tree Changes",
    conflicts: "Merge Conflicts",
    resolveMark: "Mark resolved",
    untracked: "Untracked",
    stage: "Stage",
    unstage: "Unstage",
    discard: "Discard",
    confirmDiscard: "Confirm discard?",
    deleteFile: "Delete",
    confirmDelete: "Confirm delete?",
    confirmYes: "Confirm",
    cancel: "Cancel",
    stageAll: "Stage all",
    unstageAll: "Unstage all",
    discardAll: "Discard all",
    confirmDiscardAll: "Discard all changes?",
    commit: "Commit",
    aiGenerate: "AI Generate",
    commitPlaceholder: "Commit message, subject on the first line…",
    cleanTree: "Working tree clean — nothing to commit",
    binaryFile: "Binary file — diff not shown",
    noDiff: "(no changes)",
    notRepo: "Current directory is not a git repository",
    noGit: "git executable not found — please install Git and add it to PATH",
    committed: "Committed",
    aiFailed: "AI generate failed: ",
    noSampling: "Host does not support sampling. Use the /git:commit command in chat instead.",
    aiThinking: "Generating…",
    nothingStaged: "Stage some files first",
    actionFailed: "Action failed: ",
    diffTooBig: "diff truncated (too large)",
    loading: "Loading…",
    stagedTip: "Staged changes will be included in the commit",
    pullTitle: "Pull remote updates (git pull)",
    stashMenu: "Stash menu",
    stashAll: "Stash all changes",
    stashPop: "Pop latest stash",
    stashApply: "Apply this stash (keep the entry)",
    stashList: "Stash list",
    stashEmpty: "No stashes",
    viewTree: "Switch to tree view",
    viewList: "Switch to list view",
    diffSplit: "Side-by-side",
    diffUnified: "Unified",
    diffPrev: "Previous change",
    diffNext: "Next change",
    aiBudgetHit: "Token budget was consumed by model reasoning — please retry",
    imgOldHead: "Old · HEAD",
    imgNewIndex: "New · index",
    imgOldIndex: "Old · index",
    imgNewWorktree: "New · worktree",
    imgNew: "New",
    imgOld: "Old",
    imgTooLarge: "Image exceeds 2MB — preview skipped",
    imgLoadFail: "Image load failed",
    promptCustomize: "Custom AI prompt",
    promptPlaceholder: "Empty = default rules only. Add style/language requirements, e.g. English, conventional commits",
    noticeClose: "Close",
  },
};
let t = STR["zh-CN"];

function pickLocale(hint) {
  const s = (hint || "").toLowerCase();
  return s.startsWith("zh") ? STR["zh-CN"] : STR.en;
}

// ---------------------------------------------------------------------------
// inline icons (stroke: currentColor)
// ---------------------------------------------------------------------------

const SVG = (inner) =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  tree: SVG('<path d="M4 5h9M4 5v13M8 12h9M8 19h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  list: SVG('<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  pull: SVG('<path d="M12 3v11m0 0-4-4m4 4 4-4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  kebab: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
  split: SVG('<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M12 4v16" stroke="currentColor" stroke-width="2"/>'),
  unified: SVG('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  chgUp: SVG('<path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  chgDown: SVG('<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  sliders: SVG('<path d="M4 7h8M18 7h2M4 17h2M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15" cy="7" r="2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="17" r="2" stroke="currentColor" stroke-width="2"/>'),
  stashIn: SVG('<path d="M12 3v8m0 0-3-3m3 3 3-3M4 13v7h16v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  stashOut: SVG('<path d="M12 12V3m0 0-3 3m3-3 3 3M4 13v7h16v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  minus: SVG('<path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  undo: SVG('<path d="M3 4v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 15a9 9 0 1 0 2.1-9.4L3 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  trash: SVG('<path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
};

// ---------------------------------------------------------------------------
// persisted prefs (localStorage may be unavailable — degrade to session-only)
// ---------------------------------------------------------------------------

function lsGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* session-only */
  }
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let status = null;
let expanded = new Map(); // key -> { loading, entry, staged, diff }
let busy = false;
let lastStatusJson = "";
let treeMode = lsGet("zcode-git.view") === "tree";
let splitDiff = lsGet("zcode-git.diffView") === "split";
// diff 上下文范围：line=±10 行；line20=±20 行；file=整个文件
let diffScope = ["line", "line20", "file"].includes(lsGet("zcode-git.scope")) ? lsGet("zcode-git.scope") : "line";
let customPrompt = lsGet("zcode-git.customPrompt") ?? "";
let promptOpen = customPrompt !== "";
let collapsedDirs = new Set(); // "area:dir/path" -> collapsed
let stashOpen = false;
let stashState = null; // null | { phase: 'loading'|'ready'|'error', entries, error }

// 上下文范围切换按钮的文案与循环顺序
const SCOPE_ORDER = ["line", "line20", "file"];
function scopeLabel(scope) {
  const zh = t === STR["zh-CN"];
  if (scope === "line20") return zh ? "±20 行" : "±20 lines";
  if (scope === "file") return zh ? "整个文件" : "whole file";
  return zh ? "±10 行" : "±10 lines";
}
// scope → git_diff 参数：±20 档复用 scope=line + context=20
function scopeArgs(scope) {
  if (scope === "line20") return { scope: "line", context: 20 };
  return { scope: scope || "line" };
}
function nextScope(scope) {
  return SCOPE_ORDER[(SCOPE_ORDER.indexOf(scope || "line") + 1) % SCOPE_ORDER.length];
}
function scopeTitle(scope) {
  const zh = t === STR["zh-CN"];
  return zh
    ? `上下文范围：${scopeLabel(scope)}（点击切换为${scopeLabel(nextScope(scope))}）`
    : `Context: ${scopeLabel(scope)} (click for ${scopeLabel(nextScope(scope))})`;
}

function keyOf(staged, p) {
  return (staged ? "s:" : "w:") + p;
}

async function callTool(name, args) {
  const res = await app.callServerTool({ name, arguments: args });
  let payload = null;
  const raw = res?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (res?.isError) {
    throw new Error(payload?.error || raw || `tool ${name} failed`);
  }
  return payload;
}

function isNoRepo(err) {
  return /不是 Git 仓库|not a git repository/i.test(String(err?.message || ""));
}
function isNoGit(err) {
  return /未找到 git|not found/i.test(String(err?.message || ""));
}

/** 应用一次 git_status 结果：正常则渲染，非仓库等状态显示致命提示。 */
function applyStatus(fresh) {
  status = fresh;
  lastStatusJson = JSON.stringify(fresh);
  if (fresh && fresh.ok !== false) {
    $("fatal").hidden = true;
    reconcileExpanded(fresh);
    render();
  } else {
    const msg = fresh?.reason === "not_a_git_repo" ? t.notRepo : String(fresh?.error || "unknown");
    showFatal(msg + (fresh?.cwd ? "\n" + fresh.cwd : ""));
  }
}

async function refresh() {
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

function showFatal(msg) {
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

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

const BADGE = {
  A: ["A", "b-add"], M: ["M", "b-mod"], D: ["D", "b-del"], R: ["R", "b-ren"],
  C: ["C", "b-ren"], T: ["T", "b-mod"], "?": ["?", "b-new"], U: ["U", "b-conf"],
};

function badgeEl(code) {
  const [ch, cls] = BADGE[code] || [code, "b-mod"];
  const el = document.createElement("span");
  el.className = "badge " + cls;
  el.textContent = ch;
  return el;
}

function rowEl(entry, staged, depth = 0) {
  const row = document.createElement("div");
  row.className = "row";
  const key = keyOf(staged, entry.path);
  row.dataset.key = key;
  if (depth > 0) row.style.paddingLeft = 12 + depth * 12 + "px";

  const main = document.createElement("div");
  main.className = "row-main";
  main.appendChild(badgeEl(entry.code));
  const name = document.createElement("span");
  name.className = "path";
  name.textContent = entry._name || (entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path);
  name.title = entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path;
  main.appendChild(name);
  row.appendChild(main);

  const btns = document.createElement("div");
  btns.className = "row-btns";
  btns.addEventListener("click", (e) => e.stopPropagation());
  row.appendChild(btns);

  const isUntracked = entry.code === "?" && !staged && !entry.unmerged;

  // 悬停浮现的图标按钮
  const ibtn = (icon, title, cls, fn) => {
    const b = document.createElement("button");
    b.className = "btn icon" + (cls ? " " + cls : "");
    b.innerHTML = icon;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };

  // 危险操作的行内二次确认：图标行替换为「确认？[确认][取消]」
  let confirming = false;
  const renderBtns = () => {
    btns.replaceChildren();
    if (confirming) {
      const q = document.createElement("span");
      q.className = "confirm-q";
      q.textContent = isUntracked ? t.confirmDelete : t.confirmDiscard;
      const yes = document.createElement("button");
      yes.className = "btn danger";
      yes.textContent = t.confirmYes;
      yes.addEventListener("click", (e) => {
        e.stopPropagation();
        confirming = false;
        runAction(() => callTool("git_discard", { paths: [entry.path] }));
      });
      const no = document.createElement("button");
      no.textContent = t.cancel;
      no.addEventListener("click", (e) => {
        e.stopPropagation();
        confirming = false;
        renderBtns();
      });
      btns.append(q, yes, no);
      return;
    }
    if (entry.unmerged) {
      btns.appendChild(ibtn(ICONS.plus, t.resolveMark, "", () => runAction(() => callTool("git_stage", { paths: [entry.path] }))));
    } else if (staged) {
      btns.appendChild(ibtn(ICONS.minus, t.unstage, "", () => runAction(() => callTool("git_unstage", { paths: [entry.path] }))));
    } else if (isUntracked) {
      btns.appendChild(ibtn(ICONS.plus, t.stage, "primary", () => runAction(() => callTool("git_stage", { paths: [entry.path] }))));
      btns.appendChild(ibtn(ICONS.trash, t.deleteFile, "danger", () => { confirming = true; renderBtns(); }));
    } else {
      btns.appendChild(ibtn(ICONS.plus, t.stage, "primary", () => runAction(() => callTool("git_stage", { paths: [entry.path] }))));
      btns.appendChild(ibtn(ICONS.undo, t.discard, "danger", () => { confirming = true; renderBtns(); }));
    }
  };
  renderBtns();

  main.addEventListener("click", () => toggleDiff(row, entry, staged));
  return row;
}

// ---------------------------------------------------------------------------
// tree view
// ---------------------------------------------------------------------------

function buildTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const e of entries) {
    const segs = e.path.split("/");
    let node = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      let child = node.dirs.get(segs[i]);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(segs[i], child);
      }
      node = child;
    }
    node.files.push({ ...e, _name: segs[segs.length - 1] });
  }
  return root;
}

function treeEl(entries, staged) {
  const area = staged ? "s" : "w";
  const box = document.createElement("div");
  box.className = "tree";
  const rec = (node, basePath, depth) => {
    for (const dname of [...node.dirs.keys()].sort()) {
      // 折叠单链目录：没有直属文件且只有一个子目录时合并显示为 a/b/c。
      let name = dname;
      let target = node.dirs.get(dname);
      while (target.files.length === 0 && target.dirs.size === 1) {
        const only = [...target.dirs.keys()][0];
        name += "/" + only;
        target = target.dirs.get(only);
      }
      const dirPath = basePath ? `${basePath}/${name}` : name;
      const dkey = `${area}:${dirPath}`;
      const collapsed = collapsedDirs.has(dkey);
      const drow = document.createElement("div");
      drow.className = "tree-dir";
      drow.style.paddingLeft = 10 + depth * 12 + "px";
      const chev = document.createElement("span");
      chev.className = "chev" + (collapsed ? " collapsed" : "");
      chev.textContent = "▾";
      const label = document.createElement("span");
      label.className = "tree-dir-name";
      label.textContent = name;
      label.title = dirPath;
      drow.append(chev, label);
      drow.addEventListener("click", () => {
        if (collapsedDirs.has(dkey)) collapsedDirs.delete(dkey);
        else collapsedDirs.add(dkey);
        render();
      });
      box.appendChild(drow);
      if (!collapsed) rec(target, dirPath, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => String(a._name).localeCompare(String(b._name)))) {
      box.appendChild(rowEl(f, staged, depth));
    }
  };
  rec(buildTree(entries), "", 0);
  return box;
}

// ---------------------------------------------------------------------------
// diff views
// ---------------------------------------------------------------------------

// 图片扩展名：二进制 diff 改走「旧版 | 新版」图片比对
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;

/** 图片比对的两个版本：与文本 diff 的对比基准保持一致。 */
function imageSides(entry, staged) {
  if (staged) {
    if (entry.code === "D") return { oldSpec: { path: entry.path, rev: "HEAD" }, oldLabel: t.imgOldHead };
    if (entry.origPath) {
      return {
        oldSpec: { path: entry.origPath, rev: "HEAD" },
        oldLabel: t.imgOldHead,
        newSpec: { path: entry.path, rev: "index" },
        newLabel: t.imgNewIndex,
      };
    }
    return {
      oldSpec: { path: entry.path, rev: "HEAD" },
      oldLabel: t.imgOldHead,
      newSpec: { path: entry.path, rev: "index" },
      newLabel: t.imgNewIndex,
    };
  }
  if (entry.code === "?") return { newSpec: { path: entry.path, rev: "worktree" }, newLabel: t.imgNew };
  if (entry.code === "D") return { oldSpec: { path: entry.path, rev: "index" }, oldLabel: t.imgOldIndex };
  if (entry.origPath) {
    return {
      oldSpec: { path: entry.origPath, rev: "index" },
      oldLabel: t.imgOldIndex,
      newSpec: { path: entry.path, rev: "worktree" },
      newLabel: t.imgNewWorktree,
    };
  }
  return {
    oldSpec: { path: entry.path, rev: "index" },
    oldLabel: t.imgOldIndex,
    newSpec: { path: entry.path, rev: "worktree" },
    newLabel: t.imgNewWorktree,
  };
}

async function loadImages(info) {
  const sides = imageSides(info.entry, info.staged);
  const images = { phase: "loading" };
  info.images = images;
  const fetchOne = async (spec) => {
    try {
      const r = await callTool("git_blob", spec);
      if (r?.tooLarge) return { error: "tooLarge" };
      if (r?.base64) return { mime: r.mime, base64: r.base64 };
      return { error: "unsupported" };
    } catch (err) {
      return { error: String(err?.message || err).split("\n")[0] };
    }
  };
  const [oldImg, newImg] = await Promise.all([
    sides.oldSpec ? fetchOne(sides.oldSpec) : Promise.resolve(null),
    sides.newSpec ? fetchOne(sides.newSpec) : Promise.resolve(null),
  ]);
  if (info.images !== images) return; // 行已收起/迁移
  images.phase = "ready";
  if (oldImg) {
    images.old = oldImg;
    images.oldLabel = sides.oldLabel;
  }
  if (newImg) {
    images.new = newImg;
    images.newLabel = sides.newLabel;
  }
  render();
}

function imageCompareEl(info) {
  const wrap = document.createElement("div");
  wrap.className = "imgcmp";
  const imgs = info.images;
  if (!imgs || imgs.phase === "loading") {
    const p = document.createElement("div");
    p.className = "diff-loading";
    p.textContent = t.loading;
    wrap.appendChild(p);
    return wrap;
  }
  const panes = [];
  if (imgs.old) panes.push({ label: imgs.oldLabel, data: imgs.old });
  if (imgs.new) panes.push({ label: imgs.newLabel, data: imgs.new });
  if (!panes.length) {
    const p = document.createElement("div");
    p.className = "diff-loading";
    const err = imgs.old?.error || imgs.new?.error || "";
    p.textContent = err === "tooLarge" ? t.imgTooLarge : `${t.imgLoadFail}${err ? "：" + err : ""}`;
    wrap.appendChild(p);
    return wrap;
  }
  for (const pane of panes) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = pane.label;
    fig.appendChild(cap);
    if (pane.data.error) {
      const s = document.createElement("span");
      s.className = "img-err";
      s.textContent = pane.data.error === "tooLarge" ? t.imgTooLarge : t.imgLoadFail;
      fig.appendChild(s);
    } else {
      const img = document.createElement("img");
      img.src = `data:${pane.data.mime};base64,${pane.data.base64}`;
      img.alt = pane.label;
      fig.appendChild(img);
    }
    wrap.appendChild(fig);
  }
  return wrap;
}

function diffEl(key) {
  const info = expanded.get(key);
  const box = document.createElement("div");
  box.className = "diff-box";
  const d = info.diff;
  const isImage = !!(d && d.binary && !info.entry.unmerged && IMAGE_RE.test(info.entry.path));
  const bar = document.createElement("div");
  bar.className = "diff-bar";
  // “上一个/下一个更改”跳转：目标为每段连续增删行的首行（.chg-start）
  const jumpChange = (dir) => {
    const view = box.querySelector(".diff, .split-scroll");
    if (!view) return;
    const targets = [...view.querySelectorAll(".chg-start")];
    if (targets.length === 0) return;
    const rel = targets.map((el) => el.getBoundingClientRect().top - view.getBoundingClientRect().top);
    let cur = -1; // 顶部已到达的最后一个更改
    for (let i = 0; i < rel.length; i += 1) if (rel[i] < 10) cur = i;
    let i;
    if (dir > 0) {
      i = Math.min(cur + 1, targets.length - 1);
    } else if (cur >= 0 && rel[cur] > -24) {
      i = cur - 1; // 已正贴在某个更改上 → 跳到它的上一处
    } else {
      i = Math.max(cur, 0); // 已深滚过 → 先回到当前这处
    }
    i = Math.max(i, 0);
    view.scrollTop += targets[i].getBoundingClientRect().top - view.getBoundingClientRect().top - 8;
  };
  let chgBtns = null;
  if (!isImage) {
    // 上下文范围切换：±10 行 → ±20 行 → 整个文件
    const scopeBtn = document.createElement("button");
    scopeBtn.className = "btn scope";
    scopeBtn.textContent = scopeLabel(info.scope || "line");
    scopeBtn.title = scopeTitle(info.scope || "line");
    scopeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      diffScope = nextScope(info.scope || "line");
      lsSet("zcode-git.scope", diffScope);
      // 以新范围重新拉取当前 diff
      info.scope = diffScope;
      info.diff = null;
      info.loading = true;
      info.pending = false;
      render();
    });
    bar.appendChild(scopeBtn);
    const chgBtn = (dir) => {
      const b = document.createElement("button");
      b.className = "btn icon";
      b.innerHTML = dir > 0 ? ICONS.chgDown : ICONS.chgUp;
      b.title = dir > 0 ? t.diffNext : t.diffPrev;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        jumpChange(dir);
      });
      return b;
    };
    chgBtns = [chgBtn(-1), chgBtn(1)];
    bar.appendChild(chgBtns[0]);
    bar.appendChild(chgBtns[1]);
    const toggle = document.createElement("button");
    toggle.className = "btn icon";
    toggle.innerHTML = splitDiff ? ICONS.unified : ICONS.split;
    toggle.title = splitDiff ? t.diffUnified : t.diffSplit;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      splitDiff = !splitDiff;
      lsSet("zcode-git.diffView", splitDiff ? "split" : "unified");
      render();
    });
    bar.appendChild(toggle);
  }
  const close = document.createElement("button");
  close.className = "btn icon diff-close";
  close.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  close.title = t.noticeClose;
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded.delete(key);
    render();
  });
  bar.appendChild(close);
  box.appendChild(bar);

  if (info.loading || !info.diff) {
    const p = document.createElement("div");
    p.className = "diff-loading";
    p.textContent = t.loading;
    box.appendChild(p);
    return box;
  }
  if (isImage) {
    box.appendChild(imageCompareEl(info));
    return box;
  }
  if (d.binary) {
    const p = document.createElement("div");
    p.className = "diff-loading";
    p.textContent = t.binaryFile;
    box.appendChild(p);
    return box;
  }
  if (!d.text || !d.text.trim()) {
    const p = document.createElement("div");
    p.className = "diff-loading";
    p.textContent = t.noDiff;
    box.appendChild(p);
    return box;
  }
  box.appendChild(splitDiff ? splitView(d.text) : unifiedView(d.text));
  // 无增删行（如纯文件模式变更）时禁用跳转按钮
  if (chgBtns) {
    const anyChg = box.querySelector(".chg-start") !== null;
    chgBtns[0].disabled = !anyChg;
    chgBtns[1].disabled = !anyChg;
  }
  // 迷你地图由调用方在挂载后同步调用 attachMinimap（不依赖 rAF：后台不可见时帧回调被暂停）
  return box;
}

/**
 * diff 迷你地图（仿 VS Code）：滚动区右侧按行绘制彩色缩略条
 * （增=绿、删=红、上下文=灰、hunk=蓝），叠加视口指示块，随滚动同步；
 * 点击/拖动地图直接滚动。内容不溢出时也显示（视口铺满整条，点击无操作），保持布局统一。
 */
function attachMinimap(box) {
  if (!box.isConnected) return;
  const view = box.querySelector(".diff, .split-scroll");
  if (!view) return;
  const doc = view.ownerDocument;
  const MAP_W = 40;
  const map = doc.createElement("div");
  map.className = "minimap";
  const canvas = doc.createElement("canvas");
  const ind = doc.createElement("div");
  ind.className = "minimap-view";
  map.appendChild(canvas);
  map.appendChild(ind);

  const dpr = doc.defaultView.devicePixelRatio || 1;
  const mapH = view.clientHeight;
  canvas.width = Math.round(MAP_W * dpr);
  canvas.height = Math.round(mapH * dpr);
  canvas.style.width = MAP_W + "px";
  canvas.style.height = mapH + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // 主题色：canvas 读不了 CSS 变量，取计算值
  const cs = getComputedStyle(doc.documentElement);
  const vc = (n, fb) => (cs.getPropertyValue(n) || "").trim() || fb;
  const C = {
    add: vc("--git-add", "#3fb968"),
    del: vc("--git-del", "#f2555a"),
    hunk: vc("--git-ren", "#58a6ff"),
    meta: vc("--git-fg-dim", "#9d9da7"),
    ctx: vc("--git-fg-dim", "#9d9da7"),
  };

  // 收集缩略条：indent/len 为字符列，x0+cols 约束绘制区间（并排视图分左右两半）
  const bars = [];
  const pushBar = (text, color, x0, cols) => {
    const t = text.trim();
    if (!t) return;
    bars.push({ indent: text.length - text.replace(/^\s+/, "").length, len: t.length, color, x0, cols });
  };
  if (view.classList.contains("diff")) {
    for (const span of view.children) {
      const txt = span.textContent;
      let color = C.meta;
      if (span.classList.contains("dl-add")) color = C.add;
      else if (span.classList.contains("dl-del")) color = C.del;
      else if (span.classList.contains("dl-hunk")) color = C.hunk;
      else if (txt.startsWith(" ")) color = C.ctx; // 上下文行与文件头同为 dl-meta，按内容区分
      pushBar(txt, color, 3, 80);
    }
  } else {
    const ch = [...view.querySelector(".split-grid").children];
    const halfW = (MAP_W - 6) / 2;
    for (let i = 0; i < ch.length; ) {
      if (ch[i].classList.contains("cell-span")) {
        pushBar(ch[i].textContent, ch[i].classList.contains("dl-hunk") ? C.hunk : C.meta, 3, 120);
        i += 1;
        continue;
      }
      pushBar(ch[i + 1]?.textContent ?? "", ch[i + 1]?.classList.contains("cell-del") ? C.del : C.ctx, 3, 60);
      pushBar(ch[i + 3]?.textContent ?? "", ch[i + 3]?.classList.contains("cell-add") ? C.add : C.ctx, 3 + halfW, 60);
      i += 4;
    }
  }
  if (bars.length === 0) return;

  let rowH = Math.min(3, mapH / bars.length);
  if (bars.length * rowH > mapH) rowH = mapH / bars.length; // 行数过多时整体压缩
  const barH = Math.max(0.7, rowH * 0.7);
  const mapContentH = bars.length * rowH;
  ctx.globalAlpha = 0.8;
  bars.forEach((b, i) => {
    const colW = (MAP_W - 6) / b.cols;
    const x = b.x0 + Math.min(b.indent, b.cols) * colW;
    const w = Math.max(2, Math.min(b.len, b.cols - Math.min(b.indent, b.cols)) * colW);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, i * rowH, w, barH);
  });

  const scrollable = view.scrollHeight - view.clientHeight > 2;
  map.style.cursor = scrollable ? "pointer" : "default";
  const update = () => {
    ind.style.top = (view.scrollTop / view.scrollHeight) * mapContentH + "px";
    ind.style.height = Math.min(mapContentH, Math.max(14, (view.clientHeight / view.scrollHeight) * mapContentH)) + "px";
  };
  view.addEventListener("scroll", update, { passive: true });

  // 点击/拖动：点击点按比例映射到内容位置并居中视口
  const seek = (clientY) => {
    const r = map.getBoundingClientRect();
    const target = ((clientY - r.top) / mapContentH) * view.scrollHeight - view.clientHeight / 2;
    view.scrollTop = Math.max(0, Math.min(target, view.scrollHeight - view.clientHeight));
  };
  map.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      map.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件等无有效指针 id 时忽略，拖动退化为仅点击定位
    }
    seek(e.clientY);
    const move = (ev) => seek(ev.clientY);
    const up = () => {
      map.removeEventListener("pointermove", move);
      map.removeEventListener("pointerup", up);
      map.removeEventListener("pointercancel", up);
    };
    map.addEventListener("pointermove", move);
    map.addEventListener("pointerup", up);
    map.addEventListener("pointercancel", up);
  });

  // 给地图让位，原生滚动条随之内移
  view.style.marginRight = MAP_W + 6 + "px";
  map.style.top = view.offsetTop + "px";
  map.style.height = mapH + "px";
  box.appendChild(map);
  update();
}

function unifiedView(text) {
  const pre = document.createElement("pre");
  pre.className = "diff";
  // 行元素在 CSS 里是 display:block，自带换行；这里不能再补 "\n" 文本节点，
  // 否则 pre(white-space:pre) 下每行后都会多出一个空行
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let prevChg = false;
  let oldNo = null;
  let newNo = null;
  for (const line of lines) {
    const span = document.createElement("span");
    span.className = diffLineClass(line);
    span.textContent = line || " "; // 空行用空格撑出行高
    // 行号沟槽：删除行显示旧文件行号，新增/上下文行显示新文件行号（GitHub 统一视图样式）；
    // 走 data-ln + CSS ::before 渲染，textContent 保持纯代码，迷你地图解析不受影响
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hm) {
      oldNo = Number.parseInt(hm[1], 10);
      newNo = Number.parseInt(hm[2], 10);
    } else if (line.startsWith("+")) {
      span.dataset.ln = newNo ?? "";
      if (newNo !== null) newNo += 1;
    } else if (line.startsWith("-")) {
      span.dataset.ln = oldNo ?? "";
      if (oldNo !== null) oldNo += 1;
    } else if (!line.startsWith("\\") && !line.startsWith("diff ") && !line.startsWith("index ") &&
               !line.startsWith("--- ") && !line.startsWith("+++ ")) {
      span.dataset.ln = newNo ?? ""; // 上下文行
      if (oldNo !== null) oldNo += 1;
      if (newNo !== null) newNo += 1;
    }
    const chg = span.className === "dl-add" || span.className === "dl-del";
    if (chg && !prevChg) span.classList.add("chg-start"); // 每段连续增删行的首行，供上/下一个更改跳转
    prevChg = chg;
    pre.appendChild(span);
  }
  return pre;
}

function diffLineClass(line) {
  if (line.startsWith("@@")) return "dl-hunk";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "dl-meta";
  if (line.startsWith("+")) return "dl-add";
  if (line.startsWith("-")) return "dl-del";
  return "dl-meta";
}

/**
 * 把 unified diff 拆成并排行：连续的删除行与新增行按顺序左右配对，
 * 多出的一侧留空；hunk 头与文件头为跨全宽的整行。带行号沟槽。
 */
function parseSplitRows(text) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  let left = [];
  let right = [];
  let oldNo = null;
  let newNo = null;
  let prevChg = false;
  const pushPair = (l, r) => {
    const chg = (l !== null && l.text.startsWith("-")) || (r !== null && r.text.startsWith("+"));
    rows.push({ kind: "pair", left: l, right: r, chgStart: chg && !prevChg });
    prevChg = chg;
  };
  const flush = () => {
    const count = Math.max(left.length, right.length);
    for (let i = 0; i < count; i += 1) pushPair(left[i] ?? null, right[i] ?? null);
    left = [];
    right = [];
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = m === null ? null : Number.parseInt(m[1], 10);
      newNo = m === null ? null : Number.parseInt(m[2], 10);
      rows.push({ kind: "hunk", text: line });
      prevChg = false; // hunk 头断开更改段
    } else if (
      line.startsWith("diff ") || line.startsWith("index ") ||
      line.startsWith("--- ") || line.startsWith("+++ ")
    ) {
      flush();
      rows.push({ kind: "meta", text: line });
      prevChg = false; // 文件头断开更改段
    } else if (line.startsWith("-")) {
      if (right.length > 0) flush(); // 异常顺序（新增后紧跟删除）时先结算，保证左右不串行
      left.push({ no: oldNo, text: line });
      if (oldNo !== null) oldNo += 1;
    } else if (line.startsWith("+")) {
      right.push({ no: newNo, text: line });
      if (newNo !== null) newNo += 1;
    } else if (line.startsWith("\\")) {
      // “\ No newline at end of file”：并排视图不单独占行
    } else {
      flush();
      pushPair({ no: oldNo, text: line }, { no: newNo, text: line });
      if (oldNo !== null) oldNo += 1;
      if (newNo !== null) newNo += 1;
    }
  }
  flush();
  return rows;
}

function splitView(text) {
  const grid = document.createElement("div");
  grid.className = "split-grid";
  const cell = (cls, txt) => {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = txt === "" || txt == null ? " " : txt;
    return s;
  };
  parseSplitRows(text).forEach((row) => {
    if (row.kind !== "pair") {
      grid.appendChild(cell(`cell-span ${row.kind === "hunk" ? "dl-hunk" : "dl-meta"}`, row.text));
      return;
    }
    const lTone = row.left !== null && row.left.text.startsWith("-") ? " cell-del" : "";
    const rTone = row.right !== null && row.right.text.startsWith("+") ? " cell-add" : "";
    const lNum = cell("cell-num", row.left === null ? "" : row.left.no ?? "");
    if (row.chgStart) lNum.classList.add("chg-start"); // 每段连续增删行的首行，供上/下一个更改跳转
    grid.appendChild(lNum);
    grid.appendChild(cell("cell-code" + lTone, row.left === null ? "" : row.left.text));
    grid.appendChild(cell("cell-num num-r", row.right === null ? "" : row.right.no ?? ""));
    grid.appendChild(cell("cell-code" + rTone, row.right === null ? "" : row.right.text));
  });
  const scroll = document.createElement("div");
  scroll.className = "split-scroll";
  scroll.appendChild(grid);
  return scroll;
}

// ---------------------------------------------------------------------------
// main render
// ---------------------------------------------------------------------------

function render() {
  if (!status) return;
  const br = $("branch");
  br.textContent = status.detached ? "(detached)" : status.branch || "…";
  br.title = status.repo || "";
  const ab = $("ahead-behind");
  if (status.upstream && (status.ahead || status.behind)) {
    ab.textContent = `↑${status.ahead} ↓${status.behind}`;
    ab.hidden = false;
  } else ab.hidden = true;

  // stash 角标
  const stashes = status.stashes || 0;
  const badge = $("stash-badge");
  badge.hidden = stashes === 0;
  badge.textContent = stashes > 99 ? "99+" : String(stashes);
  $("stash-btn").title = stashes ? `${t.stashMenu}（${stashes}）` : t.stashMenu;

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
  $("staged-empty").hidden = staged.length > 0;
  $("worktree-empty").hidden = unstaged.length > 0;
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
    const q = document.createElement("span");
    q.className = "confirm-q";
    q.textContent = t.confirmDiscardAll;
    const yes = document.createElement("button");
    yes.className = "btn danger";
    yes.textContent = t.confirmYes;
    yes.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
    yes.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") showIcon();
    });
    slot.replaceChildren(q, yes);
    yes.focus();
  };
  const showIcon = () => {
    const b = document.createElement("button");
    b.className = "btn icon";
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (needConfirm) showConfirm();
      else run();
    });
    slot.replaceChildren(b);
  };
  slot.addEventListener("focusout", (e) => {
    if (!slot.contains(e.relatedTarget)) showIcon();
  });
  showIcon();
}

function toggleDiff(row, entry, staged) {
  const key = keyOf(staged, entry.path);
  if (expanded.has(key)) {
    expanded.delete(key);
    render();
    return;
  }
  expanded.set(key, { loading: true, entry, staged, diff: null, scope: diffScope });
  render();
}

function updateCommitBar(stagedCount) {
  $("commit-btn").disabled = busy || stagedCount === 0;
  $("commit-btn").textContent = stagedCount ? `${t.commit} (${stagedCount})` : t.commit;
  $("commit-btn").title = stagedCount === 0 ? t.nothingStaged : t.stagedTip;
}

// ---------------------------------------------------------------------------
// stash menu
// ---------------------------------------------------------------------------

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

function renderStashMenu() {
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

async function loadStashList() {
  stashState = { phase: "loading", entries: [] };
  renderStashMenu();
  try {
    const r = await callTool("git_stash_list", {});
    if (!stashOpen) return;
    stashState = { phase: "ready", entries: Array.isArray(r?.entries) ? r.entries : [] };
  } catch (err) {
    if (!stashOpen) return;
    stashState = { phase: "error", entries: [], error: String(err?.message || err) };
  }
  renderStashMenu();
}

function closeStash() {
  stashOpen = false;
  stashState = null;
  renderStashMenu();
}

/** pull / stash / pop / apply 共用流程：执行 → toast 输出首行 → 刷新状态与存储列表。 */
function runGitAction(tool, args) {
  return runAction(async () => {
    const r = await callTool(tool, args);
    const line = String(r?.output || "").split("\n")[0].trim();
    if (line) toast(line, "ok");
  }).then(() => {
    if (stashOpen) loadStashList();
  });
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

async function runAction(fn) {
  if (busy) return;
  busy = true;
  for (const id of ["view-btn", "pull-btn", "stash-btn"]) $(id).disabled = true;
  try {
    await fn();
    await refresh();
  } catch (err) {
    toast(t.actionFailed + String(err.message || err).split("\n")[0], "err");
  } finally {
    busy = false;
    for (const id of ["view-btn", "pull-btn", "stash-btn"]) $(id).disabled = false;
    updateCommitBar(status?.staged?.length || 0);
  }
}

// Toast: success auto-dismisses; errors stay until closed manually.
let toastTimer = null;
function toast(msg, tone) {
  const el = $("toast");
  el.replaceChildren();
  const tx = document.createElement("span");
  tx.className = "toast-text";
  tx.textContent = msg;
  const x = document.createElement("button");
  x.className = "toast-x";
  x.textContent = "×";
  x.title = t.noticeClose;
  x.addEventListener("click", () => {
    el.classList.remove("show");
  });
  el.append(tx, x);
  el.classList.toggle("err", tone === "err");
  el.classList.add("show");
  clearTimeout(toastTimer);
  if (tone !== "err") toastTimer = setTimeout(() => el.classList.remove("show"), tone === "ok" ? 5000 : 3200);
}

$("view-btn").addEventListener("click", () => {
  treeMode = !treeMode;
  lsSet("zcode-git.view", treeMode ? "tree" : "list");
  applyViewIcon();
  render();
});

function applyViewIcon() {
  $("view-btn").innerHTML = treeMode ? ICONS.list : ICONS.tree;
  $("view-btn").title = treeMode ? t.viewList : t.viewTree;
}

$("pull-btn").addEventListener("click", () => runGitAction("git_pull", {}));

$("stash-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (stashOpen) {
    closeStash();
  } else {
    stashOpen = true;
    loadStashList();
  }
});

// 菜单打开时：点击菜单外或按 Esc 关闭。
document.addEventListener("pointerdown", (e) => {
  if (!stashOpen) return;
  if ($("stash-menu").contains(e.target) || $("stash-btn").contains(e.target)) return;
  closeStash();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && stashOpen) closeStash();
});

$("commit-btn").addEventListener("click", () => {
  const msg = $("commit-msg").value.trim();
  if (!msg) {
    $("commit-msg").focus();
    return;
  }
  runAction(async () => {
    const r = await callTool("git_commit", { message: msg });
    $("commit-msg").value = "";
    toast(`${t.committed} ${r?.commit || ""}`.trim(), "ok");
  });
});

// 自定义 AI 提示词：内容与展开状态都记忆（有内容时默认展开）。
$("prompt-btn").addEventListener("click", () => {
  promptOpen = !promptOpen;
  $("prompt-area").hidden = !promptOpen;
  $("prompt-btn").classList.toggle("active", promptOpen);
});
$("prompt-area").value = customPrompt;
$("prompt-area").addEventListener("input", () => {
  customPrompt = $("prompt-area").value;
  lsSet("zcode-git.customPrompt", customPrompt);
});

$("ai-btn").addEventListener("click", async () => {
  if (busy) return;
  const btn = $("ai-btn");
  try {
    const caps = app.getHostCapabilities();
    if (!caps?.sampling) {
      toast(t.noSampling, "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = t.aiThinking;
    const st = status || (await callTool("git_status", {}));
    const parts = [];
    let total = 0;
    for (const e of st.staged || []) {
      const d = await callTool("git_diff", { path: e.path, staged: true });
      const text = d?.binary ? `Binary file changed: ${e.path}` : d?.text || "";
      if (total + text.length > 80000) {
        parts.push(`(diff truncated for ${e.path})`);
        break;
      }
      total += text.length;
      parts.push(text);
    }
    if (!parts.length) {
      toast(t.nothingStaged, "err");
      return;
    }
    const result = await app.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: buildPrompt(parts.join("\n")) } }],
      // 思考型模型的思考 token 也计入输出预算，给足余量（宿主会按模型上限截断）
      maxTokens: 4000,
      systemPrompt:
        "You generate git commit messages. Output ONLY the commit message text itself — no explanations, no quotes, no markdown code fences. First line: concise imperative subject (optionally with type(scope): prefix), then a blank line and short bullet points if useful.",
    });
    // CreateMessageResult.content is a single ContentBlock (array under tools mode).
    const stop = String(result?.stopReason || "");
    const c = result?.content;
    let text = (
      Array.isArray(c)
        ? c.map((x) => (x.type === "text" ? x.text : "")).join("")
        : c?.type === "text"
          ? c.text
          : ""
    ).trim();
    text = text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
    if (text) $("commit-msg").value = text;
    else if (stop === "maxTokens") toast(t.aiFailed + t.aiBudgetHit, "err");
    else toast(t.aiFailed + (stop ? `empty response (${stop})` : "empty response"), "err");
  } catch (err) {
    toast(t.aiFailed + String(err.message || err).split("\n")[0], "err");
  } finally {
    btn.disabled = false;
    btn.textContent = `✨ ${t.aiGenerate}`;
  }
});

function buildPrompt(diff) {
  const zh = t === STR["zh-CN"];
  const lines = zh
    ? [
        "请根据以下 git 暂存区 diff 生成一条提交信息。",
        "要求：符合 Conventional Commits 风格；首行为简短摘要（可用 type(scope): 前缀，不超过 72 字符）；如改动较多，空一行后用“- ”列出要点；只输出提交信息本身。",
        "",
        diff,
      ]
    : [
        "Generate a git commit message for the following staged diff.",
        "Follow Conventional Commits: first line is a concise subject (optionally type(scope): prefix, max 72 chars); if the change is substantial, add a blank line then '- ' bullet points; output ONLY the commit message.",
        "",
        diff,
      ];
  const extra = customPrompt.trim();
  if (extra !== "") {
    lines.push(
      "",
      zh ? "用户附加要求（在不违背上述输出格式规则的前提下必须遵守）：" : "Additional user requirements (follow these without breaking the format rules above):",
      extra
    );
  }
  return lines.join("\n");
}

// Ctrl+Enter to commit
$("commit-msg").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("commit-btn").click();
});

// ---------------------------------------------------------------------------
// auto refresh: 本地文件被外部（编辑器/命令行/agent）改动后自动跟进。
// 面板可见时每 3s 轮询一次 status，结果无变化不渲染；动作执行中跳过。
// 目录从「非仓库」变回仓库（git init）时同样自动恢复。
// ---------------------------------------------------------------------------

setInterval(async () => {
  if (busy || document.hidden || !status) return;
  let fresh;
  try {
    fresh = await callTool("git_status", {});
  } catch {
    return; // 轮询失败不打断现有展示
  }
  if (!fresh) return;
  const j = JSON.stringify(fresh);
  if (j === lastStatusJson) return;
  applyStatus(fresh);
}, 3000);

// ---------------------------------------------------------------------------
// host context & boot
// ---------------------------------------------------------------------------

function applyContext(ctx) {
  if (!ctx) return;
  t = pickLocale(ctx.locale || navigator.language);
  const root = document.documentElement;
  document.body.dataset.theme = ctx.theme || "dark";
  const vars = ctx.styles?.variables;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, String(v));
  }
  staticText();
}

function staticText() {
  applyViewIcon();
  $("pull-btn").innerHTML = ICONS.pull;
  $("pull-btn").title = t.pullTitle;
  $("stash-btn-icon").innerHTML = ICONS.kebab;
  $("stash-btn").title = t.stashMenu;
  $("prompt-btn").innerHTML = ICONS.sliders;
  $("prompt-btn").title = t.promptCustomize;
  $("prompt-btn").classList.toggle("active", promptOpen);
  $("prompt-area").hidden = !promptOpen;
  $("prompt-area").placeholder = t.promptPlaceholder;
  $("ai-btn").textContent = `✨ ${t.aiGenerate}`;
  $("commit-msg").placeholder = t.commitPlaceholder;
  $("staged-title").textContent = t.stagedChanges;
  $("worktree-title").textContent = t.worktreeChanges;
  $("conflict-title").textContent = t.conflicts;
  $("staged-empty").textContent = "·";
  $("worktree-empty").textContent = "·";
  $("clean").textContent = "✓ " + t.cleanTree;
  updateCommitBar(status?.staged?.length || 0);
}

app.onhostcontextchanged = (ctx) => applyContext(ctx);

(async () => {
  await app.connect();
  applyContext(app.getHostContext());
  await refresh();
})().catch((err) => {
  showFatal("init failed: " + String(err?.message || err));
});
