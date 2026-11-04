// Git workbench MCP server for ZCode.
// Tools: status / diff / stage / unstage / discard / commit / log / pull / stash.
// Also serves the panel UI as an MCP Apps resource (ui://git/panel.html).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_MIME } from "../../shared/images.js";

const PLUGIN_NAME = "git";
const VERSION = __APP_VERSION__; // 构建时由 build.mjs 注入 plugin.json 的版本
const PANEL_URI = `ui://${PLUGIN_NAME}/panel.html`;

// ---------------------------------------------------------------------------
// tool protocol：错误码随结果结构化下发，面板 UI 按 code 判定而非匹配文案
// ---------------------------------------------------------------------------

// NOT_A_REPO  当前目录不是 Git 仓库（resolveRepo）
// GIT_MISSING 未找到 git 可执行文件（runGit ENOENT）
// BAD_PATH    路径非法 / 越界（assertSafePath）
// GIT_ERROR   git 命令执行失败（gitErr）
// EMPTY_STAGED 暂存区为空却尝试提交
// INTERNAL    其余未分类异常
class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function errResult(code, message) {
  // isError 与 text 维持旧行为（模型与冒烟测试依赖），structuredContent 是增量
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, code, message },
  };
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// 工具包装：统一解析仓库根 + 把异常映射为结构化错误结果。
// git_status 传 resolve:false——非仓库是可展示状态而非错误（宿主靠它加载面板）。
function withTool(fn, { resolve = true } = {}) {
  return async (args) => {
    try {
      return await fn(resolve ? await resolveRepo() : undefined, args);
    } catch (err) {
      const code = err instanceof ToolError ? err.code : "INTERNAL";
      return errResult(code, String(err?.message || err));
    }
  };
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT = 60_000;
// 非 ASCII 文件名不转义成带引号的八进制
const QP = ["-c", "core.quotepath=false"];
// 未跟踪文件合成 diff 的行数上限；NUL 字节嗅探窗口（区分文本/二进制）
const MAX_DIFF_LINES = 4000;
const NUL_SNIFF_BYTES = 8000;

function runGit(args, { cwd, stdin, timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // stdout 以 Buffer 收集，保证 git show 等二进制输出不被 utf8 解码破坏
    const chunks = [];
    let outLen = 0;
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`git ${args[0]} timed out after ${timeout}ms`));
      }
    }, timeout);
    child.stdout.on("data", (d) => {
      if (outLen < MAX_BUFFER) {
        chunks.push(d);
        outLen += d.length;
      }
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 1024 * 1024) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new ToolError("GIT_MISSING", "未找到 git 可执行文件，请确认已安装 Git 并加入 PATH。") : err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuf = Buffer.concat(chunks);
      resolve({ code, stdoutBuf, stdout: stdoutBuf.toString("utf8"), stderr });
    });
    if (stdin != null) child.stdin.end(stdin, "utf8");
    else child.stdin.end();
  });
}

function gitErr(result, fallback) {
  const msg = (result.stderr || result.stdout || "").trim();
  return new ToolError("GIT_ERROR", msg || fallback);
}

async function resolveRepo() {
  const cwd = process.cwd();
  const r = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (r.code !== 0) {
    throw new ToolError("NOT_A_REPO", `当前目录不是 Git 仓库：${cwd}\n${r.stderr.trim()}`);
  }
  return r.stdout.trim().replace(/\\/g, "/");
}

// Paths must be repo-relative, inside the repo, and free of traversal.
function assertSafePath(p) {
  if (typeof p !== "string" || p.length === 0) throw new ToolError("BAD_PATH", "路径不能为空");
  if (p.includes("\0")) throw new ToolError("BAD_PATH", "路径包含非法字符");
  const norm = p.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(norm) || norm.startsWith("/")) {
    throw new ToolError("BAD_PATH", `仅支持仓库内相对路径：${p}`);
  }
  const segs = norm.split("/");
  if (segs.some((s) => s === "..")) throw new ToolError("BAD_PATH", `路径不允许包含 ..：${p}`);
  return norm;
}

async function pathExists(top, p) {
  try {
    await stat(path.join(top, ...p.split("/")));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// porcelain v2 parsing
// ---------------------------------------------------------------------------

const X_LABEL = {
  A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied",
  T: "typechange", U: "unmerged", "?": "untracked", " ": " ",
};

// porcelain v2 line formats (paths may contain spaces; path is last field):
//   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
//   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><TAB><origPath>
//   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
const RE_1 = /^1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.+)$/;
const RE_2 = /^2 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.+)$/;
const RE_U = /^u (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.+)$/;

