// ---------------------------------------------------------------------------
// diff 迷你地图（仿 VS Code）：滚动区右侧按行绘制彩色缩略条
// （增=绿、删=红、上下文=灰、hunk=蓝），叠加视口指示块，随滚动同步；
// 点击/拖动地图直接滚动。内容不溢出时也显示（视口铺满整条，点击无操作），保持布局统一。
// ---------------------------------------------------------------------------

const MAP_W = 40; // 地图宽度（px）
const MAP_GAP = 6; // 地图与滚动区右缘的间距
const ROW_H_MAX = 3; // 单行缩略条最大高度（px）
const BAR_H_RATIO = 0.7; // 条高占行高的比例
const BAR_H_MIN = 0.7; // 条高下限（px）
const IND_MIN_H = 14; // 视口指示块最小高度（px）

// canvas 读不了 CSS 变量：主题色取计算值，缺失时回退（与 panel.css 的 --git-* 默认值一致）
const FALLBACK = { add: "#3fb968", del: "#f2555a", hunk: "#58a6ff", dim: "#9d9da7" };

export function attachMinimap(box) {
  if (!box.isConnected) return;
  const view = box.querySelector(".diff, .split-scroll");
  if (!view) return;
  const doc = view.ownerDocument;
  const map = doc.createElement("div");
  map.className = "minimap";
  const canvas = doc.createElement("canvas");
  const ind = doc.createElement("div");
  ind.className = "minimap-view";
  map.appendChild(canvas);
  map.appendChild(ind);

  const dpr = doc.defaultView.devicePixelRatio || 1;
  const mapH = view.clientHeight;
  canvas.width = Math.round(MAP_W * dpr);
  canvas.height = Math.round(mapH * dpr);
  canvas.style.width = MAP_W + "px";
  canvas.style.height = mapH + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // 主题色：canvas 读不了 CSS 变量，取计算值
  const cs = getComputedStyle(doc.documentElement);
  const vc = (n, fb) => (cs.getPropertyValue(n) || "").trim() || fb;
  const C = {
    add: vc("--git-add", FALLBACK.add),
    del: vc("--git-del", FALLBACK.del),
    hunk: vc("--git-ren", FALLBACK.hunk),
    meta: vc("--git-fg-dim", FALLBACK.dim),
    ctx: vc("--git-fg-dim", FALLBACK.dim),
  };

  // 收集缩略条：indent/len 为字符列，x0+cols 约束绘制区间（并排视图分左右两半）
  const bars = [];
  const pushBar = (text, color, x0, cols) => {
    const t = text.trim();
    if (!t) return;
    bars.push({ indent: text.length - text.replace(/^\s+/, "").length, len: t.length, color, x0, cols });
  };
  if (view.classList.contains("diff")) {
    for (const span of view.children) {
      const txt = span.textContent;
      let color = C.meta;
      if (span.classList.contains("dl-add")) color = C.add;
      else if (span.classList.contains("dl-del")) color = C.del;
      else if (span.classList.contains("dl-hunk")) color = C.hunk;
      else if (span.classList.contains("dl-ctx")) color = C.ctx;
      pushBar(txt, color, 3, 80);
    }
  } else {
    const ch = [...view.querySelector(".split-grid").children];
    const halfW = (MAP_W - MAP_GAP) / 2;
    for (let i = 0; i < ch.length; ) {
      if (ch[i].classList.contains("cell-span")) {
        pushBar(ch[i].textContent, ch[i].classList.contains("dl-hunk") ? C.hunk : C.meta, 3, 120);
        i += 1;
        continue;
      }
      pushBar(ch[i + 1]?.textContent ?? "", ch[i + 1]?.classList.contains("cell-del") ? C.del : C.ctx, 3, 60);
      pushBar(ch[i + 3]?.textContent ?? "", ch[i + 3]?.classList.contains("cell-add") ? C.add : C.ctx, 3 + halfW, 60);
      i += 4;
    }
  }
  if (bars.length === 0) return;

  let rowH = Math.min(ROW_H_MAX, mapH / bars.length);
  if (bars.length * rowH > mapH) rowH = mapH / bars.length; // 行数过多时整体压缩
  const barH = Math.max(BAR_H_MIN, rowH * BAR_H_RATIO);
  const mapContentH = bars.length * rowH;
  ctx.globalAlpha = 0.8;
  bars.forEach((b, i) => {
    const colW = (MAP_W - MAP_GAP) / b.cols;
    const x = b.x0 + Math.min(b.indent, b.cols) * colW;
    const w = Math.max(2, Math.min(b.len, b.cols - Math.min(b.indent, b.cols)) * colW);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, i * rowH, w, barH);
  });

  const scrollable = view.scrollHeight - view.clientHeight > 2;
  map.style.cursor = scrollable ? "pointer" : "default";
  const update = () => {
    ind.style.top = (view.scrollTop / view.scrollHeight) * mapContentH + "px";
    ind.style.height = Math.min(mapContentH, Math.max(IND_MIN_H, (view.clientHeight / view.scrollHeight) * mapContentH)) + "px";
  };
  view.addEventListener("scroll", update, { passive: true });

  // 点击/拖动：点击点按比例映射到内容位置并居中视口
  const seek = (clientY) => {
    const r = map.getBoundingClientRect();
    const target = ((clientY - r.top) / mapContentH) * view.scrollHeight - view.clientHeight / 2;
    view.scrollTop = Math.max(0, Math.min(target, view.scrollHeight - view.clientHeight));
  };
  map.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      map.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件等无有效指针 id 时忽略，拖动退化为仅点击定位
    }
    seek(e.clientY);
    const move = (ev) => seek(ev.clientY);
    const up = () => {
      map.removeEventListener("pointermove", move);
      map.removeEventListener("pointerup", up);
      map.removeEventListener("pointercancel", up);
    };
    map.addEventListener("pointermove", move);
    map.addEventListener("pointerup", up);
    map.addEventListener("pointercancel", up);
  });

  // 给地图让位，原生滚动条随之内移
  view.style.marginRight = MAP_W + MAP_GAP + "px";
  map.style.top = view.offsetTop + "px";
  map.style.height = mapH + "px";
  box.appendChild(map);
  update();
}
