/* Git workbench panel for ZCode (MCP Apps view). 入口：事件接线、AI 生成、轮询与启动。 */
import { t, setLocale } from "./i18n.js";
import { ICONS } from "./icons.js";
import { lsGet, lsSet } from "./storage.js";
import {
  status, busy, treeMode, customPrompt, promptOpen, lastStatusJson,
  stashOpen, branchOpen, historyOpen, stagedCollapsed, worktreeCollapsed,
  setStashOpen, setBranchOpen, setHistoryOpen, setTreeMode, setCustomPrompt, setPromptOpen,
  setStagedCollapsed, setWorktreeCollapsed,
} from "./state.js";
import { app, callTool } from "./api.js";
import { $ } from "./dom.js";
import { render } from "./render.js";
import { loadStashList, closeStash, runGitAction } from "./stash.js";
import { loadBranchList, closeBranchMenu, closeBranchCtx } from "./branches.js";
import { loadHistory, closeHistory } from "./history.js";
import { applyStatus, refresh, runAction, toast, updateCommitBar, showFatal } from "./actions.js";

const POLL_MS = 3000;
// AI 生成：输出预算给足余量（思考型模型的思考 token 也计入输出，宿主会按模型上限截断）
const AI_MAX_TOKENS = 4000;
const AI_DIFF_BUDGET = 80000;
// 单文件 diff 上限：防一个巨文件吃光预算，后续文件还有机会进入 prompt
const AI_FILE_CAP = 20000;
// 压缩产物判定：diff 足够长且平均行长爆表（dist 压缩 HTML/JS 一行上万字符），对生成无信息量
const AI_MINIFIED_AVG_LINE = 500;
// 源码类扩展名优先进入 diff 预算：大资源提交里 meta/png 的重命名 diff 会按清单顺序
// 先吃光预算，核心源码只剩文件名（模型看不到改动内容）。清单本身保持原顺序，
// 只有进预算的遍历顺序分层：源码在前，其余在后，同层内按清单原序。
const AI_CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|xml|json|md|css|scss|less|html|htm|yml|yaml|toml|ini|lua|java|kt|swift|go|rs|c|h|cc|cpp|hpp|cs|sh|bat|ps1|vue|gd)$/i;

// ---------------------------------------------------------------------------
// top-level events
// ---------------------------------------------------------------------------

function applyViewIcon() {
  $("view-btn").innerHTML = treeMode ? ICONS.list : ICONS.tree;
  $("view-btn").title = treeMode ? t.viewList : t.viewTree;
}

$("view-btn").addEventListener("click", () => {
  setTreeMode(!treeMode);
  lsSet("zcode-git.view", treeMode ? "tree" : "list");
  applyViewIcon();
  render();
});

// 分区折叠：点击/回车切换（分区头上的批量按钮不触发折叠）
function toggleSection(hId, collapsed, set) {
  $(hId).addEventListener("click", (e) => {
    if (e.target.closest(".sec-actions")) return;
    set(!collapsed());
    render();
  });
  $(hId).addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest(".sec-actions")) return;
    e.preventDefault();
    set(!collapsed());
    render();
  });
}
toggleSection("staged-h", () => stagedCollapsed, setStagedCollapsed);
toggleSection("worktree-h", () => worktreeCollapsed, setWorktreeCollapsed);

$("pull-btn").addEventListener("click", () => runGitAction("git_pull", {}));

$("push-btn").addEventListener("click", () => runGitAction("git_push", {}));

$("stash-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (branchOpen) closeBranchMenu();
  if (historyOpen) closeHistory();
  if (stashOpen) {
    closeStash();
  } else {
    setStashOpen(true);
    loadStashList();
  }
});

// 历史菜单：点击 header 时钟按钮开关；三个菜单互斥
$("history-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (stashOpen) closeStash();
  if (branchOpen) closeBranchMenu();
  if (historyOpen) {
    closeHistory();
  } else {
    setHistoryOpen(true);
    loadHistory();
  }
});

