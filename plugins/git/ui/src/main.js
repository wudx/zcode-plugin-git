/* Git workbench panel for ZCode (MCP Apps view). 入口：事件接线、AI 生成、轮询与启动。 */
import { t, setLocale } from "./i18n.js";
import { ICONS } from "./icons.js";
import { lsGet, lsSet } from "./storage.js";
import {
  status, busy, treeMode, customPrompt, promptOpen, lastStatusJson,
  stashOpen, setStashOpen, setTreeMode, setCustomPrompt, setPromptOpen,
} from "./state.js";
import { app, callTool } from "./api.js";
import { $ } from "./dom.js";
import { render } from "./render.js";
import { loadStashList, closeStash, runGitAction } from "./stash.js";
import { applyStatus, refresh, runAction, toast, updateCommitBar, showFatal } from "./actions.js";

const POLL_MS = 3000;
// AI 生成：输出预算给足余量（思考型模型的思考 token 也计入输出，宿主会按模型上限截断）
const AI_MAX_TOKENS = 4000;
const AI_DIFF_BUDGET = 80000;

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

$("pull-btn").addEventListener("click", () => runGitAction("git_pull", {}));

$("stash-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (stashOpen) {
    closeStash();
  } else {
    setStashOpen(true);
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

function buildPrompt(diff) {
  const lines = [t.promptIntro, t.promptRules, "", diff];
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
    const parts = [];
    let total = 0;
    for (const e of st.staged || []) {
      const d = await callTool("git_diff", { path: e.path, staged: true });
      const text = d?.binary ? `Binary file changed: ${e.path}` : d?.text || "";
      if (total + text.length > AI_DIFF_BUDGET) {
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
  $("stash-btn-icon").innerHTML = ICONS.kebab;
  $("stash-btn").title = t.stashMenu;
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
