import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const kg = vi.fn();
const kgAI = vi.fn();
vi.mock("../src/api", () => ({ api: { kg: () => kg(), kgAI: (...a) => kgAI(...a) } }));

import KnowledgeGraph from "../src/components/KnowledgeGraph.vue";

const GRAPH = {
  ok: true,
  engine: "local",
  hash: "h1",
  aiAvailable: true,
  builtAt: 1,
  empty: "",
  stats: { branches: 40, concepts: 6, links: 5, clusters: 2, rules: 1, coverage: 0.86 },
  concepts: [
    { id: "k1", name: "还款", df: 20, cluster: "c1", branches: [101, 102] },
    { id: "k2", name: "账户", df: 16, cluster: "c1", branches: [101] },
    { id: "k3", name: "资方", df: 14, cluster: "c1", branches: [102] },
    { id: "k4", name: "结清", df: 9, cluster: "c2", branches: [103] },
    { id: "k5", name: "工单", df: 7, cluster: "c2", branches: [103] },
    { id: "k6", name: "截图", df: 4, cluster: "c2", branches: [] },
  ],
  links: [
    ["k1", "k2", 9],
    ["k1", "k3", 7],
    ["k2", "k3", 5],
    ["k4", "k5", 4],
    ["k1", "k4", 2],
  ],
  rules: [
    {
      id: "r1",
      from: "k1",
      to: "k2",
      kind: "cond",
      kindLabel: "条件",
      label: "过了划扣时间 → 才对公转账",
      short: "过了划扣时间",
      say: "还款过了当天划扣时间（系统不再自动划扣）→ 才引导客户线下对公转账",
      why: "没过划扣时间要等系统自动扣；提前给账户会变成重复扣款",
      branches: [101, 102],
      source: "rule",
    },
  ],
  clusters: [
    { id: "c1", name: "还款 · 账户", size: 3, branches: 12, summary: "共 12 枝涉及", points: [], ai: false },
    { id: "c2", name: "结清 · 工单", size: 3, branches: 8, summary: "共 8 枝涉及", points: [], ai: false },
  ],
  insight: "",
};

const NODES = [
  { id: 101, pid: 0, title: "小金额还款", kids: 2 },
  { id: 102, pid: 0, title: "线下还款", kids: 0 },
  { id: 103, pid: 0, title: "结清证明", kids: 0 },
];

function aiGraph() {
  return {
    ...GRAPH,
    engine: "deepseek",
    insight: "四条业务线共用同一套核身流程。",
    clusters: [
      { ...GRAPH.clusters[0], name: "小金额还款与对公账户", ai: true, points: ["先查订单再报账户"] },
      { ...GRAPH.clusters[1], name: "合同与结清证明开具", ai: true, points: [] },
    ],
  };
}

function mountPanel() {
  return mount(KnowledgeGraph, { props: { open: true, nodes: NODES } });
}

beforeEach(() => {
  kg.mockReset();
  kgAI.mockReset();
  kg.mockResolvedValue(structuredClone(GRAPH));
  kgAI.mockResolvedValue({ ok: true, ai: true, cached: false, graph: aiGraph() });
});

