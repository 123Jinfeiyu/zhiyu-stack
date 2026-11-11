import { describe, expect, it } from "vitest";
import { plain, renderMd, safeUrl } from "../src/md";

describe("Markdown 渲染", () => {
  it("标题、粗体、列表", () => {
    const html = renderMd("# 标题\n\n**粗** 和 *斜*\n\n- 一\n- 二");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<b>粗</b>");
    expect(html).toContain("<i>斜</i>");
    expect(html).toContain("<li>一</li>");
  });

  it("有序列表", () => {
    expect(renderMd("1. 甲\n2. 乙")).toContain("<ol>");
  });

  it("代码块原样保留、不做标记解析", () => {
    const html = renderMd("```\n**不该变粗**\n```");
    expect(html).toContain("<pre><code>**不该变粗**</code></pre>");
  });

  it("引用", () => {
    expect(renderMd("> 引用")).toContain("<blockquote>引用</blockquote>");
  });

  it("行内代码里的星号不生效", () => {
    const html = renderMd("`a*b*c`");
    expect(html).toContain("<code>a*b*c</code>");
    expect(html).not.toContain("<i>");
  });
});

describe("XSS 防线", () => {
  it("script 标签被转义成文本", () => {
    const html = renderMd('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("img 的 onerror 被转义", () => {
    const html = renderMd('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("javascript: 链接不会被渲染成 a 标签", () => {
    const html = renderMd("[点我](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("点我");
  });

  it("data:text/html 图片被拒", () => {
    expect(safeUrl("data:text/html;base64,xxx")).toBeNull();
    expect(safeUrl("data:image/png;base64,xxx")).toBe("data:image/png;base64,xxx");
    expect(safeUrl("https://a.com/x.png")).toBe("https://a.com/x.png");
    expect(safeUrl("/rel.png")).toBe("/rel.png");
    expect(safeUrl("vbscript:x")).toBeNull();
  });

  it("正常链接保留 target 与 rel", () => {
    const html = renderMd("[站点](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("摘要", () => {
  it("去掉标记符号并截断", () => {
    const t = plain("# 标题\n\n- 一\n- 二", 100);
    expect(t).not.toContain("#");
    expect(t).toContain("标题");
    expect(plain("字".repeat(200), 20).length).toBe(21); // 20 + 省略号
  });

  it("代码块不进入摘要", () => {
    expect(plain("前\n```\nsecret\n```\n后")).not.toContain("secret");
  });
});
