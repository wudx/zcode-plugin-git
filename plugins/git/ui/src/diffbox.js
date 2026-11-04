// ---------------------------------------------------------------------------
// diff 容器：工具栏（范围切换 / 上一个下一个 / 切分 / 关闭）+ 图片比对 + 分支渲染
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { callTool } from "./api.js";
import { expanded, splitDiff, setSplitDiff, setDiffScope, scopeLabel, scopeTitle, nextScope } from "./state.js";
import { lsSet } from "./storage.js";
import { loadingEl, iconBtn } from "./dom.js";
import { IMAGE_RE, unifiedView, splitView } from "./diffview.js";
import { extLang } from "./syntax.js";
import { render } from "./render.js";

// “上一个/下一个更改”跳转：目标为每段连续增删行的首行（.chg-start）
const JUMP_NEAR_TOP = 10; // rel 小于该值视为已滚动到达某个更改
const JUMP_STICKY = -24; // 当前更改仍贴在视口顶附近时，向上跳退到它上面一处
const JUMP_PAD = 8; // 跳转后目标行距视口顶的留白

/** 图片比对的两个版本：与文本 diff 的对比基准保持一致（staged 对 HEAD，工作区对暂存区）。 */
function imageSides(entry, staged) {
  const spec = (rev, path) => ({ path: path || entry.path, rev });
  const table = staged
    ? {
        D: { old: [spec("HEAD"), t.imgOldHead] },
        orig: { old: [spec("HEAD", entry.origPath), t.imgOldHead], new: [spec("index"), t.imgNewIndex] },
        base: { old: [spec("HEAD"), t.imgOldHead], new: [spec("index"), t.imgNewIndex] },
      }
    : {
        "?": { new: [spec("worktree"), t.imgNew] },
        D: { old: [spec("index"), t.imgOldIndex] },
        orig: { old: [spec("index", entry.origPath), t.imgOldIndex], new: [spec("worktree"), t.imgNewWorktree] },
        base: { old: [spec("index"), t.imgOldIndex], new: [spec("worktree"), t.imgNewWorktree] },
      };
  const key = entry.code === "D" ? "D" : entry.origPath ? "orig" : "base";
  const s = table[key];
  return {
    oldSpec: s.old?.[0],
    oldLabel: s.old?.[1],
    newSpec: s.new?.[0],
    newLabel: s.new?.[1],
  };
}

export async function loadImages(info) {
  const sides = imageSides(info.entry, info.staged);
  const images = { phase: "loading" };
  info.images = images;
  const fetchOne = async (spec) => {
    try {
      const r = await callTool("git_blob", spec);
      if (r?.tooLarge) return { error: "tooLarge" };
      if (r?.base64) return { mime: r.mime, base64: r.base64 };
      return { error: "unsupported" };
    } catch (err) {
      return { error: String(err?.message || err).split("\n")[0] };
    }
  };
  const [oldImg, newImg] = await Promise.all([
    sides.oldSpec ? fetchOne(sides.oldSpec) : Promise.resolve(null),
    sides.newSpec ? fetchOne(sides.newSpec) : Promise.resolve(null),
  ]);
  if (info.images !== images) return; // 行已收起/迁移
  images.phase = "ready";
  if (oldImg) {
    images.old = oldImg;
    images.oldLabel = sides.oldLabel;
  }
  if (newImg) {
    images.new = newImg;
    images.newLabel = sides.newLabel;
  }
  render();
}

function imageCompareEl(info) {
  const wrap = document.createElement("div");
  wrap.className = "imgcmp";
  const imgs = info.images;
  if (!imgs || imgs.phase === "loading") {
    wrap.appendChild(loadingEl(t.loading));
    return wrap;
  }
  const panes = [];
  if (imgs.old) panes.push({ label: imgs.oldLabel, data: imgs.old });
  if (imgs.new) panes.push({ label: imgs.newLabel, data: imgs.new });
  if (!panes.length) {
    const err = imgs.old?.error || imgs.new?.error || "";
    wrap.appendChild(loadingEl(err === "tooLarge" ? t.imgTooLarge : `${t.imgLoadFail}${err ? "：" + err : ""}`));
    return wrap;
  }
  for (const pane of panes) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = pane.label;
    fig.appendChild(cap);
    if (pane.data.error) {
      const s = document.createElement("span");
      s.className = "img-err";
      s.textContent = pane.data.error === "tooLarge" ? t.imgTooLarge : t.imgLoadFail;
      fig.appendChild(s);
    } else {
      const img = document.createElement("img");
      img.src = `data:${pane.data.mime};base64,${pane.data.base64}`;
      img.alt = pane.label;
      fig.appendChild(img);
    }
    wrap.appendChild(fig);
  }
  return wrap;
}

