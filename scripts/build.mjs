// Bundles the plugin: server (node) + panel UI (inline html).
// Usage: node scripts/build.mjs
import esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "git");

// server 与面板内 App 上报的版本号自动取自 plugin.json，避免多处手工同步
const manifest = JSON.parse(await readFile(path.join(plugin, ".zcode-plugin", "plugin.json"), "utf8"));
const VERSION_DEFINE = { __APP_VERSION__: JSON.stringify(manifest.version) };

// 仓库根 marketplace.json（宿主 git 市场源只认这份清单）的版本与描述自动对齐 plugin.json：
// 曾因手工漏改长期停在 0.5.0，导致市场/GitHub 下载显示旧版本。icon/displayName 仍归清单自己管。
const marketPath = path.join(root, "marketplace.json");
const market = JSON.parse(await readFile(marketPath, "utf8"));
const marketEntry = market.plugins?.find((x) => x.name === manifest.name);
if (marketEntry) {
  const before = JSON.stringify(marketEntry);
  marketEntry.version = manifest.version;
  marketEntry.description = manifest.description;
  marketEntry.description_i18n = manifest.description_i18n;
  if (JSON.stringify(marketEntry) !== before) {
    await writeFile(marketPath, JSON.stringify(market, null, 2) + "\n");
    console.log("market -> marketplace.json synced to", manifest.version);
  }
}

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
  define: VERSION_DEFINE,
  banner: {
    // ensure shebang-free ESM runs even when CJS interop needs it
    js: `import { createRequire as __crc } from "node:module"; const require = __crc(import.meta.url);`,
  },
});
console.log("server -> plugins/git/dist/server.mjs");

// --- panel -------------------------------------------------------------------
const js = await esbuild.build({
  entryPoints: [path.join(plugin, "ui", "src", "main.js")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: VERSION_DEFINE,
  write: false,
});
const bundle = js.outputFiles[0].text;
const css = await readFile(path.join(plugin, "ui", "src", "panel.css"), "utf8");

// DOM 骨架源文件见 ui/src/panel.html。占位符必须用函数替换：
// 直接传字符串时，压缩产物里的 $&、$' 等序列会被 replace 当作特殊引用误解释。
const tpl = await readFile(path.join(plugin, "ui", "src", "panel.html"), "utf8");
const html = tpl.replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => bundle);
await writeFile(path.join(plugin, "dist", "ui", "panel.html"), html);
console.log("panel  -> plugins/git/dist/ui/panel.html", `(${html.length} bytes)`);
