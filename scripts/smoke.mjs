// Smoke test: boots dist/server.mjs against a throwaway git repo and drives
// the full MCP surface (handshake, tools/list, resources/read, all tools).
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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
      JSON.stringify(["git_commit", "git_diff", "git_discard", "git_log", "git_stage", "git_status", "git_unstage"]),
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

  child.kill();
  await rm(repo, { recursive: true, force: true }).catch(() => {});
  await rm(repo2, { recursive: true, force: true }).catch(() => {});

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
