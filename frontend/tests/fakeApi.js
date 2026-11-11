/* 内存假后端 —— 让组件测试跑真逻辑，而不是断言 mock 的调用次数。
 *
 * 行为对齐 notes/views.py：同一个 URL 形状、同一套 ok/error 约定。
 * 这样组件里任何"以为接口是这样"的错误都会在这里暴露。
 */
const TS = 1760000000;

export function createBackend(seed = [], opts = {}) {
  const password = opts.password || "pw";
  const username = opts.username || "tester";
  const inviteCodes = opts.inviteCodes || [];
  const users = new Map([[username, password]]);
  let me = username;
  let seq = Math.max(0, ...seed.map((n) => n.id)) + 1;
  const nodes = seed.map((n) => ({
    id: n.id,
    pid: n.pid || 0,
    title: n.title,
    content: n.content || "",
    updated: TS,
  }));
  const shares = new Map();
  const calls = [];
  let loggedIn = opts.loggedIn !== false;

  const kidsOf = (pid) => nodes.filter((n) => (n.pid || 0) === (pid || 0));
  const brief = (n) => ({ id: n.id, pid: n.pid || null, title: n.title, kids: kidsOf(n.id).length, updated: n.updated });
  const full = (n) => ({ ...brief(n), content: n.content });
  const find = (id) => nodes.find((n) => n.id === Number(id));

  function ancestors(n) {
    const out = [];
    let cur = find(n.pid);
    let guard = 0;
    while (cur && guard++ < 100) {
      out.unshift(cur);
      cur = find(cur.pid);
    }
    return out;
  }
  function subtree(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) kidsOf(out[i]).forEach((k) => out.push(k.id));
    return out;
  }

  function json(data, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => "application/json" },
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  async function handle(method, url, body) {
    const u = new URL(url, "http://localhost");
    const path = u.pathname;
    let m;

    if (path === "/api/me")
      return json({
        ok: true,
        authed: loggedIn,
        username: loggedIn ? me : "",
        nodes: nodes.length,
        inviteRequired: inviteCodes.length > 0,
      });

    if (path === "/api/register" && method === "POST") {
      const u = String((body && body.username) || "").trim();
      const p = String((body && body.password) || "");
      const inv = String((body && body.invite) || "").trim();
      if (u.length < 2) return json({ ok: false, error: "用户名至少 2 个字" }, 400);
      if (p.length < 6) return json({ ok: false, error: "密码至少 6 位" }, 400);
      if (inviteCodes.length && !inviteCodes.includes(inv))
        return json({ ok: false, error: "邀请码无效，请向站长索取" }, 400);
      if (users.has(u)) return json({ ok: false, error: "用户名已被占用" }, 400);
      users.set(u, p);
      loggedIn = true;
      me = u;
      return json({ ok: true, username: u, claimed: 0 });
    }

    if (path === "/api/login") {
      const u = String((body && body.username) || "");
      if (users.has(u) && users.get(u) === body.password) {
        loggedIn = true;
        me = u;
        return json({ ok: true, username: u });
      }
      return json({ ok: false, error: "用户名或密码不对" }, 401);
    }
    if (path === "/api/password" && method === "POST") {
      if (!loggedIn) return json({ ok: false, error: "not logged in" }, 401);
      const oldPw = String((body && body.old) || "");
      const newPw = String((body && body.new) || "");
      if (users.get(me) !== oldPw) return json({ ok: false, error: "原密码不对" }, 400);
      if (newPw.length < 6) return json({ ok: false, error: "密码至少 6 位" }, 400);
      if (newPw === oldPw) return json({ ok: false, error: "新密码不能和原密码一样" }, 400);
      users.set(me, newPw);
      return json({ ok: true });
    }

    if (path === "/api/logout") {
      loggedIn = false;
      return json({ ok: true });
    }

    // 分享读取是公开的（真实后端里 @api(auth_required=False)），必须在登录闸门之前
    if ((m = /^\/api\/share\/([A-Za-z0-9_-]+)$/.exec(path))) {
      const id = shares.get(m[1]);
      if (id === undefined) return json({ ok: false, error: "分享链接无效或已撤销" }, 404);
      const build = (n) => ({ ...full(n), children: kidsOf(n.id).map(build) });
      return json({ ok: true, root: build(find(id)), crumbs: [] });
    }

    if (!loggedIn) return json({ ok: false, error: "未登录" }, 401);

    if (path === "/api/tree") return json({ ok: true, nodes: nodes.map(brief) });

    if (path === "/api/search") {
      const q = (u.searchParams.get("q") || "").trim();
      const root = Number(u.searchParams.get("root") || 0);
      const scope = root ? new Set(subtree(root)) : null;
      const hits = nodes
        .filter((n) => (!scope || scope.has(n.id)) && (n.title.includes(q) || n.content.includes(q)))
        .map((n) => ({ ...brief(n), snippet: n.content.slice(0, 60) }));
      return json({ ok: true, q, hits });
    }

    if ((m = /^\/api\/nodes\/(\d+)$/.exec(path))) {
      const id = Number(m[1]);
      if (id === 0) {
        return json({
          ok: true,
          node: { id: 0, pid: null, title: "全部笔记", content: "", kids: kidsOf(0).length, updated: 0 },
          children: kidsOf(0).map(full),
          crumbs: [],
        });
      }
      const n = find(id);
      if (!n) return json({ ok: false, error: "节点不存在" }, 404);
      return json({ ok: true, node: full(n), children: kidsOf(id).map(full), crumbs: ancestors(n).map(brief) });
    }

    if (path === "/api/nodes" && method === "POST") {
      const n = {
        id: seq++,
        pid: Number((body && body.pid) || 0),
        title: (body && body.title) || "未命名",
        content: (body && body.content) || "",
        updated: TS,
      };
      nodes.push(n);
      return json({ ok: true, node: full(n) });
    }

    if ((m = /^\/api\/nodes\/(\d+)\/update$/.exec(path))) {
      const n = find(m[1]);
      if (!n) return json({ ok: false, error: "节点不存在" }, 404);
      if (body.title !== undefined) n.title = body.title;
      if (body.content !== undefined) n.content = body.content;
      return json({ ok: true, node: full(n) });
    }

    if ((m = /^\/api\/nodes\/(\d+)\/move$/.exec(path))) {
      const n = find(m[1]);
      const pid = Number(body.pid || 0);
      if (pid && subtree(n.id).includes(pid)) return json({ ok: false, error: "不能移到自己的子孙下面" }, 400);
      n.pid = pid;
      return json({ ok: true, node: brief(n) });
    }

    if ((m = /^\/api\/nodes\/(\d+)\/delete$/.exec(path))) {
      const ids = subtree(Number(m[1]));
      for (const id of ids.reverse()) {
        const i = nodes.findIndex((n) => n.id === id);
        if (i >= 0) nodes.splice(i, 1);
      }
      return json({ ok: true, deleted: ids.length });
    }

    if ((m = /^\/api\/nodes\/(\d+)\/share$/.exec(path))) {
      const id = Number(m[1]);
      const token = "tok" + id;
      shares.set(token, id);
      return json({ ok: true, token, title: find(id).title });
    }

    if ((m = /^\/api\/nodes\/(\d+)\/share\/revoke$/.exec(path))) {
      let n = 0;
      for (const [k, v] of shares) {
        if (v === Number(m[1])) {
          shares.delete(k);
          n++;
        }
      }
      return json({ ok: true, revoked: n });
    }

    if ((m = /^\/api\/share\/([A-Za-z0-9_-]+)$/.exec(path))) {
      const id = shares.get(m[1]);
      if (id === undefined) return json({ ok: false, error: "分享链接无效或已撤销" }, 404);
      const build = (n) => ({ ...full(n), children: kidsOf(n.id).map(build) });
      return json({ ok: true, root: build(find(id)), crumbs: [] });
    }

    return json({ ok: false, error: "假后端没实现 " + method + " " + path }, 404);
  }

  const fetchMock = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    let body;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch (e) {
        body = null;
      }
    }
    calls.push({ method, url: String(url), body });
    return handle(method, String(url), body);
  };

  return {
    fetch: fetchMock,
    nodes,
    shares,
    calls,
    get loggedIn() {
      return loggedIn;
    },
    get currentUser() {
      return me;
    },
    /** 测试专用：偷看某人当前的密码（明文，只对内存假库）。 */
    passwordOf(u) {
      return users.get(u);
    },
    find,
  };
}

export const SEED = [
  { id: 1, pid: 0, title: "枝语 · 使用说明", content: "点卡片钻进去。" },
  { id: 2, pid: 1, title: "怎么钻取", content: "点标题。" },
  { id: 3, pid: 2, title: "为什么不是文件夹", content: "文件夹只有一层。" },
  { id: 4, pid: 1, title: "快捷键", content: "按 n 新建。" },
  { id: 5, pid: 0, title: "这周要做的事", content: "写在半路也行。" },
  { id: 6, pid: 5, title: "刷完科目一", content: "背数字族谱。" },
];
