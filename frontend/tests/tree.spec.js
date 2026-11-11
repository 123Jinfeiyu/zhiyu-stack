import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TreeView from "../src/components/TreeView.vue";
import { answerConfirm } from "../src/ui";
import { SEED, createBackend } from "./fakeApi";

let backend;
let wrapper;

const tick = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await flushPromises();
};

beforeEach(() => {
  backend = createBackend(SEED);
  global.fetch = vi.fn(backend.fetch);
  localStorage.clear();
});

afterEach(() => {
  if (wrapper) wrapper.unmount();
  wrapper = null;
});

async function mountTree(path = []) {
  wrapper = mount(TreeView, { props: { path }, attachTo: document.body });
  await tick();
  return wrapper;
}

const cards = () => wrapper.findAll("#grid .ncard");
const titles = () => cards().map((c) => c.find(".ncard-title").text());

describe("钻取树", () => {
  it("根视图列出所有顶层树", async () => {
    await mountTree();
    expect(titles()).toEqual(["枝语 · 使用说明", "这周要做的事"]);
    expect(wrapper.find("#curTitle").text()).toBe("你的树林");
  });

  it("卡片点标题 → 抛出去新的 path", async () => {
    await mountTree();
    await cards()[0].trigger("click");
    const ev = wrapper.emitted("navigate");
    expect(ev).toBeTruthy();
    expect(ev[0][0]).toEqual({ name: "tree", path: [1] });
  });

  it("深一层时渲染子节点与面包屑", async () => {
    // path [1,2] 表示站在「怎么钻取」上，它下面还有「为什么不是文件夹」
    await mountTree([1, 2]);
    expect(wrapper.find("#curTitle").text()).toBe("怎么钻取");
    expect(wrapper.findAll("#crumb .crumb").map((c) => c.text())).toEqual([
      "全部笔记",
      "枝语 · 使用说明",
      "怎么钻取",
    ]);
    expect(titles()).toEqual(["为什么不是文件夹"]);
  });

  it("子枝计数徽章正确", async () => {
    await mountTree();
    expect(cards()[0].find(".ncard-badge").text()).toBe("2 枝");
  });

  it("空枝显示空状态", async () => {
    await mountTree([3]);
    expect(wrapper.find("#empty").exists()).toBe(true);
    expect(cards().length).toBe(0);
  });
});

describe("搜索", () => {
  it("只搜当前层以下，命中按路径跳转", async () => {
    await mountTree();
    const input = wrapper.find("#searchInput");
    await input.setValue("快捷键");
    await tick(320);
    expect(titles()).toEqual(["快捷键"]);

    await cards()[0].trigger("click");
    const ev = wrapper.emitted("navigate");
    expect(ev[ev.length - 1][0].path).toEqual([1, 4]);
  });

  it("搜索范围受当前位置限制", async () => {
    await mountTree([5]);
    await wrapper.find("#searchInput").setValue("快捷键");
    await tick(320);
    expect(cards().length).toBe(0);
    expect(wrapper.find("#empty").text()).toContain("没找到");
  });

  it("清除搜索后恢复卡片", async () => {
    await mountTree();
    await wrapper.find("#searchInput").setValue("快捷键");
    await tick(320);
    expect(cards().length).toBe(1);
    await wrapper.find("#searchClear").trigger("click");
    await tick(20);
    expect(titles()).toEqual(["枝语 · 使用说明", "这周要做的事"]);
  });
});

