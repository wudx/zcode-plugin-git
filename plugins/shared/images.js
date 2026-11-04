// 图片扩展名 → MIME 的单一真源：
// - server（git_blob）用 MIME 值标注预览数据
// - 面板用扩展名集合派生 IMAGE_RE，判定二进制 diff 是否走图片比对
// 两侧都是 esbuild bundle，构建时各自内联，运行时无共享文件依赖。
export const IMAGE_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  avif: "image/avif",
};
