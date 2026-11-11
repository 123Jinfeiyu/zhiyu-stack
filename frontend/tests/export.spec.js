import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MiniMap from "../src/components/MiniMap.vue";
import { buildExportSvg, drawCaption, exportFileName, mapCss, pickScale, readVars } from "../src/mapExport";

vi.mock("../src/mapExport", async (orig) => {
  const real = await orig();
  return { ...real, exportMapPng: vi.fn(async () => ({ width: 4836, height: 4100, size: 1234, scale: 2 })) };
});
import { exportMapPng } from "../src/mapExport";
import { toastMsg } from "../src/ui";

const NS = "http://www.w3.org/2000/svg";

/** 手搓一小张「像族谱图」的 SVG：带交互态、带 --dw、带会挡住导出的零透明度 */
function makeSvg() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 400 300");
  svg.setAttribute("class", "tree-svg");

  const band = document.createElementNS(NS, "rect");
  band.setAttribute("class", "gen-band alt");
  svg.appendChild(band);

  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", "branch hot");
  p.setAttribute("d", "M10,10 C10,20 40,30 40,40");
  p.setAttribute("style", "--dg:1;--dw:2.1");
  svg.appendChild(p);

  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "map-item tree-node hot sel cur");
  g.setAttribute("transform", "translate(40,40)");
  g.setAttribute("data-id", "7");
  g.setAttribute("style", "--d:1");
  const box = document.createElementNS(NS, "rect");
  box.setAttribute("class", "box");
  box.setAttribute("width", "148");
  box.setAttribute("height", "32");
  g.appendChild(box);
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", "lbl");
  t.textContent = "调取合同";
  g.appendChild(t);
  svg.appendChild(g);

  document.body.appendChild(svg);
  return svg;
}

const NODES = [
  { id: 1, pid: 0, title: "业务线" },
  { id: 2, pid: 1, title: "还款流向" },
  { id: 3, pid: 1, title: "小金额还款" },
  { id: 4, pid: 2, title: "为什么还给资金方" },
];

let wrapper = null;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.mocked(exportMapPng).mockClear();
  vi.mocked(exportMapPng).mockResolvedValue({ width: 4836, height: 4100, size: 1234, scale: 2 });
});

