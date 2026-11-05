// Smoke test: boots dist/server.mjs against a throwaway git repo and drives
// the full MCP surface (handshake, tools/list, resources/read, all tools).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "git", "dist", "server.mjs");
const PANEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "git", "dist", "ui", "panel.html");

let nextId = 1;
let child;
let pending = new Map();
let buffer = "";

function send(method, params, isNotification = false) {
  const msg = isNotification
    ? { jsonrpc: "2.0", method, params: params ?? {} }
    : { jsonrpc: "2.0", id: nextId, method, params: params ?? {} };
  const id = msg.id;
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve, reject) => {
    if (isNotification) return resolve();
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 15000);
  });
}

function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
  }
}

function start(cwd) {
  child = spawn(process.execPath, [SERVER], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buffer += d;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => console.error("[server:err]", d.trim()));
  return child;
}

const results = [];
function check(name, cond, extra = "") {
  results.push([cond ? "PASS" : "FAIL", name, extra]);
  if (!cond) process.exitCode = 1;
}

async function call(name, args) {
  const r = await send("tools/call", { name, arguments: args });
  let payload = null;
  try {
    payload = JSON.parse(r.content?.[0]?.text ?? "null");
  } catch {}
  return { isError: !!r.isError, payload, raw: r };
}

async function main() {
  // --- fixture repo ---------------------------------------------------------
  const repo = await mkdtemp(path.join(tmpdir(), "git-plugin-smoke-"));
  const g = (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const c = spawn("git", args, { cwd: repo, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (err += d));
      c.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `git ${args[0]} failed`))));
      c.on("error", reject);
    });
  const git = async (args) => g(args).catch(async (e) => {
    // retry with UTF-8 message file for commit
    throw e;
  });
  await g(["init", "-b", "main"]);
  await g(["config", "user.email", "smoke@test"]);
  await g(["config", "user.name", "smoke"]);
  await writeFile(path.join(repo, "hello.txt"), "line1\nline2\n");
  await g(["add", "."]);
  const msgFile = path.join(repo, ".commitmsg");
  await writeFile(msgFile, "init: hello");
  await g(["commit", "--file=" + msgFile]);
  await rm(msgFile);
  await writeFile(path.join(repo, "hello.txt"), "line1\nline2-changed\nline3\n");
  await writeFile(path.join(repo, "new.txt"), "brand new\n");
  await g(["add", "new.txt"]);

  // --- server ---------------------------------------------------------------
  start(repo);
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  check("initialize handshake", !!init?.serverInfo?.name, `server=${init?.serverInfo?.name}`);
  await send("notifications/initialized", {}, true);

  const tools = await send("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  check(
    "tools/list",
    JSON.stringify(names) ===
      JSON.stringify([
        "git_blob", "git_branch_delete", "git_branch_list", "git_branch_merge", "git_checkout", "git_commit", "git_diff", "git_diff_batch", "git_discard", "git_log", "git_pull", "git_push",
        "git_show", "git_stage", "git_stash", "git_stash_apply", "git_stash_drop", "git_stash_list", "git_stash_pop", "git_status", "git_unstage",
      ]),
    names.join(",")
  );
  const statusTool = tools.tools.find((t) => t.name === "git_status");
  const vis = statusTool?._meta?.ui?.visibility;
  check("tool _meta.ui.visibility includes app+model", Array.isArray(vis) && vis.includes("app") && vis.includes("model"), JSON.stringify(vis));
  check("tool _meta.ui.resourceUri", statusTool?._meta?.ui?.resourceUri === "ui://git/panel.html", statusTool?._meta?.ui?.resourceUri);

  const res = await send("resources/list", {});
  check("resources/list has panel", res.resources?.some((r) => r.uri === "ui://git/panel.html"), JSON.stringify(res.resources?.map((r) => r.uri)));
  const read = await send("resources/read", { uri: "ui://git/panel.html" });
  const html = read.contents?.[0]?.text || "";
  check("resources/read panel.html", html.includes("<!doctype html>") && html.length > 10000, `${html.length} bytes`);
  const panelOnDisk = await readFile(PANEL, "utf8");
  check("panel served == dist file", html === panelOnDisk);

  // git_status
  let r = await call("git_status", {});
  check("git_status ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check("git_status branch=main", r.payload?.branch === "main", r.payload?.branch);
  check("git_status staged has new.txt", r.payload?.staged?.some((e) => e.path === "new.txt" && e.code === "A"));
  check("git_status unstaged has hello.txt", r.payload?.unstaged?.some((e) => e.path === "hello.txt" && e.code === "M"));
  check("git_status untracked none after add", !r.payload?.unstaged?.some((e) => e.code === "?"));
  check("git_status stashes=0", r.payload?.stashes === 0, JSON.stringify(r.payload?.stashes));

  // git_diff unstaged
  r = await call("git_diff", { path: "hello.txt" });
  check("git_diff worktree", !r.isError && r.payload?.text?.includes("+line3") && r.payload?.text?.includes("+line2-changed") && r.payload?.text?.includes("-line2"), "");
  check("git_diff has -line2", r.payload?.text?.includes("-line2"));
  // git_diff staged
  r = await call("git_diff", { path: "new.txt", staged: true });
  check("git_diff staged untracked-all-added", !r.isError && r.payload?.text?.includes("+++ b/new.txt") && r.payload?.text?.includes("+brand new"));

  // git_stage
  r = await call("git_stage", { paths: ["hello.txt"] });
  check("git_stage", !r.isError && r.payload?.status?.staged?.some((e) => e.path === "hello.txt"), "");

  // git_unstage
  r = await call("git_unstage", { paths: ["hello.txt"] });
  check("git_unstage", !r.isError && r.payload?.status?.unstaged?.some((e) => e.path === "hello.txt"), "");

  // git_discard (tracked)
  r = await call("git_discard", { paths: ["hello.txt"] });
  check("git_discard restores worktree", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  const restored = (await readFile(path.join(repo, "hello.txt"), "utf8")).replace(/\r\n/g, "\n");
  check("git_discard file content reverted", restored === "line1\nline2\n");

  // git_commit
  await call("git_stage", { paths: ["hello.txt", "new.txt"] });
  r = await call("git_commit", { message: "feat: smoke commit\n\n- add new.txt\n- tweak hello" });
  check("git_commit ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check("git_commit returns hash", typeof r.payload?.commit === "string" && r.payload.commit.length >= 7, r.payload?.commit);
  const log = await g(["log", "--oneline"]);
  check("commit visible in git log", log.includes("feat: smoke commit"));

  // git_log
  r = await call("git_log", { limit: 5 });
  check("git_log", !r.isError && r.payload?.commits?.length === 2 && r.payload?.commits?.[0]?.subject === "feat: smoke commit");
  const commits = r.payload?.commits || [];

  // git_show：HEAD 提交只含 new.txt（hello.txt 已被 git_discard 还原，提交时无改动）；
  // 根提交 init: hello 含 hello.txt 的全新增
  r = await call("git_show", { hash: commits[0]?.hash });
  check(
    "git_show diff",
    !r.isError && r.payload?.text?.includes("+++ b/new.txt") && r.payload?.text?.includes("+brand new"),
    r.isError ? r.raw.content?.[0]?.text : JSON.stringify(r.payload).slice(0, 300)
  );
  r = await call("git_show", { hash: commits[1]?.hash });
  check(
    "git_show root commit",
    !r.isError && r.payload?.text?.includes("+++ b/hello.txt") && r.payload?.text?.includes("+line2"),
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_show", { hash: "-invalid" });
  check("git_show rejects option-like hash", r.isError, JSON.stringify(r.payload));
  r = await call("git_show", { hash: "deadbeef" });
  check("git_show unknown hash errors", r.isError, "");

  // --- branch suite（本地分支列表与切换；feat-x 名字留给后面的 push 兜底套件）---
  await g(["branch", "branch-a"]);
  r = await call("git_branch_list", {});
  check(
    "git_branch_list locals",
    !r.isError && r.payload?.locals?.length === 2
      && r.payload.locals.some((b) => b.name === "main" && b.current === true)
      && r.payload.locals.some((b) => b.name === "branch-a" && b.current === false)
      && r.payload.locals.every((b) => typeof b.sha === "string" && b.sha.length >= 7)
      && r.payload?.remotes?.length === 0,
    JSON.stringify(r.payload)
  );
  r = await call("git_checkout", { branch: "branch-a" });
  check(
    "git_checkout branch-a",
    !r.isError && r.payload?.status?.branch === "branch-a",
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_checkout", { branch: "no-such-branch" });
  check("git_checkout missing branch errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  r = await call("git_checkout", { branch: "-evil" });
  check("git_checkout rejects option-like branch", r.isError);
  r = await call("git_checkout", { branch: "from-main", create: true });
  check(
    "git_checkout create from HEAD",
    !r.isError && r.payload?.status?.branch === "from-main",
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_checkout", { branch: "from-main", create: true });
  check("git_checkout create existing errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  r = await call("git_checkout", { branch: "main" });
  check(
    "git_checkout back to main",
    !r.isError && r.payload?.status?.branch === "main",
    r.isError ? r.raw.content?.[0]?.text : ""
  );

  // --- branch delete suite（删除本地分支：-d 默认 / BRANCH_UNMERGED / force）----
  r = await call("git_branch_delete", { name: "branch-a" });
  check(
    "git_branch_delete merged branch",
    !r.isError && String(r.payload?.output || "").includes("Deleted branch"),
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_branch_list", {});
  check("git_branch_delete removed from list", !r.payload?.locals?.some((b) => b.name === "branch-a"));
  r = await call("git_branch_delete", { name: "no-such-branch" });
  check("git_branch_delete missing branch errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  r = await call("git_branch_delete", { name: "main" });
  check("git_branch_delete current branch errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  await g(["checkout", "-b", "unmerged-b"]);
  await writeFile(path.join(repo, "un.txt"), "unmerged\n");
  await g(["add", "un.txt"]);
  const unMsg = path.join(repo, ".unmsg");
  await writeFile(unMsg, "feat: unmerged commit");
  await g(["commit", "--file=" + unMsg]);
  await rm(unMsg);
  await g(["checkout", "main"]);
  r = await call("git_branch_delete", { name: "unmerged-b" });
  check(
    "git_branch_delete unmerged rejected with code",
    r.isError && r.raw.structuredContent?.code === "BRANCH_UNMERGED",
    JSON.stringify(r.raw.structuredContent)
  );
  r = await call("git_branch_list", {});
  check("git_branch_delete unmerged still listed", r.payload?.locals?.some((b) => b.name === "unmerged-b"));
  r = await call("git_branch_delete", { name: "unmerged-b", force: true });
  check(
    "git_branch_delete force unmerged ok",
    !r.isError,
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_branch_list", {});
  check("git_branch_delete force removed from list", !r.payload?.locals?.some((b) => b.name === "unmerged-b"));

  // --- branch merge suite（合并进当前分支：fast-forward / 冲突 GIT_ERROR / 非法分支名）----
  await g(["checkout", "-b", "merge-b"]);
  await writeFile(path.join(repo, "merge.txt"), "from merge-b\n");
  await g(["add", "merge.txt"]);
  const mMsg = path.join(repo, ".mmsg");
  await writeFile(mMsg, "feat: merge-b commit");
  await g(["commit", "--file=" + mMsg]);
  await rm(mMsg);
  await g(["checkout", "main"]);
  r = await call("git_branch_merge", { name: "merge-b" });
  check(
    "git_branch_merge fast-forward brings content",
    !r.isError
      && r.payload?.status?.branch === "main"
      && String(await readFile(path.join(repo, "merge.txt"), "utf8")).includes("from merge-b"),
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_branch_merge", { name: "-evil" });
  check("git_branch_merge rejects option-like branch", r.isError);
  r = await call("git_branch_merge", { name: "no-such-branch" });
  check("git_branch_merge missing branch errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  // 冲突：从当前 main 拉出 conflict-b 改同一行，随后 main 也改这一行
  await g(["checkout", "-b", "conflict-b"]);
  await writeFile(path.join(repo, "merge.txt"), "branch side\n");
  await g(["add", "merge.txt"]);
  const cMsg = path.join(repo, ".cmsg");
  await writeFile(cMsg, "feat: branch side");
  await g(["commit", "--file=" + cMsg]);
  await rm(cMsg);
  await g(["checkout", "main"]);
  await writeFile(path.join(repo, "merge.txt"), "main side\n");
  await g(["add", "merge.txt"]);
  await writeFile(cMsg, "feat: main side");
  await g(["commit", "--file=" + cMsg]);
  await rm(cMsg);
  r = await call("git_branch_merge", { name: "conflict-b" });
  check(
    "git_branch_merge conflict errors with git output",
    r.isError && /CONFLICT|Automatic merge failed/.test(String(r.raw.structuredContent?.message || "")),
    JSON.stringify(r.raw.structuredContent)
  );
  await g(["merge", "--abort"]); // 清掉冲突现场，不影响后续套件
  r = await call("git_branch_delete", { name: "conflict-b", force: true });
  check("git_branch_delete conflict-b force ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  r = await call("git_branch_delete", { name: "merge-b" });
  check("git_branch_delete merge-b merged ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");

  // ugit-stash/*（客户端切换分支贮藏的备份分支）不进本地分支列表
  await g(["branch", "ugit-stash/deadbee-1"]);
  r = await call("git_branch_list", {});
  check(
    "git_branch_list hides ugit-stash backup branches",
    !r.payload?.locals?.some((b) => /^ugit-stash\//.test(b.name)),
    JSON.stringify(r.payload?.locals?.map((b) => b.name))
  );

  // --- stash suite -----------------------------------------------------------
  await writeFile(path.join(repo, "hello.txt"), "line1\nline2\nstashed\n");
  r = await call("git_stash", {});
  check("git_stash pushes all changes", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check("git_stash leaves tree clean", r.payload?.status?.unstaged?.length === 0);
  check("git_stash stashes=1", r.payload?.status?.stashes === 1, JSON.stringify(r.payload?.status?.stashes));
  r = await call("git_stash_list", {});
  check(
    "git_stash_list one entry",
    !r.isError && r.payload?.entries?.length === 1 && r.payload.entries[0].ref === "stash@{0}",
    JSON.stringify(r.payload?.entries)
  );
  r = await call("git_stash_apply", { ref: "stash@{0}" });
  check(
    "git_stash_apply restores and keeps entry",
    !r.isError && r.payload?.status?.stashes === 1 && r.payload?.status?.unstaged?.some((e) => e.path === "hello.txt"),
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  r = await call("git_stash_apply", { ref: "bogus" });
  check("git_stash_apply rejects invalid ref", r.isError);
  // 先丢弃 apply 带回的改动，pop 才不会冲突
  await call("git_discard", { paths: ["hello.txt"] });
  r = await call("git_stash_pop", {});
  check("git_stash_pop removes entry", !r.isError && r.payload?.status?.stashes === 0, r.isError ? r.raw.content?.[0]?.text : "");
  check("git_stash_pop restores changes", r.payload?.status?.unstaged?.some((e) => e.path === "hello.txt"));
  r = await call("git_status", {});
  check("git_status stashes back to 0", r.payload?.stashes === 0);
  // 收尾：丢弃 pop 带回的改动，保持后续断言环境干净
  await call("git_discard", { paths: ["hello.txt"] });

  // --- pull without upstream must error --------------------------------------
  r = await call("git_pull", {});
  check("git_pull without upstream errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);

  // --- push suite（bare 远程 + 上游跟踪）--------------------------------------
  r = await call("git_push", {});
  check("git_push without upstream errors", r.isError, r.isError ? "" : r.raw.content?.[0]?.text);
  const remote = await mkdtemp(path.join(tmpdir(), "git-plugin-smoke-remote-"));
  await g(["init", "--bare", remote]);
  await g(["remote", "add", "origin", remote]);
  await g(["push", "-u", "origin", "main"]);
  await writeFile(path.join(repo, "pushed.txt"), "pushed\n");
  await g(["add", "pushed.txt"]);
  const pushMsgFile = path.join(repo, ".pushmsg");
  await writeFile(pushMsgFile, "feat: to be pushed");
  await g(["commit", "--file=" + pushMsgFile]);
  await rm(pushMsgFile);
  r = await call("git_push", {});
  check("git_push ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check(
    "git_push status ahead=0 behind=0",
    r.payload?.status?.ahead === 0 && r.payload?.status?.behind === 0,
    JSON.stringify({ ahead: r.payload?.status?.ahead, behind: r.payload?.status?.behind })
  );
  const remoteLog = await g(["--git-dir", remote, "log", "--oneline", "main"]);
  check("git_push commit reached remote", remoteLog.includes("feat: to be pushed"), remoteLog);
  r = await call("git_push", {});
  check("git_push up-to-date ok", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");

  // --- push 无感兜底：新分支无上游，但有 origin 时应自动 -u 建跟踪后重推 -------
  await g(["checkout", "-b", "feat-x"]);
  await writeFile(path.join(repo, "fb.txt"), "fallback\n");
  await g(["add", "fb.txt"]);
  const fbMsg = path.join(repo, ".fbmsg");
  await writeFile(fbMsg, "feat: fallback push");
  await g(["commit", "--file=" + fbMsg]);
  await rm(fbMsg);
  r = await call("git_push", {});
  check("git_push new branch falls back to -u", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check(
    "git_push fallback sets upstream",
    String(r.payload?.status?.upstream || "").includes("origin/feat-x"),
    r.payload?.status?.upstream
  );
  const remoteFbLog = await g(["--git-dir", remote, "log", "--oneline", "feat-x"]);
  check("git_push fallback commit on remote", remoteFbLog.includes("feat: fallback push"), remoteFbLog);
  await g(["checkout", "main"]);

  // --- branch suite（远程分支）：列表带 origin/*，可从远程建跟踪本地分支 --------
  r = await call("git_branch_list", {});
  check(
    "git_branch_list remotes",
    !r.isError && r.payload?.remotes?.some((b) => b.name === "origin/feat-x" && b.current === false),
    JSON.stringify(r.payload?.remotes)
  );
  r = await call("git_checkout", { branch: "feat-y", create: true, startPoint: "origin/feat-x" });
  check(
    "git_checkout from remote start point tracks upstream",
    !r.isError && r.payload?.status?.branch === "feat-y" && r.payload?.status?.upstream === "origin/feat-x",
    r.isError ? r.raw.content?.[0]?.text : JSON.stringify(r.payload?.status?.upstream)
  );
  await g(["checkout", "main"]);

  // --- git_diff scope（上下文范围：line/function/file）------------------------
  const wide = Array.from({ length: 60 }, (_, i) => `line${i + 1} content`).join("\n") + "\n";
  await writeFile(path.join(repo, "wide.txt"), wide);
  await g(["add", "wide.txt"]);
  const wideMod = wide.replace("line1 content", "line1 modified").replace("line60 content", "line60 modified");
  await writeFile(path.join(repo, "wide.txt"), wideMod);
  r = await call("git_diff", { path: "wide.txt" });
  check(
    "git_diff default context hides middle",
    !r.isError && r.payload?.text?.includes("+line1 modified") && !r.payload?.text?.includes("line30 content"),
    ""
  );
  r = await call("git_diff", { path: "wide.txt", scope: "file" });
  check("git_diff scope=file shows middle", !r.isError && r.payload?.text?.includes("line30 content"));
  r = await call("git_diff", { path: "wide.txt", scope: "function" });
  check("git_diff scope=function ok", !r.isError && r.payload?.text?.includes("+line1 modified"));
  // 还原：取消暂存并丢弃
  await call("git_unstage", { paths: ["wide.txt"] });
  await call("git_discard", { paths: ["wide.txt"] });

  // --- git_diff_batch（批量 diff：AI 生成提交信息的收集路径）-------------------
  await mkdir(path.join(repo, "资产"), { recursive: true });
  await writeFile(path.join(repo, "资产", "场景.prefab"), "prefab v1\n");
  await writeFile(path.join(repo, "batch.bin"), Buffer.from([1, 0, 2, 0, 255]));
  await g(["add", "资产", "batch.bin"]);
  const batchMsg = path.join(repo, ".commitmsg");
  await writeFile(batchMsg, "batch fixture");
  await g(["commit", "--file=" + batchMsg]);
  await rm(batchMsg);
  await g(["mv", "资产/场景.prefab", "资产/场景-改名.prefab"]);
  // commit 后再改 binary 文件使其进入暂存区，批量 diff 才有二进制块可断言
  await writeFile(path.join(repo, "batch.bin"), Buffer.from([9, 9, 9, 0, 8]));
  await g(["add", "batch.bin"]);
  r = await call("git_diff_batch", { paths: ["资产/场景-改名.prefab", "batch.bin", "没有.txt"], staged: true });
  check(
    "git_diff_batch order & rename chunk",
    !r.isError &&
      r.payload?.diffs?.length === 3 &&
      r.payload?.diffs[0]?.path === "资产/场景-改名.prefab" &&
      r.payload?.diffs[0]?.text?.includes("+++ b/资产/场景-改名.prefab") &&
      r.payload?.diffs[0]?.text?.includes("prefab v1"),
    JSON.stringify(r.payload?.diffs?.map((d) => [d.path, d.binary, d.text?.length]))
  );
  check("git_diff_batch binary flag", r.payload?.diffs?.[1]?.binary === true, "");
  check("git_diff_batch missing placeholder", r.payload?.diffs?.[2]?.text?.includes("没有该文件的变更"), "");
  // 工作区视图：未跟踪文件合成 diff，无变更文件占位
  await writeFile(path.join(repo, "新文件.txt"), "untracked content\n");
  r = await call("git_diff_batch", { paths: ["新文件.txt", "hello.txt"], staged: false });
  check("git_diff_batch untracked synthesized", !r.isError && r.payload?.diffs?.[0]?.text?.includes("+untracked content"), "");
  check("git_diff_batch unchanged placeholder", r.payload?.diffs?.[1]?.text?.includes("没有该文件的变更"), "");
  // 还原：硬重置到 fixture 提交并清掉磁盘残留，后续「空暂存区提交报错」等断言依赖干净状态
  await g(["reset", "--hard", "HEAD"]);
  await rm(path.join(repo, "batch.bin"), { force: true });
  await rm(path.join(repo, "新文件.txt"), { force: true });
  await rm(path.join(repo, "资产"), { recursive: true, force: true });

  // --- git_blob（图片预览比对的数据源）----------------------------------------
  r = await call("git_blob", { path: "hello.txt", rev: "worktree" });
  check("git_blob worktree text", !r.isError && r.payload?.text?.includes("line1"), r.isError ? r.raw.content?.[0]?.text : "");
  r = await call("git_blob", { path: "hello.txt", rev: "HEAD" });
  check("git_blob HEAD rev", !r.isError && r.payload?.text?.includes("line2"));
  const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await writeFile(path.join(repo, "img.png"), PNG_1PX);
  await g(["add", "img.png"]);
  r = await call("git_blob", { path: "img.png", rev: "index" });
  check(
    "git_blob image base64 roundtrip",
    !r.isError && r.payload?.mime === "image/png" && Buffer.from(r.payload.base64, "base64").equals(PNG_1PX),
    r.isError ? r.raw.content?.[0]?.text : ""
  );
  await writeFile(path.join(repo, "big.png"), Buffer.alloc(3 * 1024 * 1024 + 10, 7));
  await g(["add", "big.png"]);
  r = await call("git_blob", { path: "big.png", rev: "index" });
  check("git_blob oversize tooLarge", !r.isError && r.payload?.tooLarge === true);
  await writeFile(path.join(repo, "data.bin"), Buffer.from([1, 0, 2, 0, 255]));
  await g(["add", "data.bin"]);
  r = await call("git_blob", { path: "data.bin", rev: "index" });
  check("git_blob non-image binary flag", !r.isError && r.payload?.binary === true);
  // 还原暂存区（后续「空暂存区提交报错」断言依赖）
  await call("git_unstage", { paths: ["img.png", "big.png", "data.bin"] });

  // commit with empty index must error
  r = await call("git_commit", { message: "should fail" });
  check("git_commit empty index errors", r.isError);

  // untracked discard (delete)
  await writeFile(path.join(repo, "tmp-untracked.txt"), "bye\n");
  r = await call("git_discard", { paths: ["tmp-untracked.txt"] });
  check("git_discard deletes untracked", !r.isError && r.payload?.deletedUntracked?.includes("tmp-untracked.txt"));
  let exists = true;
  await readFile(path.join(repo, "tmp-untracked.txt")).catch(() => (exists = false));
  check("untracked file removed from disk", !exists);

  // unstage before any HEAD (initial-commit case)
  const repo2 = await mkdtemp(path.join(tmpdir(), "git-plugin-smoke2-"));
  child.kill();
  buffer = "";
  pending.clear();
  const g2 = (args) =>
    new Promise((res2, rej2) => {
      const c = spawn("git", args, { cwd: repo2, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      c.stderr.on("data", (d) => (err += d));
      c.on("close", (code) => (code === 0 ? res2() : rej2(new Error(err))));
    });
  await g2(["init", "-b", "main"]);
  await g2(["config", "user.email", "s@t"]);
  await g2(["config", "user.name", "s"]);
  await writeFile(path.join(repo2, "a.txt"), "x\n");
  await g2(["add", "a.txt"]);
  start(repo2);
  await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  await send("notifications/initialized", {}, true);
  r = await call("git_unstage", { paths: ["a.txt"] });
  check("git_unstage works pre-HEAD (rm --cached)", !r.isError && r.payload?.status?.staged?.length === 0, r.isError ? r.raw.content?.[0]?.text : "");

  // path traversal guard
  r = await call("git_stage", { paths: ["../outside.txt"] });
  check("path traversal rejected", r.isError);

  // git_status in a non-repo directory must NOT be an error (host refuses to
  // load the panel UI when the open-time tool call returns isError)
  const nonRepo = await mkdtemp(path.join(tmpdir(), "git-plugin-norepo-"));
  child.kill();
  buffer = "";
  pending.clear();
  start(nonRepo);
  await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  await send("notifications/initialized", {}, true);
  r = await call("git_status", {});
  check("git_status non-repo is not isError", !r.isError, r.isError ? r.raw.content?.[0]?.text : "");
  check("git_status non-repo ok:false", r.payload?.ok === false && r.payload?.reason === "not_a_git_repo", JSON.stringify(r.payload?.reason));
  child.kill();
  await rm(nonRepo, { recursive: true, force: true }).catch(() => {});

  child.kill();
  await rm(repo, { recursive: true, force: true }).catch(() => {});
  await rm(repo2, { recursive: true, force: true }).catch(() => {});
  await rm(remote, { recursive: true, force: true }).catch(() => {});

  console.log("\n=== smoke results ===");
  for (const [s, n, extra] of results) console.log(`${s}  ${n}${extra ? "  — " + extra : ""}`);
  const fails = results.filter((r2) => r2[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  child?.kill();
  process.exit(1);
});
