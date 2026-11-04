// Bundles the plugin: server (node) + panel UI (inline html).
// Usage: node scripts/build.mjs
import esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "git");

// --- server -----------------------------------------------------------------
await esbuild.build({
  entryPoints: [path.join(plugin, "server", "server.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: path.join(plugin, "dist", "server.mjs"),
  minify: true,
  legalComments: "none",
  banner: {
    // ensure shebang-free ESM runs even when CJS interop needs it
    js: `import { createRequire as __crc } from "node:module"; const require = __crc(import.meta.url);`,
  },
});
console.log("server -> plugins/git/dist/server.mjs");

// --- panel -------------------------------------------------------------------
// 面板内 App 上报的版本号自动取自 plugin.json，避免两处手工同步
const manifest = JSON.parse(await readFile(path.join(plugin, ".zcode-plugin", "plugin.json"), "utf8"));
const js = await esbuild.build({
  entryPoints: [path.join(plugin, "ui", "src", "main.js")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  write: false,
});
const bundle = js.outputFiles[0].text;
const css = await readFile(path.join(plugin, "ui", "src", "panel.css"), "utf8");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Git</title>
<style>
${css}
</style>
</head>
<body>
<div id="fatal" hidden></div>
<div id="header">
  <span id="branch"></span>
  <span id="ahead-behind" hidden></span>
  <span class="spacer"></span>
  <button id="view-btn" class="btn icon"></button>
  <button id="pull-btn" class="btn icon"></button>
  <button id="stash-btn" class="btn icon"><span id="stash-btn-icon"></span><span id="stash-badge" hidden></span></button>
  <div id="stash-menu" hidden></div>
</div>
<div id="scroll">
  <div id="conflict-box" hidden>
    <div id="conflict-title"></div>
    <div id="conflict-list"></div>
  </div>
  <div class="section-h"><span id="staged-title"></span> <span id="staged-count"></span><span class="flex1"></span><span id="staged-all" class="sec-actions"></span></div>
  <div id="staged-list"></div>
  <div id="staged-empty" class="section-empty" hidden></div>
  <div class="section-h"><span id="worktree-title"></span> <span id="worktree-count"></span><span class="flex1"></span><span id="worktree-all" class="sec-actions"></span></div>
  <div id="worktree-list"></div>
  <div id="worktree-empty" class="section-empty" hidden></div>
  <div id="clean" hidden></div>
</div>
<div id="commit-bar">
  <textarea id="commit-msg" spellcheck="false"></textarea>
  <div id="commit-actions">
    <button id="ai-btn" class="btn"></button>
    <button id="prompt-btn" class="btn icon"></button>
    <button id="commit-btn" class="btn" disabled></button>
  </div>
  <textarea id="prompt-area" spellcheck="false" maxlength="2000" hidden></textarea>
</div>
<div id="toast"></div>
<script>
${bundle}
</script>
</body>
</html>
`;
await writeFile(path.join(plugin, "dist", "ui", "panel.html"), html);
console.log("panel  -> plugins/git/dist/ui/panel.html", `(${html.length} bytes)`);
