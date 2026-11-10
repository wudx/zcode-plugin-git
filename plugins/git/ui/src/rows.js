// ---------------------------------------------------------------------------
// 行渲染：状态行（列表/树共用）、树构建与折叠
// ---------------------------------------------------------------------------

import { t } from "./i18n.js";
import { ICONS } from "./icons.js";
import { keyOf, collapsedDirs, selected } from "./state.js";
import { callTool } from "./api.js";
import { el, iconBtn, confirmUI } from "./dom.js";
import { runAction, toggleDiff } from "./actions.js";
import { renderStashMenu } from "./stash.js";
import { render } from "./render.js";

const ROW_INDENT = 12; // 树层级缩进步长（px）

const BADGE = {
  A: ["A", "b-add"], M: ["M", "b-mod"], D: ["D", "b-del"], R: ["R", "b-ren"],
  C: ["C", "b-ren"], T: ["T", "b-mod"], "?": ["?", "b-new"], U: ["U", "b-conf"],
};

export function badgeEl(code) {
  const [ch, cls] = BADGE[code] || [code, "b-mod"];
  return el("span", "badge " + cls, ch);
}

export function rowEl(entry, staged, depth = 0) {
  const row = el("div", "row");
  const key = keyOf(staged, entry.path);
  row.dataset.key = key;
  if (depth > 0) row.style.paddingLeft = ROW_INDENT + depth * ROW_INDENT + "px";

  // 勾选框：勾中的文件可在存储菜单一次性存入同一条 stash（悬停浮现，勾选后常显）；
  // 合并冲突中的文件 stash 会整体失败，不给勾选
  if (!entry.unmerged) {
    const cb = el("input", "row-sel");
    cb.type = "checkbox";
    cb.checked = selected.has(entry.path);
    cb.title = t.selFileTitle;
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(entry.path);
      else selected.delete(entry.path);
      row.classList.toggle("sel", cb.checked);
      renderStashMenu(); // 菜单开着时同步「存储选中的文件（N）」
    });
    if (cb.checked) row.classList.add("sel");
    row.appendChild(cb);
  }

  const main = el("div", "row-main");
  main.appendChild(badgeEl(entry.code));
  const label = entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path;
  const name = el("span", "path", entry._name || label);
  name.title = label;
  main.appendChild(name);
  row.appendChild(main);

  const btns = el("div", "row-btns");
  btns.addEventListener("click", (e) => e.stopPropagation());
  row.appendChild(btns);

  const isUntracked = entry.code === "?" && !staged && !entry.unmerged;

  // 危险操作的行内二次确认：图标按钮替换为「确认？[确认][取消]」
  let confirming = false;
  const askConfirm = () => {
    confirming = true;
    renderBtns();
  };
  const renderBtns = () => {
    btns.replaceChildren();
    if (confirming) {
      confirmUI(btns, {
        question: isUntracked ? t.confirmDelete : t.confirmDiscard,
        yesLabel: t.confirmYes,
        cancelLabel: t.cancel,
        onYes: () => {
          confirming = false;
          runAction(() => callTool("git_discard", { paths: [entry.path] }));
        },
        onCancel: () => {
          confirming = false;
          renderBtns();
        },
      });
      return;
    }
    if (entry.unmerged) {
      btns.appendChild(iconBtn({ icon: ICONS.plus, title: t.resolveMark, onClick: () => runAction(() => callTool("git_stage", { paths: [entry.path] })) }));
    } else if (staged) {
      btns.appendChild(iconBtn({ icon: ICONS.minus, title: t.unstage, onClick: () => runAction(() => callTool("git_stage", { paths: [entry.path] })) }));
    } else if (isUntracked) {
      btns.appendChild(iconBtn({ icon: ICONS.plus, title: t.stage, cls: "primary", onClick: () => runAction(() => callTool("git_stage", { paths: [entry.path] })) }));
      btns.appendChild(iconBtn({ icon: ICONS.trash, title: t.deleteFile, cls: "danger", onClick: askConfirm }));
    } else {
      btns.appendChild(iconBtn({ icon: ICONS.plus, title: t.stage, cls: "primary", onClick: () => runAction(() => callTool("git_stage", { paths: [entry.path] })) }));
      btns.appendChild(iconBtn({ icon: ICONS.undo, title: t.discard, cls: "danger", onClick: askConfirm }));
    }
  };
  renderBtns();

  main.addEventListener("click", () => toggleDiff(row, entry, staged));
  return row;
}

export function buildTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const e of entries) {
    const segs = e.path.split("/");
    let node = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      let child = node.dirs.get(segs[i]);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(segs[i], child);
      }
      node = child;
    }
    node.files.push({ ...e, _name: segs[segs.length - 1] });
  }
  return root;
}

// makeRow：文件行工厂（默认工作区行 rowEl），area：折叠目录的 key 前缀；
// 历史菜单复用树结构时传自己的行工厂与 "h" 前缀，避免折叠状态和工作区串扰
export function treeEl(entries, staged, makeRow = null, area = null) {
  const ar = area || (staged ? "s" : "w");
  const mkFile = makeRow || ((e, depth) => rowEl(e, staged, depth));
  const box = el("div", "tree");
  const rec = (node, basePath, depth) => {
    for (const dname of [...node.dirs.keys()].sort()) {
      // 折叠单链目录：没有直属文件且只有一个子目录时合并显示为 a/b/c。
      let name = dname;
      let target = node.dirs.get(dname);
      while (target.files.length === 0 && target.dirs.size === 1) {
        const only = [...target.dirs.keys()][0];
        name += "/" + only;
        target = target.dirs.get(only);
      }
      const dirPath = basePath ? `${basePath}/${name}` : name;
      const dkey = `${ar}:${dirPath}`;
      const collapsed = collapsedDirs.has(dkey);
      const drow = document.createElement("div");
      drow.className = "tree-dir";
      drow.style.paddingLeft = 10 + depth * ROW_INDENT + "px";
      const chev = el("span", "chev" + (collapsed ? " collapsed" : ""), "▾");
      const label = el("span", "tree-dir-name", name);
      label.title = dirPath;
      drow.append(chev, label);
      drow.addEventListener("click", () => {
        if (collapsedDirs.has(dkey)) collapsedDirs.delete(dkey);
        else collapsedDirs.add(dkey);
        render();
      });
      box.appendChild(drow);
      if (!collapsed) rec(target, dirPath, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => String(a._name).localeCompare(String(b._name)))) {
      box.appendChild(mkFile(f, depth));
    }
  };
  rec(buildTree(entries), "", 0);
  return box;
}
