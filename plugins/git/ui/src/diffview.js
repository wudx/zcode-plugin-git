// ---------------------------------------------------------------------------
// diff 渲染器：unified 行分类、并排行拆分与两侧视图
// ---------------------------------------------------------------------------

import { IMAGE_MIME } from "../../../shared/images.js";
import { renderCode } from "./syntax.js";

// 图片扩展名判定：与 server 的 IMAGE_MIME（git_blob 的 MIME 表）共用单一真源
export const IMAGE_RE = new RegExp(`\\.(${Object.keys(IMAGE_MIME).join("|")})$`, "i");

export function diffLineClass(line) {
  if (line.startsWith("@@")) return "dl-hunk";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "dl-meta";
  if (line.startsWith("\\")) return "dl-meta"; // "\ No newline at end of file"
  if (line.startsWith("+")) return "dl-add";
  if (line.startsWith("-")) return "dl-del";
  return "dl-ctx"; // 上下文行：与文件头同为信息行，但需按代码渲染，单独成类
}

export function unifiedView(text, lang) {
  const pre = document.createElement("pre");
  pre.className = "diff";
  // 行元素在 CSS 里是 display:block，自带换行；这里不能再补 "\n" 文本节点，
  // 否则 pre(white-space:pre) 下每行后都会多出一个空行
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const items = lines.map((line) => ({ line, cls: diffLineClass(line) }));
  // 语法状态按文件分列：删除行走旧文件，新增/上下文行走新文件
  const stOld = lang ? { block: false } : null;
  const stNew = lang ? { block: false } : null;
  let prevChg = false;
  let oldNo = null;
  let newNo = null;
  for (const it of items) {
    const span = document.createElement("span");
    span.className = it.cls;
    if (it.cls === "dl-ctx" || it.cls === "dl-add" || it.cls === "dl-del") {
      span.innerHTML = renderCode(it.line, lang, it.cls === "dl-del" ? stOld : stNew);
    } else {
      span.textContent = it.line || " "; // 空行用空格撑出行高
    }
    // 行号沟槽：删除行显示旧文件行号，新增/上下文行显示新文件行号（GitHub 统一视图样式）；
    // 走 data-ln + CSS ::before 渲染，行内嵌套 span 不改变 textContent，迷你地图解析不受影响
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(it.line);
    if (hm) {
      oldNo = Number.parseInt(hm[1], 10);
      newNo = Number.parseInt(hm[2], 10);
    } else if (it.cls === "dl-add") {
      span.dataset.ln = newNo ?? "";
      if (newNo !== null) newNo += 1;
    } else if (it.cls === "dl-del") {
      span.dataset.ln = oldNo ?? "";
      if (oldNo !== null) oldNo += 1;
    } else if (it.cls === "dl-ctx") {
      span.dataset.ln = newNo ?? ""; // 上下文行
      if (oldNo !== null) oldNo += 1;
      if (newNo !== null) newNo += 1;
    }
    const chg = it.cls === "dl-add" || it.cls === "dl-del";
    if (chg && !prevChg) span.classList.add("chg-start"); // 每段连续增删行的首行，供上/下一个更改跳转
    prevChg = chg;
    pre.appendChild(span);
  }
  return pre;
}

/**
 * 把 unified diff 拆成并排行：连续的删除行与新增行按顺序左右配对，
 * 多出的一侧留空；hunk 头与文件头为跨全宽的整行。带行号沟槽。
 */
export function parseSplitRows(text) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  let left = [];
  let right = [];
  let oldNo = null;
  let newNo = null;
  let prevChg = false;
  const pushPair = (l, r) => {
    const chg = (l !== null && l.text.startsWith("-")) || (r !== null && r.text.startsWith("+"));
    rows.push({ kind: "pair", left: l, right: r, chgStart: chg && !prevChg });
    prevChg = chg;
  };
  const flush = () => {
    const count = Math.max(left.length, right.length);
    for (let i = 0; i < count; i += 1) pushPair(left[i] ?? null, right[i] ?? null);
    left = [];
    right = [];
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = m === null ? null : Number.parseInt(m[1], 10);
      newNo = m === null ? null : Number.parseInt(m[2], 10);
      rows.push({ kind: "hunk", text: line });
      prevChg = false; // hunk 头断开更改段
    } else if (
      line.startsWith("diff ") || line.startsWith("index ") ||
      line.startsWith("--- ") || line.startsWith("+++ ")
    ) {
      flush();
      rows.push({ kind: "meta", text: line });
      prevChg = false; // 文件头断开更改段
    } else if (line.startsWith("-")) {
      if (right.length > 0) flush(); // 异常顺序（新增后紧跟删除）时先结算，保证左右不串行
      left.push({ no: oldNo, text: line });
      if (oldNo !== null) oldNo += 1;
    } else if (line.startsWith("+")) {
      right.push({ no: newNo, text: line });
      if (newNo !== null) newNo += 1;
    } else if (line.startsWith("\\")) {
      // “\ No newline at end of file”：并排视图不单独占行
    } else {
      flush();
      pushPair({ no: oldNo, text: line }, { no: newNo, text: line });
      if (oldNo !== null) oldNo += 1;
      if (newNo !== null) newNo += 1;
    }
  }
  flush();
  return rows;
}

export function splitView(text, lang) {
  const grid = document.createElement("div");
  grid.className = "split-grid";
  const cell = (cls, txt) => {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = txt === "" || txt == null ? " " : txt;
    return s;
  };
  // 代码格走语法高亮；左右两列各自维护语法状态（分属旧/新文件）
  const stL = lang ? { block: false } : null;
  const stR = lang ? { block: false } : null;
  const codeCell = (cls, txt, st) => {
    const s = document.createElement("span");
    s.className = cls;
    s.innerHTML = renderCode(txt == null ? "" : txt, lang, st);
    return s;
  };
  parseSplitRows(text).forEach((row) => {
    if (row.kind !== "pair") {
      grid.appendChild(cell(`cell-span ${row.kind === "hunk" ? "dl-hunk" : "dl-meta"}`, row.text));
      return;
    }
    const lTone = row.left !== null && row.left.text.startsWith("-") ? " cell-del" : "";
    const rTone = row.right !== null && row.right.text.startsWith("+") ? " cell-add" : "";
    const lNum = cell("cell-num", row.left === null ? "" : row.left.no ?? "");
    if (row.chgStart) lNum.classList.add("chg-start"); // 每段连续增删行的首行，供上/下一个更改跳转
    grid.appendChild(lNum);
    grid.appendChild(codeCell("cell-code" + lTone, row.left === null ? "" : row.left.text, stL));
    grid.appendChild(cell("cell-num num-r", row.right === null ? "" : row.right.no ?? ""));
    grid.appendChild(codeCell("cell-code" + rTone, row.right === null ? "" : row.right.text, stR));
  });
  const scroll = document.createElement("div");
  scroll.className = "split-scroll";
  scroll.appendChild(grid);
  return scroll;
}