describe("编辑", () => {
  it("按 n 打开抽屉，Esc 关掉", async () => {
    await mountTree();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    await tick(20);
    expect(wrapper.find("#drawer").classes()).toContain("on");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick(20);
    expect(wrapper.find("#drawer").classes()).not.toContain("on");
  });

  it("新建根节点后网格里多一张卡", async () => {
    await mountTree();
    await wrapper.find("#fab").trigger("click");
    await tick(20);
    await wrapper.find("#fTitle").setValue("新的树");
    await wrapper.find("#fSave").trigger("click");
    await tick(40);

    const post = backend.calls.find((c) => c.method === "POST" && c.url === "/api/nodes");
    expect(post.body.title).toBe("新的树");
    expect(post.body.pid).toBe(0);
    expect(titles()).toContain("新的树");
  });

  it("在子层新建会挂在当前节点下", async () => {
    await mountTree([1]);
    await wrapper.find("#fab").trigger("click");
    await tick(20);
    await wrapper.find("#fTitle").setValue("新长的一枝");
    await wrapper.find("#fSave").trigger("click");
    await tick(40);

    const post = backend.calls.find((c) => c.method === "POST" && c.url === "/api/nodes");
    expect(post.body.pid).toBe(1);
    expect(titles()).toContain("新长的一枝");
  });

  it("编辑已有节点会走 update", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act").trigger("click"); // 编辑
    await tick(20);
    expect(wrapper.find("#fTitle").element.value).toBe("枝语 · 使用说明");
    await wrapper.find("#fTitle").setValue("改过的标题");
    await wrapper.find("#fSave").trigger("click");
    await tick(40);
    const upd = backend.calls.find((c) => c.url.endsWith("/update"));
    expect(upd.body.title).toBe("改过的标题");
    expect(titles()).toContain("改过的标题");
  });

  it("删除要先确认，确认后连根消失", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act.del").trigger("click");
    await tick(20);
    // 确认框挂在 App 里，这里直接把 Promise 结掉
    answerConfirm(true);
    await tick(60);
    expect(backend.find(1)).toBeUndefined();
    expect(backend.find(2)).toBeUndefined();
    expect(titles()).toEqual(["这周要做的事"]);
  });

  it("取消确认则不动数据", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act.del").trigger("click");
    await tick(20);
    answerConfirm(false);
    await tick(40);
    expect(backend.find(1)).toBeTruthy();
  });
});

describe("移动", () => {
  it("横幅出现，钻到目标后移到这里", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act:nth-child(2)").trigger("click");
    await tick(20);
    expect(wrapper.find("#moveBanner").exists()).toBe(true);
    expect(wrapper.find("#moveBanner").text()).toContain("枝语 · 使用说明");

    // 模拟"钻到目标位置"：父组件换 path
    await wrapper.setProps({ path: [5] });
    await tick(30);
    await wrapper.find("#moveConfirm").trigger("click");
    await tick(60);

    const mv = backend.calls.find((c) => c.url.endsWith("/move"));
    expect(mv.body.pid).toBe(5);
    expect(wrapper.find("#moveBanner").exists()).toBe(false);
  });

  it("取消移动不发请求", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act:nth-child(2)").trigger("click");
    await tick(20);
    await wrapper.find("#moveCancel").trigger("click");
    await tick(20);
    expect(backend.calls.some((c) => c.url.endsWith("/move"))).toBe(false);
  });
});

describe("分享", () => {
  it("点分享拿到只读链接", async () => {
    await mountTree();
    await cards()[0].find(".ncard-acts .act:nth-child(3)").trigger("click");
    await tick(40);
    const modal = wrapper.find("#shareModal");
    expect(modal.exists()).toBe(true);
    expect(wrapper.find("#shareUrlInput").element.value).toContain("/s/tok1");
  });
});