function parseStatus(out) {
  const staged = [];
  const unstaged = [];
  const conflicts = [];
  let branch = "";
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  let detached = false;
  for (const line of out.split("\n")) {
    const raw = line.replace(/\r$/, "");
    if (!raw) continue;
    if (raw.startsWith("# ")) {
      const [key, ...rest] = raw.slice(2).split(" ");
      const val = rest.join(" ");
      if (key === "branch.head") {
        if (val === "(detached)") { detached = true; branch = "(detached)"; }
        else branch = val;
      } else if (key === "branch.upstream") upstream = val;
      else if (key === "branch.ab") {
        const m = val.match(/\+(\d+)\s+-(\d+)/);
        if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
      }
      continue;
    }
    const kind = raw[0];
    if (kind === "?") {
      unstaged.push({ code: "?", label: "untracked", path: raw.slice(2), origPath: undefined });
      continue;
    }
    if (kind === "!") continue; // ignored files
    if (kind === "1") {
      const m = RE_1.exec(raw);
      if (!m) continue;
      const xy = m[1];
      const X = xy[0], Y = xy[1];
      const p = m[8];
      if (X !== "." && X !== "?") staged.push({ code: X, label: X_LABEL[X] || X, path: p, origPath: undefined });
      if (Y !== "." && Y !== "?") unstaged.push({ code: Y, label: X_LABEL[Y] || Y, path: p, origPath: undefined });
      continue;
    }
    if (kind === "2") {
      const tabIdx = raw.indexOf("\t");
      const left = tabIdx >= 0 ? raw.slice(0, tabIdx) : raw;
      const orig = tabIdx >= 0 ? raw.slice(tabIdx + 1) : undefined;
      const m = RE_2.exec(left);
      if (!m) continue;
      const xy = m[1];
      const X = xy[0], Y = xy[1];
      const p = m[9];
      if (X !== "." && X !== "?") staged.push({ code: X, label: X_LABEL[X] || X, path: p, origPath: orig });
      if (Y !== "." && Y !== "?") unstaged.push({ code: Y, label: X_LABEL[Y] || Y, path: p, origPath: orig });
      continue;
    }
    if (kind === "u") {
      const m = RE_U.exec(raw);
      if (m) conflicts.push({ path: m[10] });
      continue;
    }
  }
  return { staged, unstaged, conflicts, branch, upstream, ahead, behind, detached };
}

async function getStatus() {
  const cwd = process.cwd();
  const probe = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (probe.code !== 0) {
    // Not a repo is a displayable state, not a tool error: the host opens the
    // sidebar UI by calling git_status and refuses to load the panel on isError.
    return {
      ok: false,
      reason: "not_a_git_repo",
      repo: null,
      cwd,
      branch: "",
      upstream: "",
      ahead: 0,
      behind: 0,
      detached: false,
      staged: [],
      unstaged: [],
      conflicts: [],
      stashes: 0,
      error: `当前目录不是 Git 仓库：${cwd}\n${probe.stderr.trim()}`,
    };
  }
  const top = probe.stdout.trim().replace(/\\/g, "/");
  const r = await runGit([...QP, "status", "--porcelain=v2", "--branch", "--untracked-files=all"], { cwd: top });
  if (r.code !== 0) throw gitErr(r, "git status 失败");
  const parsed = parseStatus(r.stdout);
  const stashList = await runGit(["stash", "list"], { cwd: top });
  const stashes =
    stashList.code === 0 ? stashList.stdout.split("\n").filter((l) => l.trim() !== "").length : 0;
  return { ok: true, repo: top, stashes, ...parsed };
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

const MAX_DIFF_BYTES = 512 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

// scope：line=±context 行（默认）；function=整个函数（git -W）；file=整个文件（-U999999）
function diffContextArgs(context, scope) {
  if (scope === "function") return ["-W"];
  if (scope === "file") return ["-U999999"];
  return [`-U${context ?? 10}`];
}

// stdout+stderr 拼成一段人类可读输出（pull/stash 系工具共用）
function joinOutput(r) {
  return `${r.stdout.trim()}${r.stderr.trim() ? "\n" + r.stderr.trim() : ""}`.trim();
}

async function fileDiff(top, entry, staged, context, scope) {
  const { path: p, code, unmerged } = entry;
  const ctxArgs = diffContextArgs(context, scope);
  if (!staged && code === "?" && !unmerged) {
    // Untracked: synthesize an all-added diff.
    const abs = path.join(top, ...p.split("/"));
    let content;
    try {
      const st = await stat(abs);
      if (st.size > MAX_DIFF_BYTES) {
        return { path: p, staged: false, binary: false, truncated: true, text: `--- /dev/null\n+++ b/${p}\n@@ -0,0 1,1 @@\n+（文件超过 ${MAX_DIFF_BYTES / 1024}KB，未显示内容）` };
      }
      content = await readFile(abs, "utf8");
    } catch {
      return { path: p, staged: false, binary: false, text: `（无法读取文件：${p}）` };
    }
    // Windows 文件常为 CRLF，去掉 \r，避免面板按 pre 渲染时每行后多出空行
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > MAX_DIFF_LINES) {
      lines.length = MAX_DIFF_LINES;
      lines.push(`…（内容过长，仅显示前 ${MAX_DIFF_LINES} 行）`);
    }
    const header = `--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n`;
    return { path: p, staged: false, binary: false, text: truncate(header + lines.map((l) => `+${l}`).join("\n")) };
  }
  // staged 对比 HEAD 与暂存区，否则对比暂存区与工作区；两分支仅差 --cached
  const range = staged ? ["diff", "--cached"] : ["diff"];
  const num = await runGit([...QP, ...range, "--numstat", "--", p], { cwd: top });
  if (/^\s*-\s+-\s/m.test(num.stdout)) return { path: p, staged, binary: true, text: "" };
  const r = await runGit([...QP, ...range, "--no-color", "-M", ...ctxArgs, "--", p], { cwd: top });
  return { path: p, staged, binary: false, text: truncate(r.stdout) };
}

