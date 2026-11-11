/* 知识图谱的力导向布局。
 *
 * 这里刻意**不用随机数**：初始位置按「簇心 → 黄金角散开」摆好，迭代次数固定，
 * 于是同样一份图谱每次画出来一模一样 —— 用户下次打开不会看到另一种排法，
 * 导出图片也和屏幕上一致，测试还能直接断言坐标。
 *
 * 力气三样：
 *   · 斥力：任意两节点互相推开（k²/d），保证名字不叠在一起；
 *   · 引力：有共现关系的节点被拉近（弹簧，理想长度随权重变短）；
 *   · 簇心：每个节点被自己的业务线中心轻轻拉住（很弱的弹簧），
 *     这样即便两簇之间有边，也不会糊成一团。
 */

export const PALETTE = [
  "#3a7d5c", // 墨绿
  "#c96f4a", // 陶土
  "#5b7fb8", // 靛蓝
  "#a06cb0", // 紫
  "#b3922f", // 赭黄
  "#4aa3a0", // 青
  "#8a6a52", // 棕
];

export function clusterColor(clusters, id) {
  const i = Math.max(0, clusters.findIndex((c) => c.id === id));
  return PALETTE[i % PALETTE.length];
}

/** 概念圆的半径：出现得越多越大，但别大到盖住字 */
export function radiusOf(df) {
  return Math.min(30, 8 + Math.sqrt(Math.max(1, Number(df) || 1)) * 3.6);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {Array} concepts [{id, name, df, cluster}]
 * @param {Array} links    [[a, b, w], ...]
 * @param {object} opts    { width, height, iterations }
 * @returns {{nodes: Array, byId: Map, width: number, height: number}}
 */
export function layoutKg(concepts, links, opts = {}) {
  const W = opts.width || 1180;
  const H = opts.height || 700;
  const iterations = opts.iterations || 170;

  const list = (concepts || []).map((c) => ({
    ...c,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: radiusOf(c.df),
  }));
  if (!list.length) return { nodes: [], byId: new Map(), width: W, height: H };

  const order = new Map(list.map((n, i) => [n.id, i]));

  // 簇心：均匀摆在一个椭圆上，簇多也不会挤在正中
  const clusterIds = [];
  for (const n of list) {
    const cid = n.cluster || "-";
    if (!clusterIds.includes(cid)) clusterIds.push(cid);
  }
  const centers = new Map();
  clusterIds.forEach((cid, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / clusterIds.length;
    centers.set(cid, {
      x: W / 2 + Math.cos(a) * W * 0.3,
      y: H / 2 + Math.sin(a) * H * 0.3,
    });
  });

  // 起点：每个簇内部按黄金角螺旋散开（同一个簇心，同样的顺序 → 完全确定）
  const seenInCluster = new Map();
  for (const n of list) {
    const cid = n.cluster || "-";
    const k = seenInCluster.get(cid) || 0;
    seenInCluster.set(cid, k + 1);
    const c = centers.get(cid);
    const ang = k * 2.399963229728653;
    const rad = 18 + Math.sqrt(k) * 34;
    n.x = c.x + Math.cos(ang) * rad;
    n.y = c.y + Math.sin(ang) * rad;
  }

  const edges = (links || [])
    .map(([a, b, w]) => [order.get(a), order.get(b), Number(w) || 1])
    .filter((e) => e[0] != null && e[1] != null && e[0] !== e[1]);

  const PAD = 46;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - (it / iterations) * 0.55; // 越算越稳，别一直晃

    // 斥力
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // 完全重合时给一个由 id 决定的固定方向（不能用随机数）
          dx = (i % 2 ? 1 : -1) * (0.4 + i * 0.01);
          dy = (j % 2 ? 1 : -1) * (0.4 + j * 0.01);
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (6200 * cool) / d2;
        const ux = dx / d;
        const uy = dy / d;
        a.vx += ux * f;
        a.vy += uy * f;
        b.vx -= ux * f;
        b.vy -= uy * f;
      }
    }

    // 弹簧（共现越强，理想距离越短）
    for (const [i, j, w] of edges) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const want = 168 - Math.min(60, w * 5);
      const f = (d - want) * 0.009 * cool;
      const ux = dx / d;
      const uy = dy / d;
      a.vx += ux * f;
      a.vy += uy * f;
      b.vx -= ux * f;
      b.vy -= uy * f;
    }

    // 簇心与画布中心
    for (const n of list) {
      const c = centers.get(n.cluster || "-") || { x: W / 2, y: H / 2 };
      n.vx += (c.x - n.x) * 0.011 * cool;
      n.vy += (c.y - n.y) * 0.011 * cool;
      n.vx += (W / 2 - n.x) * 0.0016;
      n.vy += (H / 2 - n.y) * 0.0016;

      n.vx *= 0.84;
      n.vy *= 0.84;
      const v = Math.hypot(n.vx, n.vy);
      if (v > 16) {
        n.vx = (n.vx / v) * 16;
        n.vy = (n.vy / v) * 16;
      }
      n.x = clamp(n.x + n.vx, PAD, W - PAD);
      n.y = clamp(n.y + n.vy, PAD, H - PAD);
    }
  }

  // 收尾：把整张图铺进可视区。
  // 只动坐标、不动半径和字号 —— 字不许跟着变大变小，所以是「摊开」而不是「缩放画布」。
  // 有上限 1.5：摊得太开会把本来挨着的簇拉成散沙，反而看不出业务线。
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of list) {
    minX = Math.min(minX, n.x - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const LABEL_ROOM = 34; // 圆下面还要写字
  const fit = Math.min(1.5, Math.max(1, Math.min((W - 2 * PAD) / bw, (H - PAD - LABEL_ROOM) / bh)));
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  for (const n of list) {
    n.x = clamp(W / 2 + (n.x - mx) * fit, n.r + 8, W - n.r - 8);
    n.y = clamp(H / 2 + (n.y - my) * fit, n.r + 8, H - n.r - LABEL_ROOM);
  }

  const nodes = list.map((n) => ({
    id: n.id,
    name: n.name,
    df: n.df,
    cluster: n.cluster,
    x: Math.round(n.x * 10) / 10,
    y: Math.round(n.y * 10) / 10,
    r: Math.round(n.r * 10) / 10,
  }));
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), width: W, height: H };
}