describe("小地图", () => {
  it("列出全部节点，单击只选中不跳走", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    const items = wrapper.findAll("#mapPanel .map-item");
    expect(items.length).toBe(SEED.length);

    await items[2].trigger("click");
    await tick(20);
    // 点一下就跳走的话，就没机会按 Del 了 —— 现在是「单击选中、双击进入」
    expect(wrapper.emitted("navigate")).toBeFalsy();
    const sel = wrapper.findAll("#mapPanel .map-item.sel");
    expect(sel.length).toBe(1);
    expect(sel[0].attributes("data-id")).toBe("3");
    expect(wrapper.find("#mapFoot").text()).toContain("为什么不是文件夹");
  });

  it("双击才钻进那一枝（路径带齐祖先）", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    await wrapper.findAll("#mapPanel .map-item")[2].trigger("dblclick");
    await tick(20);
    const ev = wrapper.emitted("navigate");
    // 深度优先排序：1 → 2 → 3，所以第 3 项是 id 3
    expect(ev[ev.length - 1][0].path).toEqual([1, 2, 3]);
  });

  it("是一棵倒过来的树：根在最下面，一辈比一辈高", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    const gs = wrapper.findAll("#mapPanel .map-item");
    const pos = gs.map((g) => ({
      id: Number(g.attributes("data-id")),
      depth: Number(g.attributes("data-depth")),
      x: Number(g.attributes("data-x")),
      y: Number(g.attributes("data-y")),
    }));
    // SEED 里 1、5 是根（两棵），其余都挂在它们下面
    expect(pos.filter((p) => p.depth === 0).length).toBe(2);
    expect([...new Set(pos.map((p) => p.depth))].sort()).toEqual([0, 1, 2]);

    // 一棵树一条横带：同一棵里「同代同高、每深一代高 80」
    const STEP = 80;
    const byTree = new Map();
    for (const p of pos) {
      const key = p.y + p.depth * STEP; // 这一棵的基线（根节点顶边）
      if (!byTree.has(key)) byTree.set(key, []);
      byTree.get(key).push(p);
    }
    expect(byTree.size).toBe(2);
    const bases = [...byTree.keys()].sort((a, b) => a - b);
    for (const [base, arr] of byTree) {
      for (const p of arr) expect(p.y).toBe(base - p.depth * STEP);
    }
    // 第二棵整棵排在第一条带的下方，不能压在第一棵上
    const span = (arr) => ({
      top: Math.min(...arr.map((p) => p.y)),
      bottom: Math.max(...arr.map((p) => p.y)) + 36, // 节点高
    });
    const t1 = span(byTree.get(bases[0]));
    const t2 = span(byTree.get(bases[1]));
    expect(t2.top).toBeGreaterThan(t1.bottom);
    // 还隔着一段地面 + 代间空档，两棵树不会粘在一起
    expect(t2.top - t1.bottom).toBeGreaterThanOrEqual(40);

    // 根必须比自己所有后代都低（y 更大）—— 这才是「倒过来」
    const y = (id) => pos.find((p) => p.id === id).y;
    expect(y(1)).toBeGreaterThan(y(2));
    expect(y(2)).toBeGreaterThan(y(3));
    expect(y(1)).toBeGreaterThan(y(4));
    expect(y(5)).toBeGreaterThan(y(6));
  });

  it("枝条是弯的、越往末梢越细，根底下还扎着地面", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);

    const paths = wrapper.findAll("#mapPanel .branch");
    // 4 条枝 + 2 根树干
    expect(paths.length).toBe(SEED.length - 2 + 2);
    const real = paths.filter((p) => !p.classes().includes("trunk"));
    for (const p of real) {
      const d = p.attributes("d");
      // 三次贝塞尔曲线，不是族谱那种直角折线
      expect(d).toContain("C");
      expect(d).not.toContain("V");
    }
    // 从根往末梢，一笔比一笔细
    const w = (p) => Number(p.attributes("style").match(/--dw:\s*([\d.]+)/)[1]);
    const wAt = (depth) =>
      w(real.find((p) => p.attributes("data-depth") === String(depth)));
    expect(wAt(0)).toBeGreaterThan(wAt(1));
    // 树干比任何一根枝都粗
    const trunk = paths.find((p) => p.classes().includes("trunk"));
    expect(w(trunk)).toBeGreaterThan(wAt(0));
    // 每棵树都有地面那一小片光
    expect(wrapper.findAll("#mapPanel .glow-pad").length).toBe(2);
  });

  it("每个非根节点都有一条枝，父辈横向居中于首尾两个孩子", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    // 6 个节点、2 棵根 → 4 条枝（树干另算，用 .trunk 排除）
    expect(wrapper.findAll("#mapPanel .branch:not(.trunk)").length).toBe(SEED.length - 2);
    const gs = wrapper.findAll("#mapPanel .map-item");
    const x = (i) => Number(gs[i].attributes("data-x"));
    // DOM 是深度优先前序：0→节点1，1→节点2，3→节点4
    // 节点 1 有孩子 2 和 4，它的 x 应等于两端孩子 x 的中点
    expect(x(0)).toBe((x(1) + x(3)) / 2);
    // 单孩子的父节点（2 → 3）正好站在孩子正下方
    expect(x(1)).toBe(x(2));
  });

  it("首页正文里也点得开这棵树", async () => {
    await mountTree();
    await wrapper.find("#openTree").trigger("click");
    await tick(20);
    expect(wrapper.find("#mapPanel").classes()).toContain("on");
  });

  it("悬停一枝会点亮它长上来的那条路", async () => {
    await mountTree();
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    const leaf = wrapper.findAll("#mapPanel .map-item")[2]; // id 3，最深那一代
    await leaf.trigger("mouseenter");
    await tick(10);
    const hot = wrapper.findAll("#mapPanel .map-item.hot");
    // 3 → 2 → 1，三代都亮
    expect(hot.length).toBe(3);
    const hotEdges = wrapper.findAll("#mapPanel .branch.hot:not(.trunk)");
    expect(hotEdges.length).toBe(2);
    // 连根扎进地面的那截树干也跟着亮 —— 血缘一直连到地底下
    expect(wrapper.findAll("#mapPanel .trunk.hot").length).toBe(1);
  });
});

