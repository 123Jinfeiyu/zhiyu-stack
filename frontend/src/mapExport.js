/* 把「整片树林」导出成一张高清 PNG。
 *
 * 看起来只是「截个图」，实际有三处必须自己处理：
 *
 * 1. **样式会丢**。页面上的 `.branch / .tree-node / .gen-band` 全在 styles.css 里，
 *    SVG 一旦被塞进 <img>（canvas.drawImage 也走这条路），就不再是文档的一部分，
 *    外部样式表一条都拿不到。所以这里把用到的那一小撮规则原样抄进 <style>，
 *    颜色用当前主题解析后的**字面值**（深色模式导出的图也是深色的）。
 * 2. **初始态是透明的**。节点写着 `opacity: 0` + 生长动画，枝条 `stroke-dashoffset: 2000`。
 *    静态渲染不会触发动画，直接导出就是一张白纸 —— 必须显式覆盖成最终态。
 * 3. **自定义属性未必解析**。`stroke-width: var(--dw)` 依赖 CSS 变量，
 *    为稳妥起见把每根枝的 --dw 读出来落成 `stroke-width` 属性，不再依赖 var。
 *
 * 另外加一条脚注（枝数 / 代数 / 棵数 / 日期），分享出去时能自己说明白。
 *
 * ※ drawCaption 这个函数在真机上是栽过跟头的：left/right 一开始从 box 里解构、
 *   调用方却放在 opts 里，结果两段字全被 `if (left)` 拦掉，导出的图干干净净
 *   就是没有落款。现在两种传法都认，并且有测试用「记录型假 ctx」锁住这个契约。
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const FONT =
  '"PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", system-ui, sans-serif';

/** 变量名 → 回退值（读不到 CSS 变量时用，正好是浅色主题） */
const VAR_FALLBACK = {
  "--bg": "#faf7f1",
  "--bg-soft": "#f3ede2",
  "--card": "#ffffff",
  "--ink": "#2b2620",
  "--ink-3": "#a39a8c",
  "--accent": "#3a7d5c",
  "--accent-soft": "#e7f2ec",
  "--accent-ink": "#2c6248",
  "--branch": "#c96f4a",
  "--branch-soft": "#f8ece5",
  "--line": "#e8e0d2",
};

const MAX_SCALE = 3;
const DEFAULT_SCALE = 2;
const MAX_SIDE = 8192; // 再大浏览器 canvas 就分配不出内存了

/** 读当前主题的颜色（深色模式会自动拿到深色那套） */
export function readVars(root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  let cs = null;
  try {
    if (el && typeof getComputedStyle === "function") cs = getComputedStyle(el);
  } catch {
    cs = null;
  }
  const out = {};
  for (const k of Object.keys(VAR_FALLBACK)) {
    let v = "";
    if (cs) v = String(cs.getPropertyValue(k) || "").trim();
    out[k] = v || VAR_FALLBACK[k];
  }
  return out;
}

/** 独立 SVG 需要的最小样式表——和 styles.css 里画树的那一段保持一致 */
export function mapCss(v) {
  return [
    `svg{font-family:${FONT};background:${v["--bg"]}}`,
    ".gen-band{fill:transparent}",
    `.gen-band.alt{fill:${v["--bg-soft"]};opacity:.75}`,
    `.branch{fill:none;stroke:${v["--line"]};stroke-linejoin:round;stroke-linecap:round}`,
    `.glow-pad{fill:${v["--accent"]};opacity:.09}`,
    `.trunk{stroke:${v["--line"]};opacity:.9}`,
    // 静态图：节点直接到最终态，别留动画的首帧（opacity:0 会导出成白纸）
    ".tree-node{opacity:1!important;animation:none!important}",
    `.knob{fill:${v["--branch"]};opacity:.75}`,
    `.tree-node .box{fill:${v["--card"]};stroke:${v["--line"]};stroke-width:1.3}`,
    ".tree-node.leaf .box{stroke-dasharray:4 3}",
    `.tree-node .lbl{font-size:13px;fill:${v["--ink"]};letter-spacing:.01em}`,
    `.tree-node.cur .box{fill:${v["--accent-soft"]};stroke:${v["--accent"]};stroke-width:2;stroke-dasharray:none}`,
    `.tree-node.cur .lbl{fill:${v["--accent-ink"]};font-weight:600}`,
    `.tree-node .badge circle{fill:${v["--branch-soft"]};stroke:${v["--branch"]};stroke-width:1}`,
    `.tree-node .badge text{font-size:11.5px;fill:${v["--branch"]};text-anchor:middle}`,
  ].join("\n");
}

/** 画布尺寸：默认 2 倍，太大就按上限收回来 */
export function pickScale(w, h, opts = {}) {
  const want = opts.scale || DEFAULT_SCALE;
  const cap = opts.maxSide || MAX_SIDE;
  const byCap = Math.min(w, h) > 0 ? cap / Math.max(w, h) : MAX_SCALE;
  const s = Math.min(MAX_SCALE, Math.max(want, 1), byCap);
  return Math.max(0.5, Math.round(s * 100) / 100);
}