describe("业务知识图谱面板", () => {
  it("打开就把概念画出来，一条不落", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(kg).toHaveBeenCalledTimes(1);
    expect(w.findAll(".kg-node").length).toBe(GRAPH.concepts.length);
    expect(w.findAll(".kg-link").length).toBe(GRAPH.links.length);
  });

  it("统计写在标题下面：几枝、几个概念、几条业务线、覆盖率", async () => {
    const w = mountPanel();
    await flushPromises();
    const sub = w.find(".kg-sub").text();
    expect(sub).toContain("40 枝");
    expect(sub).toContain("6 个业务概念");
    expect(sub).toContain("2 条业务线");
    expect(sub).toContain("86%");
  });

  it("业务线一条一张卡；AI 结果回来后名字换成 AI 的，并多一块洞察", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.findAll(".kg-line").length).toBe(2);

    expect(w.text()).toContain("AI 洞察");
    expect(w.find("#kgEngine").text()).toContain("DeepSeek");
    expect(w.text()).toContain("小金额还款与对公账户");
    expect(w.text()).toContain("四条业务线共用同一套核身流程");
  });

  it("AI 还没回来时先显示本地名字，不等它", async () => {
    kgAI.mockReturnValue(new Promise(() => {})); // 一直挂着
    const w = mountPanel();
    await flushPromises();
    expect(w.text()).toContain("还款 · 账户");
    expect(w.find("#kgBusy").exists()).toBe(true);
    expect(w.find("#kgEngine").text()).toContain("正在提炼");
  });

  it("点业务线卡：这一簇亮，别的暗下去", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.findAll(".kg-line")[0].trigger("click");

    const dim = w.findAll(".kg-node.dim");
    const lit = w.findAll(".kg-node").filter((n) => !n.classes("dim"));
    expect(lit.length).toBe(3); // c1 的三个概念
    expect(dim.length).toBe(3); // c2 的三个被压暗
    expect(w.find(".kg-foot").text()).toContain("正在看");
  });

  it("再点一次同一张卡 = 取消筛选", async () => {
    const w = mountPanel();
    await flushPromises();
    const card = w.findAll(".kg-line")[0];
    await card.trigger("click");
    await card.trigger("click");
    expect(w.findAll(".kg-node.dim").length).toBe(0);
  });

  it("点概念：侧栏换成它落在这几枝上，点枝就跳过去", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-id="k1"]').trigger("click");

    expect(w.find("#kgDetail").exists()).toBe(true);
    expect(w.find("#kgDetail").text()).toContain("还款");
    const rows = w.findAll(".kg-branch");
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain("小金额还款");

    await rows[0].trigger("click");
    expect(w.emitted("pick")[0]).toEqual([101]);
  });

  it("「回到业务线」把侧栏换回来", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-id="k4"]').trigger("click");
    expect(w.find("#kgDetail").exists()).toBe(true);
    await w.find("#kgBack").trigger("click");
    expect(w.find("#kgDetail").exists()).toBe(false);
    expect(w.findAll(".kg-line").length).toBe(2);
  });

  it("概念没有关联枝时给句话，不留空白", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-id="k6"]').trigger("click");
    expect(w.find("#kgDetail").text()).toContain("没有可跳转的记录");
  });

  it("Esc：先退出「正在看某条线」，再按才收起面板", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.findAll(".kg-line")[0].trigger("click");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(w.emitted("close")).toBeFalsy();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(w.emitted("close")).toBeTruthy();
  });

  it("模型失败时明确说一句，图照样在", async () => {
    kgAI.mockResolvedValue({ ok: true, ai: false, reason: "模型暂时没回应（网络或配额），已用本地语义分析" });
    const w = mountPanel();
    await flushPromises();
    expect(w.find("#kgNote").text()).toContain("已用本地语义分析");
    expect(w.findAll(".kg-node").length).toBe(6);
    expect(w.find("#kgEngine").text()).toContain("本地语义分析");
  });

  it("服务器没配密钥就不去问模型", async () => {
    kg.mockResolvedValue({ ...structuredClone(GRAPH), aiAvailable: false });
    const w = mountPanel();
    await flushPromises();
    expect(kgAI).not.toHaveBeenCalled();
    expect(w.find("#kgNote").text()).toContain("没配模型密钥");
  });

  it("触发规则画成带箭头的弧线，标签压在弧上", async () => {
    const w = mountPanel();
    await flushPromises();
    const rule = w.find(".kg-rule");
    expect(rule.exists()).toBe(true);
    const path = rule.find(".kg-rule-line");
    expect(path.attributes("marker-end")).toContain("#kgArrow");
    expect(path.attributes("d")).toContain("Q"); // 弧线，不是直线
    expect(rule.find(".kg-rule-label").text()).toContain("过了划扣时间");
    expect(w.find("#kgSvg").find("#kgArrow").exists()).toBe(true);
  });

  it("侧栏把整条因果写全：条件 → 结果 + 为什么 + 几枝", async () => {
    const w = mountPanel();
    await flushPromises();
    const box = w.find("#kgRules");
    expect(box.exists()).toBe(true);
    expect(box.text()).toContain("条件");
    expect(box.text()).toContain("还款 → 账户");
    expect(box.text()).toContain("系统不再自动划扣");
    expect(box.text()).toContain("重复扣款");
    expect(box.text()).toContain("2 枝");
  });

  it("点规则：两端和它们的业务线亮着，其余压暗；再点取消", async () => {
    const w = mountPanel();
    await flushPromises();
    const card = w.find(".kg-rule-item");
    await card.trigger("click");
    expect(w.find(".kg-foot").text()).toContain("还款 → 账户");
    expect(w.findAll(".kg-node.dim").length).toBe(3); // c1 的 3 个亮，c2 的 3 个暗
    expect(w.find(".kg-rule").classes()).toContain("on");

    await card.trigger("click");
    expect(w.findAll(".kg-node.dim").length).toBe(0);
  });

  it("没有触发规则时不显示那一块，图也不报错", async () => {
    const g = structuredClone(GRAPH);
    g.rules = [];
    kg.mockResolvedValue(g);
    kgAI.mockReturnValue(new Promise(() => {}));
    const w = mountPanel();
    await flushPromises();
    expect(w.find("#kgRules").exists()).toBe(false);
    expect(w.findAll(".kg-rule").length).toBe(0);
    expect(w.findAll(".kg-node").length).toBe(6);
  });

  it("枝太少时给的是「先种几枝」而不是空白图", async () => {
    kg.mockResolvedValue({ ...structuredClone(GRAPH), empty: "枝还太少（至少 3 枝）—— 先种几枝，再来梳理。" });
    const w = mountPanel();
    await flushPromises();
    expect(w.find("#kgEmpty").text()).toContain("枝还太少");
    expect(w.findAll(".kg-node").length).toBe(0);
  });
});
