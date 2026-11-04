// ---------------------------------------------------------------------------
// diff 代码高亮：轻量正则分词（无第三方依赖），产出区间由 renderCode
// 合并转义为一层 HTML。
// ---------------------------------------------------------------------------

const SYN_LANG_BY_EXT = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js",
  json: "json", css: "css", scss: "css", less: "css",
  py: "py", pyw: "py", sh: "sh", bash: "sh", zsh: "sh",
  go: "go", rs: "rs", md: "md", markdown: "md",
  html: "html", xml: "html", vue: "html", svg: "html",
  java: "clike", kt: "clike", c: "clike", h: "clike", cpp: "clike",
  cc: "clike", hpp: "clike", cs: "clike", swift: "clike",
};

export function extLang(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path || "");
  return m ? SYN_LANG_BY_EXT[m[1].toLowerCase()] || null : null;
}

const SYN_KW = {
  js: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await get set",
  json: "true false null",
  py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case True False None",
  sh: "if then else elif fi for while do done case esac function return in select until time coproc echo cd exit set unset export local readonly shift source alias unalias",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota",
  rs: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod mut pub ref return self Self static struct super trait true type unsafe use where while",
  clike: "abstract as base bool break byte case catch char class const continue decimal default delegate do double dynamic else enum event explicit extern false finally fixed float for foreach get goto if implicit in int interface internal is lock long namespace new null object operator out override params partial private protected public readonly ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile when where while var func let",
};
for (const k of Object.keys(SYN_KW)) SYN_KW[k] = new Set(SYN_KW[k].split(" "));

// 各语言分词正则：组序即优先级（注释/字符串在前，防止 "#include" 之类被吃掉）；
// clike/go/rs/json 与 js 共用同一组序。组的语义见 SYN_GROUPS。
const SYN_RES = {
  js: /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|\/\*[\s\S]*$)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g,
  py: /(#[^\n]*)|([rbfu]{0,2}"(?:[^"\\\n]|\\.)*"|[rbfu]{0,2}'(?:[^'\\\n]|\\.)*'|"""[\s\S]*?"""|'''[\s\S]*?''')|(\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_][\w]*)/g,
  sh: /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\$\{\w+\}|\$\w+)|(\b\d+\b)|([A-Za-z_][\w]*)/g,
  css: /(\/\*[\s\S]*?\*\/|\/\*[\s\S]*$)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(-?\d[\d.]*(?:px|em|rem|vh|vw|vmin|vmax|s|ms|deg|fr|ch|pt|%)*\b)|([a-zA-Z-]+(?=\s*:))|(#[\w-]+|--[\w-]+)/g,
  html: /(<!--)|(<\/?[a-zA-Z][\w-]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|([a-zA-Z-]+)(?==)|(\/?>)/g,
};
const SYN_GROUPS = {
  js: ["com", "str", "num", "id"],
  py: ["com", "str", "num", "id"],
  sh: ["com", "str", "type", "num", "id"], // $变量 用 type 色
  css: ["com", "str", "kw", "num", "num", "kw", "str"],
  html: ["com", "fn", "str", "type", ""],
};

function escHtml(s) {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function synNextNonSpace(line, i) {
  while (line[i] === " " || line[i] === "\t") i += 1;
  return line[i];
}

/** 把一行代码扫成 [start, end, cls] 区间；st.block 跨行跟踪块注释与 md 围栏状态 */
function synScan(line, lang, st, out) {
  if (!lang) return;
  if (lang === "md") { synScanMd(line, st, out); return; }
  let i = 0;
  if (st && st.block) { // 上一行未闭合的块注释/HTML 注释
    const mark = lang === "html" ? "-->" : "*/";
    const close = line.indexOf(mark);
    if (close === -1) { out.push([0, line.length, "com"]); return; }
    out.push([0, close + mark.length, "com"]);
    i = close + mark.length;
    st.block = false;
  }
  if (lang === "html") { synScanHtml(line, i, st, out); return; }
  const res = SYN_RES[lang === "clike" || lang === "go" || lang === "rs" || lang === "json" ? "js" : lang];
  const groups = SYN_GROUPS[lang === "clike" || lang === "go" || lang === "rs" || lang === "json" ? "js" : lang];
  if (!res) return;
  res.lastIndex = i;
  for (let m = res.exec(line); m; m = res.exec(line)) {
    let gi = 0;
    for (let g = 1; g < m.length; g += 1) if (m[g] !== undefined) { gi = g; break; }
    const cls = groups[gi - 1];
    const end = m.index + m[0].length;
    if (cls === "com") {
      out.push([m.index, end, "com"]);
      if (m[0].startsWith("/*") && !m[0].endsWith("*/")) st.block = true; // 未闭合块注释延续到下一行
    } else if (cls === "str") {
      // json 里后跟 ":" 的字符串是键，用数字色区分
      out.push([m.index, end, lang === "json" && synNextNonSpace(line, end) === ":" ? "num" : "str"]);
    } else if (cls === "id") {
      const word = m[0];
      if (SYN_KW[lang]?.has(word)) out.push([m.index, end, "kw"]);
      else if (synNextNonSpace(line, end) === "(") out.push([m.index, end, "fn"]);
      else if (/^[A-Z]/.test(word)) out.push([m.index, end, "type"]);
    } else if (cls) {
      out.push([m.index, end, cls]);
    }
  }
}

function synScanHtml(line, from, st, out) {
  const res = SYN_RES.html;
  res.lastIndex = from;
  for (let m = res.exec(line); m; m = res.exec(line)) {
    const end = m.index + m[0].length;
    if (m[1]) { // 注释开：找同行闭合，否则整行入注释并延续
      const close = line.indexOf("-->", end);
      if (close === -1) { out.push([m.index, line.length, "com"]); st.block = true; return; }
      out.push([m.index, close + 3, "com"]);
      res.lastIndex = close + 3;
    } else {
      const cls = SYN_GROUPS.html[m.findIndex((g, x) => x > 0 && g !== undefined) - 1];
      if (cls) out.push([m.index, end, cls]);
    }
  }
}

function synScanMd(line, st, out) {
  if (st.fence || /^\s*(```|~~~)/.test(line)) {
    if (st.fence && /^\s*(```|~~~)\s*$/.test(line)) st.fence = false;
    else if (!st.fence) st.fence = true;
    out.push([0, line.length, "str"]);
    return;
  }
  if (/^#{1,6}\s/.test(line)) { out.push([0, line.length, "kw"]); return; }
  const re = /(`+[^`\n]*`+)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]*\]\([^)\n]*\))|(https?:\/\/[^\s)]+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    out.push([m.index, m.index + m[0].length, m[1] ? "str" : m[2] ? "type" : "num"]);
  }
}

/** 语法区间渲染为转义 HTML */
export function renderCode(text, lang, st) {
  if (text === "") return " "; // 空行用空格撑出行高
  const syn = [];
  synScan(text, lang, st, syn);
  const pts = new Set([0, text.length]);
  for (const [s, e] of syn) { pts.add(s); pts.add(e); }
  const sorted = [...pts].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (s >= e) continue;
    const tk = syn.find(([a, b]) => a <= s && b >= e);
    const seg = escHtml(text.slice(s, e));
    html += tk ? `<span class="tk-${tk[2]}">${seg}</span>` : seg;
  }
  return html;
}