describe("族谱里直接改树（键盘 CRUD）", () => {
  const hit = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  const selId = () => {
    const el = wrapper.find("#mapPanel .map-item.sel");
    return el.exists() ? el.attributes("data-id") : null;
  };
  async function openMap(path) {
    await mountTree(path);
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    return wrapper.findAll("#mapPanel .map-item");
  }
  const delCalls = () => backend.calls.filter((c) => c.url.endsWith("/delete"));

  it("第一次 Del 只把这一枝标红，数据不动", async () => {
    const items = await openMap();
    await items[2].trigger("click");
    hit("Delete");
    await tick(20);

    expect(wrapper.find("#mapPanel .map-item.dying").attributes("data-id")).toBe("3");
    expect(wrapper.find("#mapFoot").classes()).toContain("warn");
    expect(wrapper.find("#mapFoot").text()).toContain("再按一次");
    expect(backend.find(3)).toBeTruthy();
    expect(delCalls().length).toBe(0);
  });

  it("第二次 Del 连根删掉，整片树林跟着重排", async () => {
    const items = await openMap();
    await items[0].trigger("click"); // 节点 1，下挂 2、3、4
    hit("Delete");
    await tick(20);
    hit("Delete");
    await tick(120);

    expect(delCalls().length).toBe(1);
    for (const id of [1, 2, 3, 4]) expect(backend.find(id)).toBeUndefined();
    expect(backend.find(5)).toBeTruthy();
    expect(wrapper.findAll("#mapPanel .map-item").length).toBe(SEED.length - 4);
    // 删完不会留下一个指向空气的选中框
    expect(selId()).toBeNull();
  });

  it("Esc 撤掉待删状态", async () => {
    const items = await openMap();
    await items[2].trigger("click");
    hit("Delete");
    await tick(20);
    hit("Escape");
    await tick(20);

    expect(wrapper.findAll("#mapPanel .map-item.dying").length).toBe(0);
    expect(wrapper.find("#mapFoot").classes()).not.toContain("warn");
    expect(backend.find(3)).toBeTruthy();
    // 这一下 Esc 只用来取消，不该顺手把面板关掉
    expect(wrapper.find("#mapPanel").classes()).toContain("on");
  });

  it("删掉当前正站着的那枝，会退回上一层", async () => {
    await openMap([1]); // 站在节点 1 上
    const items = wrapper.findAll("#mapPanel .map-item");
    await items[0].trigger("click");
    expect(selId()).toBe("1");
    hit("Delete");
    await tick(20);
    hit("Delete");
    await tick(120);

    const ev = wrapper.emitted("navigate");
    expect(ev[ev.length - 1][0].path).toEqual([]);
    expect(backend.find(1)).toBeUndefined();
  });

  it("F2 打开抽屉时带着这一枝的正文，关掉后族谱回来", async () => {
    const items = await openMap();
    await items[2].trigger("click"); // id 3，正文「文件夹只有一层。」
    hit("F2");
    await tick(80);

    expect(wrapper.find("#drawer").classes()).toContain("on");
    expect(wrapper.find("#fTitle").element.value).toBe("为什么不是文件夹");
    // 族谱先让位，免得两层遮罩打架
    expect(wrapper.find("#mapPanel").classes()).not.toContain("on");

    await wrapper.find("#fTitle").setValue("换个名字");
    await wrapper.find("#fSave").trigger("click");
    await tick(120);

    expect(backend.find(3).title).toBe("换个名字");
    expect(wrapper.find("#mapPanel").classes()).toContain("on");
    expect(wrapper.find("#mapFoot").text()).toContain("换个名字");
  });

  it("Ins 在选中那枝下面长新枝（不是当前所在的那枝）", async () => {
    const items = await openMap();
    await items[1].trigger("click"); // id 2
    hit("Insert");
    await tick(80);
    expect(wrapper.find("#drawer").classes()).toContain("on");

    await wrapper.find("#fTitle").setValue("新芽");
    await wrapper.find("#fSave").trigger("click");
    await tick(120);

    const post = backend.calls.find((c) => c.method === "POST" && c.url === "/api/nodes");
    expect(post.body.pid).toBe(2);
    expect(backend.nodes.find((n) => n.title === "新芽").pid).toBe(2);
    // 新枝长出来之后，选中还停在原来那枝上
    expect(selId()).toBe("2");
  });

  it("上下方向键在族谱里换枝", async () => {
    const items = await openMap();
    await items[0].trigger("click");
    hit("ArrowDown");
    await tick(20);
    expect(selId()).toBe("2");
    hit("ArrowDown");
    await tick(20);
    expect(selId()).toBe("3");
    hit("ArrowUp");
    await tick(20);
    expect(selId()).toBe("2");
  });

  it("没选中时按 Del 不会误删", async () => {
    await openMap(); // 首页，currentId=0，打开时没有选中
    expect(selId()).toBeNull();
    hit("Delete");
    hit("Delete");
    await tick(60);
    expect(delCalls().length).toBe(0);
    expect(backend.nodes.length).toBe(SEED.length);
  });

  it("族谱开着时 n 键交给族谱（新枝挂在选中那枝下）", async () => {
    const items = await openMap([5]); // 站在「这周要做的事」里
    await items[4].trigger("click"); // id 5
    hit("n");
    await tick(80);
    expect(wrapper.find("#drawer").classes()).toContain("on");
    await wrapper.find("#fTitle").setValue("又一件");
    await wrapper.find("#fSave").trigger("click");
    await tick(120);
    const post = backend.calls.find((c) => c.method === "POST" && c.url === "/api/nodes");
    expect(post.body.pid).toBe(5);
  });
});

