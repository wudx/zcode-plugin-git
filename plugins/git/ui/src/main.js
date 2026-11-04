/* Git workbench panel for ZCode (MCP Apps view). */
import { App } from "@modelcontextprotocol/ext-apps";

const $ = (id) => document.getElementById(id);

const app = new App({ name: "git-panel", version: "0.1.0" });

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const STR = {
  "zh-CN": {
    refresh: "刷新",
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
  },
  en: {
    refresh: "Refresh",
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
  },
};
let t = STR["zh-CN"];

function pickLocale(hint) {
  const s = (hint || "").toLowerCase();
  return s.startsWith("zh") ? STR["zh-CN"] : STR.en;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let status = null;
let expanded = new Map(); // key -> { loading, entry, staged, diff }
let busy = false;

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

async function refresh() {
  try {
    status = await callTool("git_status", {});
    $("fatal").hidden = true;
  } catch (err) {
    if (isNoGit(err)) return showFatal(t.noGit);
    if (isNoRepo(err)) return showFatal(t.notRepo + "\n" + String(err.message || "").split("\n")[0]);
    return showFatal(String(err.message || err));
  }
  render();
}

function showFatal(msg) {
  $("fatal").textContent = msg;
  $("fatal").hidden = false;
  $("staged-list").replaceChildren();
  $("worktree-list").replaceChildren();
  $("staged-count").textContent = "";
  $("worktree-count").textContent = "";
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

function rowEl(entry, staged) {
  const row = document.createElement("div");
  row.className = "row";
  const key = keyOf(staged, entry.path);
  row.dataset.key = key;

  const main = document.createElement("div");
  main.className = "row-main";
  main.appendChild(badgeEl(entry.code));
  const name = document.createElement("span");
  name.className = "path";
  name.textContent = entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path;
  name.title = entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path;
  main.appendChild(name);
  row.appendChild(main);

  const btns = document.createElement("div");
  btns.className = "row-btns";
  btns.addEventListener("click", (e) => e.stopPropagation());
  row.appendChild(btns);

  const mk = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = "btn " + cls;
    b.textContent = label;
    if (fn) b.addEventListener("click", fn);
    btns.appendChild(b);
    return b;
  };

  if (entry.unmerged) {
    mk(t.resolveMark, "", () => runAction(() => callTool("git_stage", { paths: [entry.path] })));
  } else if (staged) {
    mk(t.unstage, "", () => runAction(() => callTool("git_unstage", { paths: [entry.path] })));
  } else if (entry.code === "?") {
    mk(t.stage, "primary", () => runAction(() => callTool("git_stage", { paths: [entry.path] })));
    const del = mk(t.deleteFile, "danger");
    armConfirm(del, t.confirmDelete, () => runAction(() => callTool("git_discard", { paths: [entry.path] })));
  } else {
    mk(t.stage, "primary", () => runAction(() => callTool("git_stage", { paths: [entry.path] })));
    const dis = mk(t.discard, "danger");
    armConfirm(dis, t.confirmDiscard, () => runAction(() => callTool("git_discard", { paths: [entry.path] })));
  }

  main.addEventListener("click", () => toggleDiff(row, entry, staged));
  return row;
}

// Two-click confirmation for destructive buttons.
function armConfirm(btn, label, fn) {
  const original = btn.textContent;
  let armed = false;
  let timer = null;
  const disarm = () => {
    armed = false;
    btn.textContent = original;
    btn.classList.remove("armed");
    clearTimeout(timer);
  };
  btn.addEventListener("click", () => {
    if (armed) {
      disarm();
      fn();
    } else {
      armed = true;
      btn.textContent = label;
      btn.classList.add("armed");
      timer = setTimeout(disarm, 2600);
    }
  });
}

function sectionEl(title, entries, staged) {
  const box = document.createElement("div");
  const h = document.createElement("div");
  h.className = "section-h";
  h.textContent = `${title} (${entries.length})`;
  box.appendChild(h);
  for (const e of entries) box.appendChild(rowEl(e, staged));
  return box;
}

function diffEl(key) {
  const info = expanded.get(key);
  const box = document.createElement("div");
  box.className = "diff-box";
  const close = document.createElement("button");
  close.className = "diff-close";
  close.textContent = "×";
  close.title = "close";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded.delete(key);
    render();
  });
  box.appendChild(close);
  if (info.loading || !info.diff) {
    const p = document.createElement("div");
    p.className = "diff-loading";
    p.textContent = t.loading;
    box.appendChild(p);
    return box;
  }
  const d = info.diff;
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
  const pre = document.createElement("pre");
  pre.className = "diff";
  for (const line of d.text.split("\n")) {
    const span = document.createElement("span");
    span.className =
      line.startsWith("+") && !line.startsWith("+++") ? "dl-add" :
      line.startsWith("-") && !line.startsWith("---") ? "dl-del" :
      line.startsWith("@@") ? "dl-hunk" : "dl-meta";
    span.textContent = line || "\n";
    pre.appendChild(span);
    pre.appendChild(document.createTextNode("\n"));
  }
  box.appendChild(pre);
  return box;
}

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

  const sList = $("staged-list");
  const wList = $("worktree-list");
  sList.replaceChildren(...staged.map((e) => rowEl(e, true)));
  wList.replaceChildren(...unstaged.map((e) => rowEl(e, false)));

  for (const [key, info] of expanded) {
    const row = document.querySelector(`.row[data-key="${CSS.escape(key)}"]`);
    if (!row) continue;
    row.classList.add("expanded");
    row.after(diffEl(key));
    if (info.loading && !info.pending) {
      info.pending = true;
      callTool("git_diff", { path: info.entry.path, staged: info.staged })
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
  }
  updateCommitBar(staged.length);
}

