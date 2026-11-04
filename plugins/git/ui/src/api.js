// ---------------------------------------------------------------------------
// 与宿主/server 的通信层：App 实例、工具调用、错误分类
// ---------------------------------------------------------------------------

import { App } from "@modelcontextprotocol/ext-apps";

export const app = new App({ name: "git-panel", version: __APP_VERSION__ }); // 构建时由 build.mjs 注入 plugin.json 的版本

export async function callTool(name, args) {
  const res = await app.callServerTool({ name, arguments: args });
  let payload = null;
  const raw = res?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (res?.isError) {
    // server 在 structuredContent 附带稳定错误码（NOT_A_REPO/GIT_MISSING/…），
    // 文案仅作展示与兜底，UI 判定一律走 code。
    const err = new Error(payload?.error || res?.structuredContent?.message || raw || `tool ${name} failed`);
    err.code = res?.structuredContent?.code || null;
    throw err;
  }
  return payload;
}

export function isNoRepo(err) {
  return err?.code === "NOT_A_REPO" || /不是 Git 仓库|not a git repository/i.test(String(err?.message || ""));
}
export function isNoGit(err) {
  return err?.code === "GIT_MISSING" || /未找到 git|not found/i.test(String(err?.message || ""));
}