function truncate(text) {
  if (Buffer.byteLength(text, "utf8") <= MAX_DIFF_BYTES) return text;
  return text.slice(0, MAX_DIFF_BYTES) + "\n…（diff 过大，已截断）";
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const pathsSchema = { paths: z.array(z.string().min(1)).min(1).describe("仓库内相对路径列表") };
const uiMeta = { _meta: { ui: { resourceUri: PANEL_URI, visibility: ["model", "app"] } } };

const server = new McpServer({ name: PLUGIN_NAME, version: VERSION });

server.registerTool(
  "git_status",
  {
    title: "查看 Git 状态",
    description:
      "查看当前仓库状态：分支、ahead/behind、已暂存的文件列表、工作区修改（含未跟踪）列表与冲突文件。返回 JSON。工作区修改指未暂存的更改；未跟踪文件 code 为 '?'。当前目录不是 Git 仓库时返回 ok:false（reason=not_a_git_repo），这是正常状态不是错误。",
    inputSchema: {},
    ...uiMeta,
  },
  withTool(async () => ok(await getStatus()), { resolve: false })
);

server.registerTool(
  "git_diff",
  {
    title: "查看文件 diff",
    description:
      "查看单个文件的统一 diff。staged=true 时对比 HEAD 与暂存区，否则对比暂存区与工作区（未跟踪文件显示为全新增）。scope：line=按 context 行数显示上下文（默认 10 行），function=显示改动所在的整个函数（便于定位逻辑），file=显示整个文件。二进制文件返回 binary=true。",
    inputSchema: {
      path: z.string().min(1).describe("仓库内相对路径"),
      staged: z.boolean().optional().describe("是否查看已暂存的 diff，默认 false"),
      context: z.number().int().min(0).max(50).optional().describe("上下文行数，默认 10（scope=line 时生效）"),
      scope: z.enum(["line", "function", "file"]).optional().describe("diff 上下文范围，默认 line"),
    },
    ...uiMeta,
  },
  withTool(async (top, { path: p, staged = false, context, scope = "line" }) => {
    const safe = assertSafePath(p);
    const st = await getStatus();
    const all = [...st.staged, ...st.unstaged];
    const entry = all.find((e) => e.path === safe || e.origPath === safe);
    if (!entry) {
      return ok({ path: safe, staged, binary: false, text: `（${staged ? "暂存区" : "工作区"}中没有该文件的变更）` });
    }
    return ok(await fileDiff(top, entry, staged, context, scope));
  })
);

server.registerTool(
  "git_stage",
  {
    title: "添加到暂存区",
    description: "把工作区的文件（新增/修改/删除）添加到暂存区，等价于 git add -- <paths>。",
    inputSchema: pathsSchema,
    ...uiMeta,
  },
  withTool(async (top, { paths }) => {
    const safe = paths.map(assertSafePath);
    const r = await runGit(["add", "--", ...safe], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git add 失败");
    return ok({ staged: safe, status: await getStatus() });
  })
);

server.registerTool(
  "git_unstage",
  {
    title: "取消暂存",
    description: "把文件从暂存区还原回工作区（保留文件内容修改），等价于 git restore --staged -- <paths>；首次提交前等价于 git rm --cached。",
    inputSchema: pathsSchema,
    ...uiMeta,
  },
  withTool(async (top, { paths }) => {
    const safe = paths.map(assertSafePath);
    const head = await runGit(["rev-parse", "--verify", "-q", "HEAD"], { cwd: top });
    const r =
      head.code === 0
        ? await runGit(["restore", "--staged", "--", ...safe], { cwd: top })
        : await runGit(["rm", "--cached", "-r", "-q", "--", ...safe], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git restore --staged 失败");
    return ok({ unstaged: safe, status: await getStatus() });
  })
);

server.registerTool(
  "git_discard",
  {
    title: "撤销工作区修改",
    description:
      "危险操作：把文件在工作区的修改撤销回暂存区/HEAD 版本（等价 git restore -- <paths>），未跟踪文件将被直接删除。已暂存的部分不受影响，如需完全丢弃请先 git_unstage。",
    inputSchema: pathsSchema,
    ...uiMeta,
  },
  withTool(async (top, { paths }) => {
    const safe = paths.map(assertSafePath);
    const st = await getStatus();
    const untracked = new Set(st.unstaged.filter((e) => e.code === "?").map((e) => e.path));
    const tracked = safe.filter((p) => !untracked.has(p));
    const deleted = [];
    for (const p of safe) {
      if (untracked.has(p)) {
        if (await pathExists(top, p)) {
          await rm(path.join(top, ...p.split("/")), { force: true });
          deleted.push(p);
        }
      }
    }
    if (tracked.length > 0) {
      const r = await runGit(["restore", "--", ...tracked], { cwd: top });
      if (r.code !== 0) {
        const r2 = await runGit(["checkout", "--", ...tracked], { cwd: top });
        if (r2.code !== 0) throw gitErr(r2, r.stderr || "git restore 失败");
      }
    }
    return ok({ discarded: safe, deletedUntracked: deleted, status: await getStatus() });
  })
);

server.registerTool(
  "git_commit",
  {
    title: "提交暂存区",
    description: "把暂存区内容提交。message 支持多行（UTF-8）。提交前请确保变更已 git_stage。",
    inputSchema: {
      message: z.string().min(1).max(8000).describe("提交信息，首行为标题"),
    },
    ...uiMeta,
  },
  withTool(async (top, { message }) => {
    const st = await getStatus();
    if (st.staged.length === 0 && st.conflicts.length === 0) {
      throw new ToolError("EMPTY_STAGED", "暂存区为空：请先添加要提交的文件（git_stage）。");
    }
    const r = await runGit(["-c", "i18n.commitEncoding=UTF-8", "commit", "--file=-"], { cwd: top, stdin: message });
    if (r.code !== 0) throw gitErr(r, "git commit 失败");
    const after = await getStatus();
    const m = r.stdout.match(/\[.*?\s([0-9a-f]{7,})\]/);
    return ok({ commit: m ? m[1] : undefined, output: r.stdout.trim(), status: after });
  })
);

server.registerTool(
  "git_log",
  {
    title: "查看提交历史",
    description: "查看最近提交历史（hash、作者、日期、标题）。",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe("条数，默认 20"),
    },
    ...uiMeta,
  },
  withTool(async (top, { limit = 20 }) => {
    const r = await runGit(
      [...QP, "log", `--pretty=format:%h%x09%an%x09%ad%x09%s`, "--date=short", `-n${limit}`],
      { cwd: top }
    );
    if (r.code !== 0) throw gitErr(r, "git log 失败");
    const commits = r.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, author, date, ...rest] = l.split("\t");
        return { hash, author, date, subject: rest.join("\t") };
      });
    return ok({ commits });
  })
);