async function mountMap() {
  wrapper = mount(MiniMap, { props: { open: true, nodes: NODES, currentId: 2 }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("导出高清图片 · 纯函数", () => {
  it("读不到 CSS 变量时回落到浅色主题的字面值", () => {
    const v = readVars(document.documentElement);
    expect(v["--bg"]).toMatch(/^#/);
    expect(v["--ink"]).toMatch(/^#/);
    expect(v["--line"]).toMatch(/^#/);
  });

  it("样式表里带上了颜色、并且强制节点到最终态", () => {
    const css = mapCss(readVars(document.documentElement));
    expect(css).toContain(".branch{");
    expect(css).toContain(".tree-node{opacity:1!important;animation:none!important}");
    expect(css).toContain("stroke:");
    // 生长动画的虚线偏移没抄进去 —— 静态图不需要
    expect(css).not.toContain("stroke-dashoffset");
  });

  it("默认 2 倍，太大按上限收，最多 3 倍", () => {
    expect(pickScale(2400, 2010)).toBe(2);
    expect(pickScale(2400, 2010, { scale: 3 })).toBe(3);
    expect(pickScale(2400, 2010, { scale: 9 })).toBe(3);
    // 5000 宽 × 2 倍会超 8192，自动降到 1.64
    expect(pickScale(5000, 5000)).toBe(1.64);
  });

  it("文件名带日期到分钟", () => {
    expect(exportFileName(new Date(2026, 9, 22, 14, 10))).toBe("枝语-树林-20261022-1410.png");
  });

  it("drawCaption 按两种调用形状都能画出两段字（真机踩过的坑：left/right 传错位置就一个字都没有）", () => {
    const fake = () => ({
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      calls: [],
      fillText(...a) {
        this.calls.push(a);
      },
    });

    // 形状一：exportMapPng 内部的调用（left/right 在 opts）
    const c1 = fake();
    drawCaption(c1, { width: 3000, height: 2000, scale: 2, pad: 36 }, { left: "枝语 · 整片树林", right: "152 枝" });
    expect(c1.calls.length).toBe(2);
    expect(c1.calls[0]).toEqual(["枝语 · 整片树林", 36, 2000 - 28]);
    expect(c1.calls[1][0]).toBe("152 枝");
    expect(c1.calls[1][2]).toBe(2000 - 28);

    // 形状二：直接调用（left/right/pad 都在 box）
    const c2 = fake();
    drawCaption(c2, { width: 3000, height: 2000, scale: 2, pad: 36, left: "左", right: "右" }, {});
    expect(c2.calls.length).toBe(2);
    expect(c2.calls[0][1]).toBe(36);
    expect(c2.calls[1][1]).toBe(3000 - 36);

    // left/right 都缺省时一个字都不画、也不报错
    const c3 = fake();
    drawCaption(c3, { width: 100, height: 100, scale: 1 }, {});
    expect(c3.calls.length).toBe(0);
  });
});

describe("导出高清图片 · SVG 内联", () => {
  it("带上 xmlns / 尺寸，能被独立渲染", () => {
    const svg = makeSvg();
    const out = buildExportSvg(svg, { width: 400, height: 300 });
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="400"');
    expect(out).toContain('height="300"');
    expect(out).toContain('viewBox="0 0 400 300"');
    expect(out).toContain("<style");
  });

  it("把交互态洗掉（hot / sel / dying 不该出现在分享图里）", () => {
    const svg = makeSvg();
    const out = buildExportSvg(svg, { width: 400, height: 300 });
    expect(out).not.toMatch(/class="[^"]*\bhot\b/);
    expect(out).not.toMatch(/class="[^"]*\bsel\b/);
    // cur 是「我正在看这枝」，保留
    expect(out).toContain("cur");
  });

  it("--dw 落成 stroke-width 属性，不依赖 var 解析", () => {
    const svg = makeSvg();
    const out = buildExportSvg(svg, { width: 400, height: 300 });
    expect(out).toContain('stroke-width="2.1"');
    expect(out).not.toContain("--dw");
  });

  it("铺一层背景，深色主题导出也是深色的纸", () => {
    const svg = makeSvg();
    const out = buildExportSvg(svg, {
      width: 400,
      height: 300,
      vars: { "--bg": "#17150f", "--bg-soft": "#1f1c15", "--card": "#221e17", "--ink": "#efe9dd", "--ink-3": "#7d7463", "--accent": "#6fbf92", "--accent-soft": "#1e2c24", "--accent-ink": "#8fd3ab", "--branch": "#e08a63", "--branch-soft": "#2d2119", "--line": "#332e24" },
    });
    expect(out).toContain('fill="#17150f"');
    expect(out).toContain("#221e17"); // 卡片底色也换了
  });

  it("节点一个不少（152 枝的树林导出后还是 152 枝）", async () => {
    await mountMap();
    const svg = wrapper.find("svg").element;
    const out = buildExportSvg(svg, { width: 600, height: 400 });
    expect((out.match(/class="map-item tree-node/g) || []).length).toBe(NODES.length);
  });
});

describe("导出高清图片 · 面板按钮", () => {
  it("点一下就导出，按原尺寸传进去（不受当前缩放影响）", async () => {
    await mountMap();
    expect(wrapper.find("#mapExport").exists()).toBe(true);
    await wrapper.find("#mapExport").trigger("click");
    await flushPromises();

    expect(exportMapPng).toHaveBeenCalledTimes(1);
    const [el, opts] = vi.mocked(exportMapPng).mock.calls[0];
    expect(el.tagName.toLowerCase()).toBe("svg");
    // 原尺寸：4 个叶子的横向占位 + 内边距，肯定比视口大
    expect(opts.width).toBeGreaterThan(300);
    expect(opts.caption[0]).toBe("枝语 · 整片树林");
    expect(opts.caption[1]).toContain("4 枝");
    expect(opts.caption[1]).toContain("3 代");
  });

  it("导出成功后提示尺寸", async () => {
    await mountMap();
    await wrapper.find("#mapExport").trigger("click");
    await flushPromises();
    expect(toastMsg.value).toContain("4836");
    expect(toastMsg.value).toContain("4100");
  });

  it("导出失败不炸页面，给出原因", async () => {
    vi.mocked(exportMapPng).mockRejectedValueOnce(new Error("当前环境不支持 canvas 导出"));
    await mountMap();
    await wrapper.find("#mapExport").trigger("click");
    await flushPromises();
    expect(toastMsg.value).toBe("导出失败：当前环境不支持 canvas 导出");
  });
});