describe("打开树林就整片看得见（尽量不出滚动条）", () => {
  async function openWithViewport(w, h) {
    await mountTree();
    const body = wrapper.find(".map-body").element;
    Object.defineProperty(body, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(body, "clientHeight", { value: h, configurable: true });
    await wrapper.find("#mapBtn").trigger("click");
    await tick(20);
    return wrapper.find(".tree-canvas");
  }
  const zoomOf = (canvas) => Number(canvas.attributes("data-zoom"));

  it("树林比窗口大时自动缩到正好装下，不出滚动条", async () => {
    const canvas = await openWithViewport(400, 300);
    const z = zoomOf(canvas);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
    // 外层画布 = 原始尺寸 × 缩放，正好塞进视口（留 28px 白边）
    const svg = wrapper.find(".tree-svg");
    expect(Number(canvas.attributes("style").match(/width: (\d+)px/)[1])).toBe(
      Math.ceil(Number(svg.attributes("width")) * z)
    );
  });

  it("树林比窗口小时保持 1:1，不放大到糊", async () => {
    const canvas = await openWithViewport(5000, 4000);
    expect(zoomOf(canvas)).toBe(1);
  });

  it("＋/− 能缩放，点百分比回到适配", async () => {
    const canvas = await openWithViewport(400, 300);
    const fit = zoomOf(canvas);
    await wrapper.find("#zoomIn").trigger("click");
    await tick(10);
    expect(zoomOf(canvas)).toBeCloseTo(fit + 0.15, 5);
    await wrapper.find("#zoomFit").trigger("click");
    await tick(10);
    expect(zoomOf(canvas)).toBe(fit);
    await wrapper.find("#zoomOut").trigger("click");
    await tick(10);
    expect(zoomOf(canvas)).toBeCloseTo(fit - 0.15, 5);
  });

  it("手动缩放之后窗口再变也不抢用户的缩放", async () => {
    await openWithViewport(400, 300);
    const canvas = wrapper.find(".tree-canvas");
    const fit = zoomOf(canvas);
    await wrapper.find("#zoomIn").trigger("click");
    window.dispatchEvent(new Event("resize"));
    await tick(10);
    expect(zoomOf(canvas)).toBeCloseTo(fit + 0.15, 5);
  });
});