/** 导出的文件名：枝语-树林-20261022-1410.png */
export function exportFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    "枝语-树林-" +
    now.getFullYear() +
    p(now.getMonth() + 1) +
    p(now.getDate()) +
    "-" +
    p(now.getHours()) +
    p(now.getMinutes()) +
    ".png"
  );
}

/**
 * 把页面上的 SVG 变成一个能独立渲染的 SVG 字符串。
 * opts: { width, height, vars }
 */
export function buildExportSvg(svg, opts = {}) {
  if (!svg) throw new Error("找不到族谱图");
  const vars = opts.vars || readVars();
  const w = Math.round(opts.width || (svg.viewBox && svg.viewBox.baseVal.width) || 2400);
  const h = Math.round(opts.height || (svg.viewBox && svg.viewBox.baseVal.height) || 2010);

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // 交互态是「正在用」的痕迹，不适合出现在分享图里
  clone.querySelectorAll(".tree-node").forEach((el) => {
    el.classList.remove("hot", "sel", "dying");
    el.removeAttribute("style"); // --d 只是动画延迟
  });

  // 知识图谱：悬停/选中/拖拽留下的类也一并洗掉
  clone.querySelectorAll(".kg-node").forEach((el) => {
    el.classList.remove("hot", "near", "dim", "dragging");
    el.removeAttribute("style");
  });
  clone.querySelectorAll(".kg-link").forEach((el) => {
    el.classList.remove("hot", "dim");
  });

  // 线宽落成属性：不依赖 var(--dw) 在离页环境里能不能解析
  clone.querySelectorAll(".branch").forEach((el) => {
    const m = /--dw\s*:\s*([\d.]+)/.exec(el.getAttribute("style") || "");
    if (m) {
      el.setAttribute("stroke-width", m[1]);
      el.removeAttribute("data-depth");
    }
    el.classList.remove("hot");
    el.removeAttribute("style");
  });

  // 背景铺底（深色模式导出就是深色的纸）
  const bg = svg.ownerDocument.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(h));
  bg.setAttribute("fill", vars["--bg"]);
  clone.insertBefore(bg, clone.firstChild);

  const style = svg.ownerDocument.createElementNS(SVG_NS, "style");
  // css 可以由调用方给（知识图谱有自己的一套类名），默认是族谱树那份
  style.textContent = typeof opts.css === "function" ? opts.css(vars) : opts.css || mapCss(vars);
  clone.insertBefore(style, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

/** 脚注：左边一句「枝语 · 整片树林」，右边枝数/代数/日期 */
export function drawCaption(ctx, box, opts = {}) {
  const { width, height, scale } = box;
  // left/right/pad 两种形状都收：exportMapPng 把它们放 opts，直接调用放 box
  const pad = box.pad != null ? box.pad : opts.pad || 0;
  const left = box.left != null ? box.left : opts.left;
  const right = box.right != null ? box.right : opts.right;
  const v = opts.vars || readVars();
  const baseY = height - Math.round(14 * scale);

  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${Math.round(11 * scale)}px ${FONT}`;
  ctx.fillStyle = v["--ink"];
  ctx.textAlign = "left";
  if (left) ctx.fillText(left, pad, baseY);

  ctx.font = `${Math.round(8.5 * scale)}px ${FONT}`;
  ctx.fillStyle = v["--ink-3"] || "#a39a8c";
  ctx.textAlign = "right";
  if (right) ctx.fillText(right, width - pad, baseY);
}

/**
 * 导出：SVG → 高清 PNG，返回画布尺寸。
 * opts: { vars, scale, caption:[left,right], pad, footer }
 */
export async function exportMapPng(svg, opts = {}) {
  const vars = opts.vars || readVars();
  const w = Math.round(opts.width || (svg.viewBox && svg.viewBox.baseVal.width) || 0);
  const h = Math.round(opts.height || (svg.viewBox && svg.viewBox.baseVal.height) || 0);
  if (!w || !h) throw new Error("族谱图尺寸为空");

  const scale = opts.scale || pickScale(w, h);
  const pad = opts.pad != null ? opts.pad : Math.round(18 * scale);
  const footer = opts.footer != null ? opts.footer : Math.round(34 * scale);
  const outW = Math.round(w * scale + pad * 2);
  const outH = Math.round(h * scale + pad + footer);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 canvas 导出");

  ctx.fillStyle = vars["--bg"];
  ctx.fillRect(0, 0, outW, outH);

  const svgText = buildExportSvg(svg, { width: w, height: h, vars, css: opts.css });
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("SVG 转图片失败"));
      img.src = url;
    });
    ctx.drawImage(img, pad, pad, Math.round(w * scale), Math.round(h * scale));
  } finally {
    URL.revokeObjectURL(url);
  }

  const cap = opts.caption || [];
  drawCaption(ctx, { width: outW, height: outH, scale, pad }, { vars, left: cap[0], right: cap[1] });

  const blob = await new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, "image/png");
    else resolve(null);
  });
  if (!blob) throw new Error("生成 PNG 失败");

  downloadBlob(blob, opts.filename || exportFileName());
  return { width: outW, height: outH, size: blob.size, scale };
}

/** 触发下载（用完释放 blob URL） */
export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(a.href);
    } catch {
      /* 已经走了就算了 */
    }
    a.remove();
  }, 4000);
}
