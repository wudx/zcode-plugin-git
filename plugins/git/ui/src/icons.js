// ---------------------------------------------------------------------------
// inline icons (stroke: currentColor)
// ---------------------------------------------------------------------------

export const SVG = (inner) =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
export const ICONS = {
  tree: SVG('<path d="M4 5h9M4 5v13M8 12h9M8 19h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  list: SVG('<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  pull: SVG('<path d="M12 3v11m0 0-4-4m4 4 4-4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  push: SVG('<path d="M12 21v-11m0 0-4 4m4-4 4 4M5 4h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  // kebab 是填充式圆点、close 尺寸更小，均不走 SVG() 工厂，保持原始字符串
  kebab: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
  close: '<svg width="11" height="11" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  split: SVG('<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M12 4v16" stroke="currentColor" stroke-width="2"/>'),
  unified: SVG('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  chgUp: SVG('<path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  chgDown: SVG('<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  sliders: SVG('<path d="M4 7h8M18 7h2M4 17h2M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15" cy="7" r="2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="17" r="2" stroke="currentColor" stroke-width="2"/>'),
  stashIn: SVG('<path d="M12 3v8m0 0-3-3m3 3 3-3M4 13v7h16v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  stashOut: SVG('<path d="M12 12V3m0 0-3 3m3-3 3 3M4 13v7h16v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  minus: SVG('<path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  undo: SVG('<path d="M3 4v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 15a9 9 0 1 0 2.1-9.4L3 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  trash: SVG('<path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  check: SVG('<path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
};
