// Git workbench MCP server for ZCode.
// Tools: status / diff / stage / unstage / discard / commit / log.
// Also serves the panel UI as an MCP Apps resource (ui://git/panel.html).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "git";
const VERSION = "0.1.0";
const PANEL_URI = `ui://${PLUGIN_NAME}/panel.html`;

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT = 60_000;

function runGit(args, { cwd, stdin, timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
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
      if (stdout.length < MAX_BUFFER) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 1024 * 1024) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error("未找到 git 可执行文件，请确认已安装 Git 并加入 PATH。") : err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (stdin != null) child.stdin.end(stdin, "utf8");
    else child.stdin.end();
  });
}

function gitErr(result, fallback) {
  const msg = (result.stderr || result.stdout || "").trim();
  return new Error(msg || fallback);
}

async function resolveRepo() {
  const cwd = process.cwd();
  const r = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (r.code !== 0) {
    throw new Error(`当前目录不是 Git 仓库：${cwd}\n${r.stderr.trim()}`);
  }
  return r.stdout.trim().replace(/\\/g, "/");
}

// Paths must be repo-relative, inside the repo, and free of traversal.
function assertSafePath(p) {
  if (typeof p !== "string" || p.length === 0) throw new Error("路径不能为空");
  if (p.includes("\0")) throw new Error("路径包含非法字符");
  const norm = p.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(norm) || norm.startsWith("/")) {
    throw new Error(`仅支持仓库内相对路径：${p}`);
  }
  const segs = norm.split("/");
  if (segs.some((s) => s === "..")) throw new Error(`路径不允许包含 ..：${p}`);
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
  const top = await resolveRepo();
  const r = await runGit(
    ["-c", "core.quotepath=false", "status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    { cwd: top }
  );
  if (r.code !== 0) throw gitErr(r, "git status 失败");
  const parsed = parseStatus(r.stdout);
  return { repo: top, ...parsed };
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

const MAX_DIFF_BYTES = 512 * 1024;

async function fileDiff(top, entry, staged, context) {
  const { path: p, code, unmerged } = entry;
  const ctx = context ?? 3;
  if (staged) {
    const num = await runGit(["-c", "core.quotepath=false", "diff", "--cached", "--numstat", "--", p], { cwd: top });
    if (/^\s*-\s+-\s/m.test(num.stdout)) return { path: p, staged: true, binary: true, text: "" };
    const r = await runGit(
      ["-c", "core.quotepath=false", "diff", "--cached", "--no-color", "-M", `-U${ctx}`, "--", p],
      { cwd: top }
    );
    return { path: p, staged: true, binary: false, text: truncate(r.stdout) };
  }
  if (code === "?" && !unmerged) {
    // Untracked: synthesize an all-added diff.
    const abs = path.join(top, ...p.split("/"));
    let content;
    try {
      const st = await stat(abs);
      if (st.size > MAX_DIFF_BYTES) {
        return { path: p, staged: false, binary: false, truncated: true, text: `--- /dev/null\n+++ b/${p}\n@@ -0,0 1,1 @@\n+（文件超过 512KB，未显示内容）` };
      }
      content = await readFile(abs, "utf8");
    } catch {
      return { path: p, staged: false, binary: false, text: `（无法读取文件：${p}）` };
    }
    const lines = content.split("\n");
    if (lines.length > 4000) {
      lines.length = 4000;
      lines.push("…（内容过长，仅显示前 4000 行）");
    }
    const header = `--- /dev/null\n+++ b/${p}\n@@ -0,0 1,${lines.length} @@\n`;
    return { path: p, staged: false, binary: false, text: truncate(header + lines.map((l) => `+${l}`).join("\n")) };
  }
  const num = await runGit(["-c", "core.quotepath=false", "diff", "--numstat", "--", p], { cwd: top });
  if (/^\s*-\s+-\s/m.test(num.stdout)) return { path: p, staged: false, binary: true, text: "" };
  const r = await runGit(
    ["-c", "core.quotepath=false", "diff", "--no-color", "-M", `-U${ctx}`, "--", p],
    { cwd: top }
  );
  return { path: p, staged: false, binary: false, text: truncate(r.stdout) };
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
      "查看当前仓库状态：分支、ahead/behind、已暂存的文件列表、工作区修改（含未跟踪）列表与冲突文件。返回 JSON。工作区修改指未暂存的更改；未跟踪文件 code 为 '?'。",
    inputSchema: {},
    ...uiMeta,
  },
  async () => ok(await getStatus())
);