/** 连线两端各留出圆的半径，线不要插进字里 */
export function linkPath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / d;
  const uy = dy / d;
  return {
    x1: Math.round((a.x + ux * (a.r + 2)) * 10) / 10,
    y1: Math.round((a.y + uy * (a.r + 2)) * 10) / 10,
    x2: Math.round((b.x - ux * (b.r + 2)) * 10) / 10,
    y2: Math.round((b.y - uy * (b.r + 2)) * 10) / 10,
  };
}

/**
 * 有向规则边：画成一段弧，末端留出 11px 给箭头。
 * 用弧而不是直线，是因为规则和共现线常常连着同一对概念 —— 直线会叠在一起。
 * @param {number} bend 弯曲量（px），正负决定往哪边弯
 * @returns {{d: string, mx: number, my: number}} 曲线路径 + 曲线中点（放标签用）
 */
export function rulePath(a, b, bend = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / d;
  const uy = dy / d;
  const r1 = (v) => Math.round(v * 10) / 10;
  const sx = a.x + ux * (a.r + 3);
  const sy = a.y + uy * (a.r + 3);
  const ex = b.x - ux * (b.r + 11);
  const ey = b.y - uy * (b.r + 11);
  const k = bend || Math.min(52, d * 0.2);
  const cx = (sx + ex) / 2 - uy * k;
  const cy = (sy + ey) / 2 + ux * k;
  const mx = (sx + 2 * cx + ex) / 4;
  const my = (sy + 2 * cy + ey) / 4;
  return {
    d: `M${r1(sx)},${r1(sy)} Q${r1(cx)},${r1(cy)} ${r1(ex)},${r1(ey)}`,
    mx: r1(mx),
    my: r1(my),
    // 算标签落点要用到的四个点
    sx, sy, cx, cy, ex, ey,
  };
}


/** 二次贝塞尔上一点 */
function bez(p, t) {
  const u = 1 - t;
  return {
    x: u * u * p.sx + 2 * u * t * p.cx + t * t * p.ex,
    y: u * u * p.sy + 2 * u * t * p.cy + t * t * p.ey,
  };
}

/**
 * 规则标签挂哪儿：沿弧线试几个点，挑「离所有圆最远」的那个。
 * 弧线中点经常正好压在两端之间的某个概念上，写死中点就一定会撞。
 * 一样远时取更靠中点的，标签别乱跑。
 */
export function ruleLabelPoint(path, blockers = [], opts = {}) {
  const W = opts.width || 1180;
  const H = opts.height || 700;
  const halfW = opts.halfW || 0; // 标签自身的半宽，算让位时要把它自己也算进去
  const ts = opts.candidates || [0.18, 0.22, 0.26, 0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 0.62, 0.66, 0.7, 0.74, 0.78, 0.82];
  let best = null;
  for (const t of ts) {
    const p = bez(path, t);
    if (p.x < 40 || p.x > W - 40 || p.y < 26 || p.y > H - 26) continue;
    let clear = Infinity;
    for (const n of blockers) {
      // 把「圆 + 圆下面那行字」当成一个椭圆，椭圆形也躲开
      const rx = Math.max(n.r + 6, halfW + 10);
      const ry = n.r + 26;
      const d = Math.hypot((p.x - n.x) / rx, (p.y - n.y) / ry) - 1;
      if (d < clear) clear = d;
    }
    if (!blockers.length) clear = 0;
    const score = clear - Math.abs(t - 0.5) * 0.04; // 一样空时优先靠中点
    if (!best || score > best.score) best = { x: p.x, y: p.y, score, clear, t };
  }
  const fallback = bez(path, 0.5);
  const pick = best || { x: fallback.x, y: fallback.y };
  return {
    x: Math.round(pick.x * 10) / 10,
    y: Math.round(pick.y * 10) / 10,
    clear: best ? Math.round(best.clear * 10) / 10 : 0,
  };
}