// 分支菜单：点击 header 分支名（或回车/空格）开关；三个菜单互斥
function toggleBranchMenu() {
  if (branchOpen) {
    closeBranchMenu();
    return;
  }
  if (stashOpen) closeStash();
  if (historyOpen) closeHistory();
  setBranchOpen(true);
  loadBranchList();
}
$("branch").addEventListener("click", toggleBranchMenu);
$("branch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  toggleBranchMenu();
});

// 菜单打开时：点击菜单外或按 Esc 关闭。#branch-ctx（分支右键菜单）点内不关
// （交给菜单项自身 click），点外只关它自己，不牵连整个分支菜单。
document.addEventListener("pointerdown", (e) => {
  if (stashOpen && !$("stash-menu").contains(e.target) && !$("stash-btn").contains(e.target)) closeStash();
  if (branchOpen && !$("branch-menu").contains(e.target) && !$("branch").contains(e.target) && !$("branch-ctx").contains(e.target)) closeBranchMenu();
  closeBranchCtx(e);
  if (historyOpen && !$("history-menu").contains(e.target) && !$("history-btn").contains(e.target)) closeHistory();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (stashOpen) closeStash();
  if (branchOpen) closeBranchMenu();
  if (historyOpen) closeHistory();
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

// 自定义 AI 提示词：内容与展开状态分开记忆，默认收起，不随有无内容自动展开。
$("prompt-btn").addEventListener("click", () => {
  setPromptOpen(!promptOpen);
  $("prompt-area").hidden = !promptOpen;
  $("prompt-btn").classList.toggle("active", promptOpen);
});
$("prompt-area").value = customPrompt;
$("prompt-area").addEventListener("input", () => {
  setCustomPrompt($("prompt-area").value);
  lsSet("zcode-git.customPrompt", customPrompt);
});

// Ctrl+Enter to commit
$("commit-msg").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("commit-btn").click();
});

// ---------------------------------------------------------------------------
// 底部区域高度：拖 #bar-resizer（commit-bar 顶边）调整输入框高度，持久化；
// 双击恢复默认，↑↓ 微调。存值空串 = 未自定义。
// ---------------------------------------------------------------------------

const BAR_H_KEY = "zcode-git.barH";
const BAR_H_DEFAULT = 56;
const BAR_H_MIN = 36;

function clampBarH(px) {
  // 上限留给上方文件列表至少 30% 面板高度
  const max = Math.max(BAR_H_MIN + 1, Math.floor(window.innerHeight * 0.7));
  return Math.min(max, Math.max(BAR_H_MIN, Math.round(px)));
}
function applyBarH(px) {
  $("commit-msg").style.height = clampBarH(px) + "px";
}
function storedBarH() {
  const v = parseInt(lsGet(BAR_H_KEY), 10);
  return Number.isFinite(v) ? clampBarH(v) : BAR_H_DEFAULT;
}
applyBarH(storedBarH());

const resizer = $("bar-resizer");
let barDrag = null; // { y, h }
resizer.addEventListener("pointerdown", (e) => {
  barDrag = { y: e.clientY, h: $("commit-msg").offsetHeight };
  // 合成指针事件（自动化测试/宿主注入）没有活动指针，capture 会抛 NotFoundError
  try {
    resizer.setPointerCapture(e.pointerId);
  } catch { /* 拖拽仍可工作，仅失去元素外跟踪 */ }
  resizer.classList.add("drag");
  document.body.style.userSelect = "none";
});
resizer.addEventListener("pointermove", (e) => {
  if (barDrag) applyBarH(barDrag.h - (e.clientY - barDrag.y));
});
function endBarDrag() {
  if (!barDrag) return;
  barDrag = null;
  resizer.classList.remove("drag");
  document.body.style.userSelect = "";
  lsSet(BAR_H_KEY, String(clampBarH($("commit-msg").offsetHeight)));
}
resizer.addEventListener("pointerup", endBarDrag);
resizer.addEventListener("pointercancel", endBarDrag);
resizer.addEventListener("dblclick", () => {
  applyBarH(BAR_H_DEFAULT);
  lsSet(BAR_H_KEY, "");
});
resizer.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  const cur = parseInt($("commit-msg").style.height, 10) || BAR_H_DEFAULT;
  applyBarH(cur + (e.key === "ArrowUp" ? 16 : -16));
  lsSet(BAR_H_KEY, String(clampBarH($("commit-msg").offsetHeight)));
});

