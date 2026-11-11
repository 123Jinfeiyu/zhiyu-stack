import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TreeView from "../src/components/TreeView.vue";
import { SEED, createBackend } from "./fakeApi";

let backend;
let wrapper;

const tick = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await flushPromises();
};

/** 动态 import，保证每个用例拿到的是同一个模块实例（vitest 默认缓存模块） */
async function mod() {
  return await import("../src/uiscale");
}

const cssVar = () => document.documentElement.style.getPropertyValue("--ui-scale");
const pct = () => wrapper.find("#scaleReset").text();

async function mountTree() {
  wrapper = mount(TreeView, { props: { path: [] }, attachTo: document.body });
  await tick();
  return wrapper;
}

beforeEach(async () => {
  backend = createBackend(SEED);
  global.fetch = vi.fn(backend.fetch);
  localStorage.clear();
  const m = await mod();
  m.setScale(1);
});

afterEach(async () => {
  if (wrapper) wrapper.unmount();
  wrapper = null;
  const m = await mod();
  m.setScale(1);
  localStorage.clear();
});

describe("界面缩放 · 模块", () => {
  it("默认 100%，并写到 html 的 --ui-scale", async () => {
    const m = await mod();
    m.setScale(1);
    expect(m.uiScale.value).toBe(1);
    expect(cssVar()).toBe("1");
  });

  it("放大缩小按 10% 步进", async () => {
    const m = await mod();
    expect(m.scaleUp()).toBeCloseTo(1.1, 5);
    expect(m.scaleUp()).toBeCloseTo(1.2, 5);
    expect(m.scaleDown()).toBeCloseTo(1.1, 5);
    expect(cssVar()).toBe("1.1");
  });

  it("上下限封顶：最大 200%，最小 80%", async () => {
    const m = await mod();
    for (let i = 0; i < 30; i++) m.scaleUp();
    expect(m.uiScale.value).toBe(2);
    for (let i = 0; i < 40; i++) m.scaleDown();
    expect(m.uiScale.value).toBe(0.8);
  });

  it("缩放值记进 localStorage，scaleReset 回到 100%", async () => {
    const m = await mod();
    m.scaleUp();
    expect(localStorage.getItem("zhiyu_ui_scale")).toBe("1.1");
    m.scaleReset();
    expect(m.uiScale.value).toBe(1);
    expect(cssVar()).toBe("1");
  });
});

describe("界面缩放 · 快捷键", () => {
  const key = (k, opts = {}) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));

  it("Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 复位", async () => {
    const m = await mod();
    m.bindUiScale();
    key("=", { ctrlKey: true });
    expect(m.uiScale.value).toBeCloseTo(1.1, 5);
    key("-", { ctrlKey: true });
    expect(m.uiScale.value).toBeCloseTo(1, 5);
    key("=", { ctrlKey: true });
    key("0", { ctrlKey: true });
    expect(m.uiScale.value).toBe(1);
  });

  it("没有 Ctrl 的 +/- 不动缩放", async () => {
    const m = await mod();
    m.bindUiScale();
    const before = m.uiScale.value;
    key("=");
    key("-");
    expect(m.uiScale.value).toBe(before);
  });

  it("Ctrl+滚轮也能缩放（并阻止浏览器默认缩放）", async () => {
    const m = await mod();
    m.bindUiScale();
    const before = m.uiScale.value;
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(m.uiScale.value).toBeGreaterThan(before);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("界面缩放 · 顶栏控件", () => {
  it("点 Aa 打开面板，默认显示 100%", async () => {
    await mountTree();
    expect(wrapper.find("#scalePop").exists()).toBe(false);
    await wrapper.find("#scaleBtn").trigger("click");
    expect(wrapper.find("#scalePop").exists()).toBe(true);
    expect(pct()).toBe("100%");
  });

  it("＋/− 改变百分比，并把 --ui-scale 应用到页面上", async () => {
    await mountTree();
    await wrapper.find("#scaleBtn").trigger("click");
    await wrapper.find("#scaleUp").trigger("click");
    await tick();
    expect(pct()).toBe("110%");
    expect(cssVar()).toBe("1.1");
    await wrapper.find("#scaleDown").trigger("click");
    await tick();
    expect(pct()).toBe("100%");
  });

  it("点百分比回到 100%", async () => {
    await mountTree();
    await wrapper.find("#scaleBtn").trigger("click");
    await wrapper.find("#scaleUp").trigger("click");
    await wrapper.find("#scaleUp").trigger("click");
    await tick();
    expect(pct()).toBe("120%");
    await wrapper.find("#scaleReset").trigger("click");
    await tick();
    expect(pct()).toBe("100%");
  });

  it("点面板外面把面板收起来", async () => {
    await mountTree();
    await wrapper.find("#scaleBtn").trigger("click");
    expect(wrapper.find("#scalePop").exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(wrapper.find("#scalePop").exists()).toBe(false);
  });
});
