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

async function loginAndMount(opts = {}) {
  backend = createBackend(SEED, { loggedIn: false, password: "pw", ...opts });
  global.fetch = vi.fn(backend.fetch);
  wrapper = mount(App, { attachTo: document.body });
  await tick(40);
  await wrapper.find("#username").setValue("tester");
  await wrapper.find("#pw").setValue("pw");
  await wrapper.find("#loginBtn").trigger("click");
  await tick(60);
}

describe("改密码弹窗", () => {
  it("顶栏有 🔑 按钮，默认不弹", async () => {
    await loginAndMount();
    expect(wrapper.find("#pwBtn").exists()).toBe(true);
    expect(wrapper.find("#pwModal").exists()).toBe(false);
  });

  it("点开弹窗、三个输入框都在；取消能关", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    expect(wrapper.find("#pwModal").exists()).toBe(true);
    expect(wrapper.find("#pwOld").exists()).toBe(true);
    expect(wrapper.find("#pwNew").exists()).toBe(true);
    expect(wrapper.find("#pwRepeat").exists()).toBe(true);
    await wrapper.find("#pwCancel").trigger("click");
    expect(wrapper.find("#pwModal").exists()).toBe(false);
  });

  it("没填全就地报错，不发请求", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    await wrapper.find("#pwSave").trigger("click");
    expect(wrapper.find("#pwErr").text()).toContain("都要填");
    const calls = backend.calls.filter((c) => c[0] === "POST" && c[1] === "/api/password");
    expect(calls.length).toBe(0);
  });

  it("两遍新密码不一样报错", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    await wrapper.find("#pwOld").setValue("pw");
    await wrapper.find("#pwNew").setValue("newpass-123");
    await wrapper.find("#pwRepeat").setValue("newpass-456");
    await wrapper.find("#pwSave").trigger("click");
    expect(wrapper.find("#pwErr").text()).toContain("不一样");
    const calls = backend.calls.filter((c) => c[0] === "POST" && c[1] === "/api/password");
    expect(calls.length).toBe(0);
  });

  it("原密码错 → 服务端报错显示在弹窗里", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    await wrapper.find("#pwOld").setValue("wrong-old");
    await wrapper.find("#pwNew").setValue("newpass-123");
    await wrapper.find("#pwRepeat").setValue("newpass-123");
    await wrapper.find("#pwSave").trigger("click");
    await tick(40);
    expect(wrapper.find("#pwErr").text()).toContain("原密码不对");
    expect(wrapper.find("#pwModal").exists()).toBe(true);
  });

  it("改成功 → 弹窗关、有提示，旧密码登不上、新密码能登上", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    await wrapper.find("#pwOld").setValue("pw");
    await wrapper.find("#pwNew").setValue("newpass-123");
    await wrapper.find("#pwRepeat").setValue("newpass-123");
    await wrapper.find("#pwSave").trigger("click");
    await tick(40);

    expect(wrapper.find("#pwModal").exists()).toBe(false);
    expect(wrapper.find("#toast").text()).toContain("密码已改");
    expect(backend.currentUser).toBe("tester");
    expect(backend.passwordOf("tester")).toBe("newpass-123");

    // 登出后旧密码被拒、新密码能进
    await wrapper.find("#logoutBtn").trigger("click");
    await tick(60);
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#pw").setValue("pw");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(60);
    expect(wrapper.find("#pwErrText, #loginErr").exists()).toBe(true);

    await wrapper.find("#pw").setValue("newpass-123");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(60);
    expect(wrapper.find("#grid").exists()).toBe(true);
  });

  it("新密码太短被拒（服务端 400）", async () => {
    await loginAndMount();
    await wrapper.find("#pwBtn").trigger("click");
    await wrapper.find("#pwOld").setValue("pw");
    await wrapper.find("#pwNew").setValue("123");
    await wrapper.find("#pwRepeat").setValue("123");
    await wrapper.find("#pwSave").trigger("click");
    await tick(40);
    expect(wrapper.find("#pwErr").text()).toContain("至少 6 位");
  });
});
