import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "../src/components/LoginView.vue";
import { SEED, createBackend } from "./fakeApi";

let backend;
let wrapper;

const tick = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await flushPromises();
};

function boot(opts = {}) {
  backend = createBackend(SEED, { loggedIn: false, username: "tester", password: "moss-branch-2049", ...opts });
  global.fetch = vi.fn(backend.fetch);
  wrapper = mount(LoginView);
  return wrapper;
}

afterEach(() => {
  if (wrapper) wrapper.unmount();
  wrapper = null;
});

describe("登录", () => {
  it("空用户名不发请求", async () => {
    boot();
    await wrapper.find("#loginBtn").trigger("click");
    await tick(20);
    expect(wrapper.find("#loginErr").text()).toBe("用户名不能为空");
    expect(backend.calls.length).toBe(0);
  });

  it("有用户名没密码也不发请求", async () => {
    boot();
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(20);
    expect(wrapper.find("#loginErr").text()).toBe("密码不能为空");
    expect(backend.calls.length).toBe(0);
  });

  it("密码错提示，且不抛出去 ok", async () => {
    boot();
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#pw").setValue("wrong");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(40);
    expect(wrapper.find("#loginErr").text()).toBe("用户名或密码不对");
    expect(wrapper.emitted("ok")).toBeFalsy();
  });

  it("没这个用户也提示同一句话（不泄露用户名存在与否）", async () => {
    boot();
    await wrapper.find("#username").setValue("nobody");
    await wrapper.find("#pw").setValue("moss-branch-2049");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(40);
    expect(wrapper.find("#loginErr").text()).toBe("用户名或密码不对");
    expect(wrapper.emitted("ok")).toBeFalsy();
  });

  it("对的账号密码抛 ok", async () => {
    boot();
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#pw").setValue("moss-branch-2049");
    await wrapper.find("#loginBtn").trigger("click");
    await tick(40);
    expect(wrapper.emitted("ok")).toBeTruthy();
  });

  it("回车也能提交", async () => {
    boot();
    await wrapper.find("#username").setValue("tester");
    const input = wrapper.find("#pw");
    await input.setValue("moss-branch-2049");
    await input.trigger("keyup.enter");
    await tick(40);
    expect(wrapper.emitted("ok")).toBeTruthy();
  });

  it("清空把两个框都抹掉", async () => {
    boot();
    await wrapper.find("#username").setValue("tester");
    await wrapper.find("#pw").setValue("moss-branch-2049");
    await wrapper.find("#loginReset").trigger("click");
    expect(wrapper.find("#username").element.value).toBe("");
    expect(wrapper.find("#pw").element.value).toBe("");
  });
});

describe("注册", () => {
  async function toRegister(opts) {
    boot(opts);
    await wrapper.find("#tabRegister").trigger("click");
  }

  it("默认在登录页，点「注册」切过去", async () => {
    boot();
    expect(wrapper.find("#username").exists()).toBe(true);
    expect(wrapper.find("#regUser").exists()).toBe(false);
    await wrapper.find("#tabRegister").trigger("click");
    expect(wrapper.find("#regUser").exists()).toBe(true);
    expect(wrapper.find("#username").exists()).toBe(false);
  });

  it("用户名太短不发请求", async () => {
    await toRegister();
    await wrapper.find("#regUser").setValue("a");
    await wrapper.find("#regPw").setValue("pass-123456");
    await wrapper.find("#regBtn").trigger("click");
    await tick(20);
    expect(wrapper.find("#regErr").text()).toBe("用户名至少 2 个字");
    expect(backend.calls.length).toBe(0);
  });

  it("密码太短不发请求", async () => {
    await toRegister();
    await wrapper.find("#regUser").setValue("newbie");
    await wrapper.find("#regPw").setValue("123");
    await wrapper.find("#regBtn").trigger("click");
    await tick(20);
    expect(wrapper.find("#regErr").text()).toBe("密码至少 6 位");
    expect(backend.calls.length).toBe(0);
  });

  it("注册成功直接抛 ok（后端已自动登录）", async () => {
    await toRegister();
    await wrapper.find("#regUser").setValue("newbie");
    await wrapper.find("#regPw").setValue("pass-123456");
    await wrapper.find("#regBtn").trigger("click");
    await tick(40);
    expect(wrapper.emitted("ok")).toBeTruthy();
    expect(backend.currentUser).toBe("newbie");
  });

  it("邀请码选填：不填也能注册", async () => {
    await toRegister();
    await wrapper.find("#regUser").setValue("newbie");
    await wrapper.find("#regPw").setValue("pass-123456");
    await wrapper.find("#regBtn").trigger("click");
    await tick(40);
    expect(wrapper.emitted("ok")).toBeTruthy();
  });

  it("配了邀请码名单时，不填/填错都被拒", async () => {
    await toRegister({ inviteCodes: ["MOSS-2049"] });
    await wrapper.find("#regUser").setValue("newbie");
    await wrapper.find("#regPw").setValue("pass-123456");
    await wrapper.find("#regBtn").trigger("click");
    await tick(40);
    expect(wrapper.find("#regErr").text()).toContain("邀请码");
    expect(wrapper.emitted("ok")).toBeFalsy();

    await wrapper.find("#regInvite").setValue("MOSS-2049");
    await wrapper.find("#regBtn").trigger("click");
    await tick(40);
    expect(wrapper.emitted("ok")).toBeTruthy();
  });

  it("一键注册重名，把后端的话原样显示", async () => {
    await toRegister();
    await wrapper.find("#regUser").setValue("tester"); // 假后端里已存在
    await wrapper.find("#regPw").setValue("pass-123456");
    await wrapper.find("#regBtn").trigger("click");
    await tick(40);
    expect(wrapper.find("#regErr").text()).toBe("用户名已被占用");
  });
});