function toggleDiff(row, entry, staged) {
  const key = keyOf(staged, entry.path);
  if (expanded.has(key)) {
    expanded.delete(key);
    render();
    return;
  }
  expanded.set(key, { loading: true, entry, staged, diff: null });
  render();
}

function updateCommitBar(stagedCount) {
  $("commit-btn").disabled = busy || stagedCount === 0;
  $("commit-btn").textContent = stagedCount ? `${t.commit} (${stagedCount})` : t.commit;
  $("commit-btn").title = stagedCount === 0 ? t.nothingStaged : t.stagedTip;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

async function runAction(fn) {
  if (busy) return;
  busy = true;
  $("refresh-btn").disabled = true;
  try {
    await fn();
    expanded.clear();
    await refresh();
  } catch (err) {
    toast(t.actionFailed + String(err.message || err).split("\n")[0]);
  } finally {
    busy = false;
    $("refresh-btn").disabled = false;
    updateCommitBar(status?.staged?.length || 0);
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

$("refresh-btn").addEventListener("click", () => runAction(async () => {}));

$("commit-btn").addEventListener("click", () => {
  const msg = $("commit-msg").value.trim();
  if (!msg) {
    $("commit-msg").focus();
    return;
  }
  runAction(async () => {
    const r = await callTool("git_commit", { message: msg });
    $("commit-msg").value = "";
    toast(`${t.committed} ${r?.commit || ""}`.trim());
  });
});

$("ai-btn").addEventListener("click", async () => {
  if (busy) return;
  const btn = $("ai-btn");
  try {
    const caps = app.getHostCapabilities();
    if (!caps?.sampling) {
      toast(t.noSampling);
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
      toast(t.nothingStaged);
      return;
    }
    const prompt = buildPrompt(parts.join("\n"));
    const result = await app.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 400,
      systemPrompt:
        "You generate git commit messages. Output ONLY the commit message text itself — no explanations, no quotes, no markdown code fences. First line: concise imperative subject (optionally with type(scope): prefix), then a blank line and short bullet points if useful.",
    });
    // CreateMessageResult.content is a single ContentBlock (array under tools mode).
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
    else toast(t.aiFailed + "empty response");
  } catch (err) {
    toast(t.aiFailed + String(err.message || err).split("\n")[0]);
  } finally {
    btn.disabled = false;
    btn.textContent = `✨ ${t.aiGenerate}`;
  }
});

function buildPrompt(diff) {
  if (t === STR["zh-CN"]) {
    return [
      "请根据以下 git 暂存区 diff 生成一条提交信息。",
      "要求：符合 Conventional Commits 风格；首行为简短摘要（可用 type(scope): 前缀，不超过 72 字符）；如改动较多，空一行后用“- ”列出要点；只输出提交信息本身。",
      "",
      diff,
    ].join("\n");
  }
  return [
    "Generate a git commit message for the following staged diff.",
    "Follow Conventional Commits: first line is a concise subject (optionally type(scope): prefix, max 72 chars); if the change is substantial, add a blank line then '- ' bullet points; output ONLY the commit message.",
    "",
    diff,
  ].join("\n");
}

// Ctrl+Enter to commit
$("commit-msg").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("commit-btn").click();
});

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
  $("refresh-btn").title = t.refresh;
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