server.registerTool(
  "git_diff",
  {
    title: "查看文件 diff",
    description:
      "查看单个文件的统一 diff。staged=true 时对比 HEAD 与暂存区，否则对比暂存区与工作区（未跟踪文件显示为全新增）。二进制文件返回 binary=true。",
    inputSchema: {
      path: z.string().min(1).describe("仓库内相对路径"),
      staged: z.boolean().optional().describe("是否查看已暂存的 diff，默认 false"),
      context: z.number().int().min(0).max(50).optional().describe("上下文行数，默认 3"),
    },
    ...uiMeta,
  },
  async ({ path: p, staged = false, context }) => {
    const top = await resolveRepo();
    const safe = assertSafePath(p);
    const st = await getStatus();
    const all = [...st.staged, ...st.unstaged];
    const entry = all.find((e) => e.path === safe || e.origPath === safe);
    if (!entry) {
      return ok({ path: safe, staged, binary: false, text: `（${staged ? "暂存区" : "工作区"}中没有该文件的变更）` });
    }
    return ok(await fileDiff(top, entry, staged, context));
  }
);

server.registerTool(
  "git_stage",
  {
    title: "添加到暂存区",
    description: "把工作区的文件（新增/修改/删除）添加到暂存区，等价于 git add -- <paths>。",
    inputSchema: pathsSchema,
    ...uiMeta,
  },
  async ({ paths }) => {
    const top = await resolveRepo();
    const safe = paths.map(assertSafePath);
    const r = await runGit(["add", "--", ...safe], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git add 失败");
    return ok({ staged: safe, status: await getStatus() });
  }
);

server.registerTool(
  "git_unstage",
  {
    title: "取消暂存",
    description: "把文件从暂存区还原回工作区（保留文件内容修改），等价于 git restore --staged -- <paths>；首次提交前等价于 git rm --cached。",
    inputSchema: pathsSchema,
    ...uiMeta,
  },
  async ({ paths }) => {
    const top = await resolveRepo();
    const safe = paths.map(assertSafePath);
    const head = await runGit(["rev-parse", "--verify", "-q", "HEAD"], { cwd: top });
    const r =
      head.code === 0
        ? await runGit(["restore", "--staged", "--", ...safe], { cwd: top })
        : await runGit(["rm", "--cached", "-r", "-q", "--", ...safe], { cwd: top });
    if (r.code !== 0) throw gitErr(r, "git restore --staged 失败");
    return ok({ unstaged: safe, status: await getStatus() });
  }
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
  async ({ paths }) => {
    const top = await resolveRepo();
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
  }
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
  async ({ message }) => {
    const top = await resolveRepo();
    const st = await getStatus();
    if (st.staged.length === 0 && st.conflicts.length === 0) {
      throw new Error("暂存区为空：请先添加要提交的文件（git_stage）。");
    }
    const r = await runGit(["-c", "i18n.commitEncoding=UTF-8", "commit", "--file=-"], { cwd: top, stdin: message });
    if (r.code !== 0) throw gitErr(r, "git commit 失败");
    const after = await getStatus();
    const m = r.stdout.match(/\[.*?\s([0-9a-f]{7,})\]/);
    return ok({ commit: m ? m[1] : undefined, output: r.stdout.trim(), status: after });
  }
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
  async ({ limit = 20 }) => {
    const top = await resolveRepo();
    const r = await runGit(
      ["-c", "core.quotepath=false", "log", `--pretty=format:%h%x09%an%x09%ad%x09%s`, "--date=short", `-n${limit}`],
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
  }
);

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

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
