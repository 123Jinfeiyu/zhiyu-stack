import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShareView from "../src/components/ShareView.vue";
import { SEED, createBackend } from "./fakeApi";

let backend;
let wrapper;

const tick = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await flushPromises();
};

beforeEach(() => {
  backend = createBackend(SEED);
  backend.shares.set("tok1", 1);
  global.fetch = vi.fn(backend.fetch);
  localStorage.clear();
});

afterEach(() => {
  if (wrapper) wrapper.unmount();
  wrapper = null;
});

describe("只读分享", () => {
  it("渲染分享根节点与它的子枝", async () => {
    wrapper = mount(ShareView, { props: { token: "tok1" }, attachTo: document.body });
    await tick(40);
    expect(wrapper.find(".node-head h1").text()).toBe("枝语 · 使用说明");
    expect(wrapper.findAll(".grid .ncard").map((c) => c.find(".ncard-title").text())).toEqual([
      "怎么钻取",
      "快捷键",
    ]);
  });

  it("没有任何编辑入口", async () => {
    wrapper = mount(ShareView, { props: { token: "tok1" }, attachTo: document.body });
    await tick(40);
    expect(wrapper.find(".ncard-acts").exists()).toBe(false);
    expect(wrapper.find("#fab").exists()).toBe(false);
    expect(wrapper.find("#searchInput").exists()).toBe(false);
  });

  it("可以继续往里钻并退回", async () => {
    wrapper = mount(ShareView, { props: { token: "tok1" }, attachTo: document.body });
    await tick(40);
    await wrapper.findAll(".grid .ncard")[0].trigger("click");
    await tick(20);
    expect(wrapper.find(".node-head h1").text()).toBe("怎么钻取");
    expect(wrapper.find(".grid .ncard").find(".ncard-title").text()).toBe("为什么不是文件夹");

    const crumbs = wrapper.findAll("#crumb .crumb");
    await crumbs[0].trigger("click");
    await tick(20);
    expect(wrapper.find(".node-head h1").text()).toBe("枝语 · 使用说明");
  });

  it("无效 token 给出可读的错误", async () => {
    wrapper = mount(ShareView, { props: { token: "nope" }, attachTo: document.body });
    await tick(40);
    expect(wrapper.find(".empty").text()).toContain("无效");
  });

  it("正文按 Markdown 渲染", async () => {
    backend.find(1).content = "# 大标题\n\n**粗**";
    wrapper = mount(ShareView, { props: { token: "tok1" }, attachTo: document.body });
    await tick(40);
    expect(wrapper.find(".md h1").text()).toBe("大标题");
    expect(wrapper.find(".md b").text()).toBe("粗");
  });
});