// ---------------------------------------------------------------------------
// AI commit message
// ---------------------------------------------------------------------------

function buildPrompt(manifest, diff) {
  const lines = [t.promptIntro, t.promptRules, "", t.promptFiles, manifest.join("\n"), "", diff];
  const extra = customPrompt.trim();
  if (extra !== "") {
    lines.push("", t.promptExtra, extra);
  }
  return lines.join("\n");
}

async function generateCommitMessage() {
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
    const staged = st.staged || [];
    if (!staged.length) {
      toast(t.nothingStaged, "err");
      return;
    }
    // 变更文件清单随 prompt 恒发：diff 被截断/省略时模型仍能看到改动全貌
    const manifest = staged.map((e) => `${e.code} ${e.path}`);
    // 一次批量拉齐全部 diff：逐文件各调一次工具时，服务端每次都要重跑 git status
    // （N 个文件 ≈ 5N 个 git 子进程 + N 次 MCP 往返），大暂存列表会慢到分钟级
    const batch = (await callTool("git_diff_batch", { paths: staged.map((e) => e.path), staged: true }))?.diffs || [];
    const byPath = new Map(batch.map((d) => [d.path, d]));
    const parts = [];
    let total = 0;
    // 源码优先进预算：先遍历源码类文件，非源码再补位，避免被海量 meta/png 挤占
    const order = staged
      .map((e, i) => ({ e, i }))
      .sort((a, b) => Number(AI_CODE_EXT_RE.test(b.e.path)) - Number(AI_CODE_EXT_RE.test(a.e.path)) || a.i - b.i);
    for (const { e } of order) {
      const d = byPath.get(e.path);
      let text = !d ? "" : d.binary ? `Binary file changed: ${e.path}` : d.text || "";
      // 压缩产物（构建输出）只留清单标注，diff 全文跳过，把预算让给源码
      if (!d?.binary && text.length > 2000 && text.length / (text.split("\n").length) > AI_MINIFIED_AVG_LINE) {
        manifest.push(`  (${e.path}: diff omitted — minified build output)`);
        continue;
      }
      if (text.length > AI_FILE_CAP) text = `${text.slice(0, AI_FILE_CAP)}\n…(diff truncated for ${e.path})`;
      // 超预算的文件跳过（不 break），后续小文件照常进入 prompt
      if (total + text.length > AI_DIFF_BUDGET) {
        manifest.push(`  (${e.path}: diff omitted — over budget)`);
        continue;
      }
      total += text.length;
      parts.push(text);
    }
    const result = await app.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: buildPrompt(manifest, parts.join("\n")) } }],
      maxTokens: AI_MAX_TOKENS,
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
}

$("ai-btn").addEventListener("click", generateCommitMessage);

// ---------------------------------------------------------------------------
// auto refresh: 本地文件被外部（编辑器/命令行/agent）改动后自动跟进。
// 面板可见时定期轮询 status，结果无变化不渲染；动作执行中跳过。
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
}, POLL_MS);

// ---------------------------------------------------------------------------
// host context & boot
// ---------------------------------------------------------------------------

function applyContext(ctx) {
  if (!ctx) return;
  setLocale(ctx.locale || navigator.language);
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
  $("push-btn").innerHTML = ICONS.push;
  $("push-btn").title = t.pushTitle;
  $("stash-btn-icon").innerHTML = ICONS.kebab;
  $("stash-btn").title = t.stashMenu;
  $("history-btn").innerHTML = ICONS.history;
  $("history-btn").title = t.historyTitle;
  $("prompt-btn").innerHTML = ICONS.sliders;
  $("prompt-btn").title = t.promptCustomize;
  $("prompt-btn").classList.toggle("active", promptOpen);
  $("prompt-area").hidden = !promptOpen;
  $("prompt-area").placeholder = t.promptPlaceholder;
  $("ai-btn").textContent = `✨ ${t.aiGenerate}`;
  $("commit-msg").placeholder = t.commitPlaceholder;
  $("bar-resizer").title = t.barResize;
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