export function diffEl(key) {
  const info = expanded.get(key);
  const box = document.createElement("div");
  box.className = "diff-box";
  const d = info.diff;
  const isImage = !!(d && d.binary && !info.entry.unmerged && IMAGE_RE.test(info.entry.path));
  const bar = document.createElement("div");
  bar.className = "diff-bar";
  const jumpChange = (dir) => {
    const view = box.querySelector(".diff, .split-scroll");
    if (!view) return;
    const targets = [...view.querySelectorAll(".chg-start")];
    if (targets.length === 0) return;
    const rel = targets.map((elm) => elm.getBoundingClientRect().top - view.getBoundingClientRect().top);
    let cur = -1; // 顶部已到达的最后一个更改
    for (let i = 0; i < rel.length; i += 1) if (rel[i] < JUMP_NEAR_TOP) cur = i;
    let i;
    if (dir > 0) {
      i = Math.min(cur + 1, targets.length - 1);
    } else if (cur >= 0 && rel[cur] > JUMP_STICKY) {
      i = cur - 1; // 已正贴在某个更改上 → 跳到它的上一处
    } else {
      i = Math.max(cur, 0); // 已深滚过 → 先回到当前这处
    }
    i = Math.max(i, 0);
    view.scrollTop += targets[i].getBoundingClientRect().top - view.getBoundingClientRect().top - JUMP_PAD;
  };
  let chgBtns = null;
  if (!isImage) {
    // 上下文范围切换：±10 行 → ±20 行 → 整个文件
    const scopeBtn = document.createElement("button");
    scopeBtn.className = "btn scope";
    scopeBtn.textContent = scopeLabel(info.scope || "line");
    scopeBtn.title = scopeTitle(info.scope || "line");
    scopeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = nextScope(info.scope || "line");
      setDiffScope(next);
      lsSet("zcode-git.scope", next);
      // 以新范围重新拉取当前 diff
      info.scope = next;
      info.diff = null;
      info.loading = true;
      info.pending = false;
      render();
    });
    bar.appendChild(scopeBtn);
    chgBtns = [
      iconBtn({ icon: ICONS.chgUp, title: t.diffPrev, onClick: () => jumpChange(-1) }),
      iconBtn({ icon: ICONS.chgDown, title: t.diffNext, onClick: () => jumpChange(1) }),
    ];
    bar.append(...chgBtns);
    bar.appendChild(
      iconBtn({
        icon: splitDiff ? ICONS.unified : ICONS.split,
        title: splitDiff ? t.diffUnified : t.diffSplit,
        onClick: () => {
          const next = !splitDiff;
          setSplitDiff(next);
          lsSet("zcode-git.diffView", next ? "split" : "unified");
          render();
        },
      })
    );
  }
  bar.appendChild(
    iconBtn({
      icon: ICONS.close,
      title: t.noticeClose,
      cls: "diff-close",
      onClick: () => {
        expanded.delete(key);
        render();
      },
    })
  );
  box.appendChild(bar);

  if (info.loading || !info.diff) {
    box.appendChild(loadingEl(t.loading));
    return box;
  }
  if (isImage) {
    box.appendChild(imageCompareEl(info));
    return box;
  }
  if (d.binary) {
    box.appendChild(loadingEl(t.binaryFile));
    return box;
  }
  if (!d.text || !d.text.trim()) {
    box.appendChild(loadingEl(t.noDiff));
    return box;
  }
  box.appendChild(splitDiff ? splitView(d.text, extLang(info.entry.path)) : unifiedView(d.text, extLang(info.entry.path)));
  // 无增删行（如纯文件模式变更）时禁用跳转按钮
  if (chgBtns) {
    const anyChg = box.querySelector(".chg-start") !== null;
    chgBtns[0].disabled = !anyChg;
    chgBtns[1].disabled = !anyChg;
  }
  // 迷你地图由调用方在挂载后同步调用 attachMinimap（不依赖 rAF：后台不可见时帧回调被暂停）
  return box;
}
