import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { route } from "../src/router";
import { SEED, createBackend } from "./fakeApi";

let backend;
let wrapper;

const tick = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await flushPromises();
};

beforeEach(() => {
  localStorage.clear();
  route.value = { name: "tree", path: [] };
});

afterEach(() => {
  if (wrapper) wrapper.unmount();
  wrapper = null;
});

describe("App 接线", () => {
  it("未登录先看到登录页", async () => {
    backend = createBackend(SEED, { loggedIn: false, password: "pw" });
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);
    expect(wrapper.find("#pw").exists()).toBe(true);
    expect(wrapper.find("#grid").exists()).toBe(false);
  });

  it("登录后直接进树", async () => {
    backend = createBackend(SEED, { loggedIn: false, password: "pw" });
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#pw").setValue("pw");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(60);

    expect(wrapper.find("#pw").exists()).toBe(false);
    expect(wrapper.findAll("#grid .ncard").length).toBe(2);
  });

  it("已登录时直接是树，不用再登录", async () => {
    backend = createBackend(SEED);
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);
    expect(wrapper.find("#pw").exists()).toBe(false);
    expect(wrapper.find("#grid").exists()).toBe(true);
  });

  it("删除按钮 → App 弹出确认框 → 点确定才真的删", async () => {
    backend = createBackend(SEED);
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);

    await wrapper.findAll("#grid .ncard")[0].find(".act.del").trigger("click");
    await tick(40);
    expect(wrapper.find("#confirm").exists()).toBe(true);
    expect(wrapper.find("#confirm").text()).toContain("枝语 · 使用说明");

    await wrapper.find("#confirmYes").trigger("click");
    await tick(80);
    expect(wrapper.find("#confirm").exists()).toBe(false);
    expect(backend.find(1)).toBeUndefined();
    expect(wrapper.findAll("#grid .ncard").length).toBe(1);
  });

  it("确认框点取消：框关掉、数据还在", async () => {
    backend = createBackend(SEED);
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);
    await wrapper.findAll("#grid .ncard")[0].find(".act.del").trigger("click");
    await tick(40);
    await wrapper.find("#confirmNo").trigger("click");
    await tick(40);
    expect(wrapper.find("#confirm").exists()).toBe(false);
    expect(backend.find(1)).toBeTruthy();
  });

  it("访问 /s/<token> 走只读分享，用不着登录", async () => {
    backend = createBackend(SEED, { loggedIn: false });
    backend.shares.set("tok1", 1);
    global.fetch = vi.fn(backend.fetch);
    route.value = { name: "share", token: "tok1", path: [] };

    wrapper = mount(App, { attachTo: document.body });
    await tick(60);
    expect(wrapper.find("#pw").exists()).toBe(false);
    expect(wrapper.find(".node-head h1").text()).toBe("枝语 · 使用说明");
    expect(wrapper.find(".sharebar").exists()).toBe(true);
  });

  it("登出回到口令页", async () => {
    backend = createBackend(SEED);
    global.fetch = vi.fn(backend.fetch);

    wrapper = mount(App, { attachTo: document.body });
    await tick(40);
    await wrapper.find("#logoutBtn").trigger("click");
    await tick(60);
    expect(wrapper.find("#pw").exists()).toBe(true);
  });
});
