// ---------------------------------------------------------------------------
// DOM 助手：各视图共用的元素构造器
// ---------------------------------------------------------------------------

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 「加载中/空态/错误」占位段落（diff 视图与图片比对共用） */
export const loadingEl = (text) => el("div", "diff-loading", text);

/** 悬停浮现的图标按钮 */
export function iconBtn({ icon, title, cls = "", onClick }) {
  const b = document.createElement("button");
  b.className = "btn icon" + (cls ? " " + cls : "");
  b.innerHTML = icon;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/**
 * 行内二次确认，整体替换 target 内容：「问题 [确认] (取消)」。
 * esc：确认按钮聚焦时按 Esc 触发 onCancel（批量撤销用）；
 * focus：插入后聚焦确认按钮（失焦回退由调用方的 focusout 监听负责）。
 */
export function confirmUI(target, { question, yesLabel, cancelLabel, onYes, onCancel, esc = false, focus = false }) {
  const q = el("span", "confirm-q", question);
  const yes = el("button", "btn danger", yesLabel);
  yes.addEventListener("click", (e) => {
    e.stopPropagation();
    onYes();
  });
  if (esc) {
    yes.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") onCancel();
    });
  }
  const parts = [q, yes];
  if (cancelLabel != null) {
    // 不加类会落到浏览器原生按钮样式，与面板风格脱节
    const no = el("button", "btn", cancelLabel);
    no.addEventListener("click", (e) => {
      e.stopPropagation();
      onCancel();
    });
    parts.push(no);
  }
  target.replaceChildren(...parts);
  if (focus) yes.focus();
}
