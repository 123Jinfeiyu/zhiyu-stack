import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorDrawer from "../src/components/EditorDrawer.vue";

// 上传走的是 api 模块 —— 单测里只关心「占位符被换成 Markdown 图片」这件事
vi.mock("../src/api", () => ({
  api: { upload: vi.fn(async () => ({ ok: true, url: "/up/0123456789abcdef.png", size: 99 })) },
  ApiError: class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
}));

async function mounted(props) {
  const w = mount(EditorDrawer, {
    props: Object.assign({ open: true, model: { id: 7, title: "小标题", content: "hello" } }, props),
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const ta = (w) => w.find("#fContent");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditorDrawer 工具栏", () => {
  it("加粗：把选中的文字包上 **", async () => {
    const w = await mounted();
    const t = ta(w);
    t.element.setSelectionRange(0, 5);
    await w.find(".edtool-b").trigger("mousedown");
    expect(t.element.value).toBe("**hello**");
  });

  it("加粗是开关：已包裹的选区再点一次解开", async () => {
    const w = await mounted({ model: { id: 7, title: "t", content: "**hi**" } });
    const t = ta(w);
    t.element.setSelectionRange(2, 4); // 选中 hi
    await w.find(".edtool-b").trigger("mousedown");
    expect(t.element.value).toBe("hi");
  });

  it("列表：行首加 - ，再点一次取消", async () => {
    const w = await mounted({ model: { id: 7, title: "t", content: "买牛奶" } });
    const t = ta(w);
    t.element.setSelectionRange(0, 0);
    await w.find('.edtool[title="列表"]').trigger("mousedown");
    expect(t.element.value).toBe("- 买牛奶");
    t.element.setSelectionRange(0, 0);
    await w.find('.edtool[title="列表"]').trigger("mousedown");
    expect(t.element.value).toBe("买牛奶");
  });
});

describe("EditorDrawer 图片上传", () => {
  it("粘贴图片：占位符被替换成 Markdown 图片语法", async () => {
    const w = await mounted({ model: { id: 7, title: "t", content: "" } });
    const file = new File(["x"], "截图.png", { type: "image/png" });
    await ta(w).trigger("paste", { clipboardData: { files: [file] } });
    await flushPromises();
    expect(ta(w).element.value).toBe("\n![截图](/up/0123456789abcdef.png)\n");
  });

  it("超 5MB 的图不传，并给出提示", async () => {
    const w = await mounted({ model: { id: 7, title: "t", content: "" } });
    const big = new File([new Array(6 * 1024 * 1024).fill("x").join("")], "huge.png", { type: "image/png" });
    await ta(w).trigger("paste", { clipboardData: { files: [big] } });
    await flushPromises();
    expect(ta(w).element.value).toBe("");
    expect(w.find("#uploadErr").text()).toContain("5MB");
  });
});