server.registerTool(
  "git_pull",
  {
    title: "拉取远程更新",
    description: "在当前分支执行 git pull（--no-edit），拉取并合并上游更新。没有配置上游分支或产生冲突时会报错，报错信息为 git 原始输出。",
    inputSchema: {},
    ...uiMeta,
  },
  withTool(async (top) => {
    const r = await runGit(["pull", "--no-edit"], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git pull 失败");
    return ok({ output: joinOutput(r), status: await getStatus() });
  })
);

server.registerTool(
  "git_stash",
  {
    title: "存储全部改动",
    description:
      "把暂存区与工作区的全部改动存入 stash（git stash push -u，包含未跟踪文件，.gitignore 忽略的文件除外）。没有可存储的改动时报错。",
    inputSchema: {},
    ...uiMeta,
  },
  withTool(async (top) => {
    // -u：连未跟踪文件一起入栈，否则新文件存储后还原不回来。
    const r = await runGit(["stash", "push", "-u"], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git stash 失败");
    return ok({ output: joinOutput(r), status: await getStatus() });
  })
);

server.registerTool(
  "git_stash_pop",
  {
    title: "恢复最近一次存储",
    description: "恢复最近一次 stash 并删除该条目（git stash pop）。有冲突时报错展示，此时条目保留。",
    inputSchema: {},
    ...uiMeta,
  },
  withTool(async (top) => {
    const r = await runGit(["stash", "pop"], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git stash pop 失败");
    return ok({ output: joinOutput(r), status: await getStatus() });
  })
);

server.registerTool(
  "git_stash_apply",
  {
    title: "应用指定存储",
    description: "应用指定的 stash 条目但保留它（git stash apply）。ref 形如 stash@{0}，可先用 git_stash_list 查看。",
    inputSchema: {
      ref: z.string().regex(/^stash@\{\d+\}$/).describe("存储引用，如 stash@{0}"),
    },
    ...uiMeta,
  },
  withTool(async (top, { ref }) => {
    const r = await runGit(["stash", "apply", ref], { cwd: top });
    if (r.code !== 0) throw gitErr(r, `git stash apply ${ref} 失败`);
    return ok({ output: joinOutput(r), status: await getStatus() });
  })
);

server.registerTool(
  "git_stash_list",
  {
    title: "查看存储列表",
    description: "查看 stash 列表，返回 entries 数组（ref 如 stash@{0}，message 为存储说明，通常是当时的分支与提交）。",
    inputSchema: {},
    ...uiMeta,
  },
  withTool(async (top) => {
    const r = await runGit([...QP, "stash", "list", "--format=%gd%x09%gs"], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git stash list 失败");
    const entries = r.stdout
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => {
        const tab = l.indexOf("\t");
        return { ref: l.slice(0, tab), message: tab < 0 ? "" : l.slice(tab + 1) };
      });
    return ok({ entries });
  })
);

server.registerTool(
  "git_blob",
  {
    title: "读取文件版本内容",
    description:
      "读取文件在指定版本的内容，供图片等二进制文件预览比对。rev：worktree=磁盘工作区，index=暂存区，HEAD=最近提交。图片返回 { mime, base64 }；超过 2MB 返回 tooLarge:true；非图片二进制返回 binary:true；文本返回 { text }。",
    inputSchema: {
      path: z.string().min(1).describe("仓库内相对路径"),
      rev: z.enum(["worktree", "index", "HEAD"]).describe("要读取的版本"),
    },
    ...uiMeta,
  },
  withTool(async (top, { path: p, rev }) => {
    const safe = assertSafePath(p);
    const ext = (safe.split("/").pop().split(".").pop() || "").toLowerCase();
    let buf;
    if (rev === "worktree") {
      try {
        buf = await readFile(path.join(top, ...safe.split("/")));
      } catch {
        throw new ToolError("GIT_ERROR", `无法读取工作区文件：${safe}`);
      }
    } else {
      // index 用 :path，HEAD 用 HEAD:path（重命名场景由调用方传入对应路径）
      const r = await runGit(["show", `${rev === "HEAD" ? "HEAD:" : ":"}${safe}`], { cwd: top });
      if (r.code !== 0) throw gitErr(r, `无法读取 ${rev} 版本：${safe}`);
      buf = r.stdoutBuf;
    }
    if (buf.byteLength > MAX_BLOB_BYTES) {
      return ok({ path: safe, rev, tooLarge: true, size: buf.byteLength });
    }
    const mime = IMAGE_MIME[ext];
    if (mime) {
      return ok({ path: safe, rev, mime, base64: buf.toString("base64"), size: buf.byteLength });
    }
    // 非图片：简单嗅探 NUL 字节区分文本与二进制
    if (buf.subarray(0, NUL_SNIFF_BYTES).includes(0)) {
      return ok({ path: safe, rev, binary: true, size: buf.byteLength });
    }
    return ok({ path: safe, rev, mime: "text/plain", text: truncate(buf.toString("utf8")), size: buf.byteLength });
  })
);

// ---------------------------------------------------------------------------
// panel resource
// ---------------------------------------------------------------------------

function panelHtmlPath() {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnv) return path.join(fromEnv, "dist", "ui", "panel.html");
  // dist/server.mjs -> <pluginRoot>/dist/ui/panel.html
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "panel.html");
}

async function readPanelHtml() {
  return readFile(panelHtmlPath(), "utf8");
}

server.registerResource(
  "panel",
  PANEL_URI,
  { title: "Git Panel", mimeType: "text/html" },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/html", text: await readPanelHtml() }],
  })
);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
