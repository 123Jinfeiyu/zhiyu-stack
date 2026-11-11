/* 迷你 Markdown 渲染器（零依赖）
 *
 * 安全约束：**先整体转义，再解析标记**。所有用户文本在进入任何替换规则前
 * 已经过 esc()，所以 <script>、onerror= 这类东西在这层就已经是纯文本了。
 * 链接/图片额外过 safeUrl()，挡掉 javascript: 与 data:text/html。
 */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeUrl(u) {
  const v = String(u || "").trim();
  return /^(https?:\/\/|\/|data:image\/|#)/i.test(v) ? v : null;
}

function inlineMd(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push("<code>" + c + "</code>");
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  // 图片先于链接，否则 ![a](u) 里的 [a](u) 会被链接规则吃掉
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => {
    const ok = safeUrl(u);
    return ok ? '<img src="' + esc(ok) + '" alt="' + alt + '" loading="lazy">' : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, u) => {
    const ok = safeUrl(u);
    return ok
      ? '<a href="' + esc(ok) + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>"
      : txt + "（" + esc(u) + "）";
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

export function renderMd(src) {
  const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + inlineMd(esc(para.join(" "))) + "</p>");
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const n = h[1].length;
      out.push("<h" + n + ">" + inlineMd(esc(h[2])) + "</h" + n + ">");
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push("<blockquote>" + q.map((l) => inlineMd(esc(l))).join("<br>") + "</blockquote>");
      continue;
    }

    if (/^\s*([-*+]|\d+[.、])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.、])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.、])\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push("<" + tag + ">" + items.map((it) => "<li>" + inlineMd(esc(it)) + "</li>").join("") + "</" + tag + ">");
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n") || "<p></p>";
}

/** 纯文本摘要：给卡片用，去掉标记符号 */
export function plain(src, max = 160) {
  const t = String(src || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
