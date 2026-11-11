import { describe, expect, it } from "vitest";
import { clusterColor, layoutKg, linkPath, PALETTE, radiusOf, ruleLabelPoint, rulePath } from "../src/kgForce";

function sample() {
  const concepts = [
    { id: "k1", name: "还款", df: 37, cluster: "c1" },
    { id: "k2", name: "订单", df: 34, cluster: "c2" },
    { id: "k3", name: "平台", df: 32, cluster: "c1" },
    { id: "k4", name: "账户", df: 29, cluster: "c1" },
    { id: "k5", name: "资方", df: 28, cluster: "c1" },
    { id: "k6", name: "结清", df: 23, cluster: "c2" },
    { id: "k7", name: "工单", df: 21, cluster: "c3" },
    { id: "k8", name: "对公账户", df: 15, cluster: "c1" },
    { id: "k9", name: "共管账户", df: 11, cluster: "c1" },
    { id: "k10", name: "截图", df: 8, cluster: "c3" },
  ];
  const links = [
    ["k1", "k3", 17],
    ["k1", "k4", 16],
    ["k3", "k5", 16],
    ["k4", "k8", 15],
    ["k2", "k6", 12],
    ["k7", "k10", 5],
  ];
  return { concepts, links };
}

describe("知识图谱布局", () => {
  it("空输入不炸", () => {
    const r = layoutKg([], []);
    expect(r.nodes).toEqual([]);
    expect(r.byId.size).toBe(0);
  });

  it("概念一个不少，坐标都是有限数", () => {
    const { concepts, links } = sample();
    const { nodes, byId } = layoutKg(concepts, links);
    expect(nodes.length).toBe(concepts.length);
    expect(byId.size).toBe(concepts.length);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it("每次画出来一模一样（没有随机数）", () => {
    const { concepts, links } = sample();
    const a = layoutKg(concepts, links).nodes;
    const b = layoutKg(concepts, links).nodes;
    expect(a).toEqual(b);
  });

  it("全部落在画布内（缩放窗口不会跑出去）", () => {
    const { concepts, links } = sample();
    const { nodes, width, height } = layoutKg(concepts, links);
    for (const n of nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(0);
      expect(n.x + n.r).toBeLessThanOrEqual(width);
      expect(n.y - n.r).toBeGreaterThanOrEqual(0);
      expect(n.y + n.r).toBeLessThanOrEqual(height);
    }
  });

  it("圆心不会叠在一起（名字要看得见）", () => {
    const { concepts, links } = sample();
    const { nodes } = layoutKg(concepts, links);
    let min = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        min = Math.min(min, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y));
      }
    }
    // 最小的圆半径 11.6、最大 30；圆心距 > 60 时标签还有地方放
    expect(min).toBeGreaterThan(60);
  });

  it("有共现关系的概念比无关的更近", () => {
    const { concepts, links } = sample();
    const { byId } = layoutKg(concepts, links);
    const near = (a, b) => Math.hypot(byId.get(a).x - byId.get(b).x, byId.get(a).y - byId.get(b).y);
    expect(near("k1", "k3")).toBeLessThan(near("k1", "k7"));
    expect(near("k4", "k8")).toBeLessThan(near("k4", "k10"));
  });

  it("半径随出现次数增长，但有上限", () => {
    expect(radiusOf(1)).toBeLessThan(radiusOf(9));
    expect(radiusOf(9)).toBeLessThan(radiusOf(36));
    expect(radiusOf(10000)).toBe(30);
    expect(radiusOf(0)).toBeGreaterThan(0);
  });

  it("连线两端各缩进一个半径", () => {
    const a = { x: 100, y: 100, r: 20 };
    const b = { x: 300, y: 100, r: 10 };
    const p = linkPath(a, b);
    expect(p.x1).toBe(122);
    expect(p.x2).toBe(288);
    expect(p.y1).toBe(100);
  });

  it("簇色按顺序取，循环不越界", () => {
    const cs = [{ id: "c1" }, { id: "c2" }];
    expect(clusterColor(cs, "c2")).toBe(PALETTE[1]);
    expect(clusterColor(cs, "没有这簇")).toBe(PALETTE[0]);
    expect(clusterColor([], "c9")).toBe(PALETTE[0]);
  });
});

describe("规则边（有向）", () => {
  const A = { x: 100, y: 100, r: 20 };
  const B = { x: 300, y: 100, r: 16 };

  it("画的是二次曲线，不是直线", () => {
    const p = rulePath(A, B);
    expect(p.d.startsWith("M")).toBe(true);
    expect(p.d).toContain(" Q");
  });

  it("起点缩到圆外、终点给箭头留位置", () => {
    const p = rulePath(A, B);
    const [sx, sy] = p.d.slice(1).split(" Q")[0].split(",").map(Number);
    const end = p.d.split(" ").pop().split(",").map(Number);
    expect(sx).toBeGreaterThan(A.x + A.r); // 出头，不插进圆里
    expect(end[0]).toBeLessThan(B.x - B.r); // 末端回退，箭头才看得见
    expect(sy).toBe(100);
  });

  it("弯曲量变号就往另一边弯，中点跟着走", () => {
    // 正弯往 +y（屏幕上偏下），负弯往 -y；两边对称
    const down = rulePath(A, B, 40);
    const up = rulePath(A, B, -40);
    expect(down.my).toBeGreaterThan(100);
    expect(up.my).toBeLessThan(100);
    expect(Math.abs(down.my - 100)).toBeCloseTo(Math.abs(up.my - 100), 5);
  });

  it("不传弯曲量时按距离给一个默认弯度，不会画出直线", () => {
    const p = rulePath(A, B);
    expect(p.d).toContain(" Q");
    expect(Math.abs(p.my - 100)).toBeGreaterThan(4);
  });

  it("两点重合时不炸（退化成一个点）", () => {
    const p = rulePath({ x: 5, y: 5, r: 10 }, { x: 5, y: 5, r: 10 });
    expect(p.d).toContain("M");
    expect(Number.isFinite(p.mx)).toBe(true);
  });
});

describe("规则标签落点", () => {
  const A = { x: 100, y: 300, r: 18 };
  const B = { x: 500, y: 300, r: 18 };

  it("弧线中点被节点占着时，标签会自己挪开", () => {
    const p = rulePath(A, B, 60);
    const mid = { x: p.mx, y: p.my, r: 16 };
    const at = ruleLabelPoint(p, [A, B, mid]);
    expect(Math.hypot(at.x - mid.x, at.y - mid.y)).toBeGreaterThan(mid.r + 24);
  });

  it("没人挡的时候还留在弧线中点附近（别乱跑）", () => {
    const p = rulePath(A, B, 60);
    const at = ruleLabelPoint(p, [A, B]);
    expect(Math.hypot(at.x - p.mx, at.y - p.my)).toBeLessThan(140);
  });

  it("候选点跑出画布就不选它", () => {
    const p = rulePath(A, B, 380); // 弯得很夸张，中点会跑到画布外
    const at = ruleLabelPoint(p, [], { width: 600, height: 600 });
    expect(at.x).toBeGreaterThan(40);
    expect(at.x).toBeLessThan(560);
    expect(at.y).toBeGreaterThan(26);
    expect(at.y).toBeLessThan(574);
  });

  it("没有节点也不炸，给得出一个有限点", () => {
    const at = ruleLabelPoint(rulePath(A, B, 0), []);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
  });
});
