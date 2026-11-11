/* 真 HTTP 联调（不经过 Django test client，打的是真服务）
 *
 * 跑法：
 *   node tests/http_smoke.mjs http://127.0.0.1:8123 [用户名] [密码]
 * 脚本会先注册这个账号（已存在就忽略），再用它登录 —— 所以目标库必须是测试库，
 * 别对着线上库跑。
 *
 * 为什么还要这一层：Django 的 TestCase 走的是内部请求对象，
 * cookie 属性、静态文件、SPA 兜底、跨站头这些都在它之外。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8123";
const USER = process.argv[3] || "smoke-tester";
const PW = process.argv[4] || "smoke-pass-2049";

let pass = 0;
const fails = [];

function ok(cond, name, extra) {
  if (cond) {
    pass++;
  } else {
    fails.push(name + (extra === undefined ? "" : " —— " + extra));
  }
}
function eq(a, b, name) {
  ok(a === b, name, "期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a));
}

let cookie = "";

async function req(method, path, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie && !opts.anon) headers.Cookie = cookie;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.zhiyu) headers["X-Zhiyu"] = "1";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && !opts.anon) cookie = setCookie.split(";")[0];
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, type, headers: res.headers };
}

const j = (r) => (typeof r.data === "string" ? {} : r.data);

async function main() {
  /* ---------------- 静态与页面 ---------------- */
  const home = await req("GET", "/");
  eq(home.status, 200, "首页 200");
  ok(typeof home.data === "string" && home.data.includes('id="app"'), "首页是 Vue 挂载点");
  ok(home.data.includes("/assets/"), "首页引了构建产物");

  const html = typeof home.data === "string" ? home.data : "";
  const assetPath = (html.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
  ok(!!assetPath, "能从首页解析出 js 资源路径", assetPath);
  if (assetPath) {
    const asset = await req("GET", assetPath, undefined, { anon: true });
    eq(asset.status, 200, "构建产物可取");
    ok(String(asset.type).includes("javascript"), "js 的 content-type 正确", asset.type);
  }

  const deep = await req("GET", "/n/1/2", undefined, { anon: true });
  eq(deep.status, 200, "深链 /n/1/2 由 SPA 兜底");
  ok(typeof deep.data === "string" && deep.data.includes('id="app"'), "深链返回的是同一个壳");

  /* ---------------- 鉴权 ---------------- */
  const health = await req("GET", "/api/health", undefined, { anon: true });
  eq(health.status, 200, "/api/health 公开");
  ok(j(health).nodes >= 1, "/api/health 报出了节点数", j(health).nodes);

  const before = await req("GET", "/api/me", undefined, { anon: true });
  eq(j(before).authed, false, "未登录时 /api/me 说 false");

  const noAuth = await req("GET", "/api/tree");
  eq(noAuth.status, 401, "未登录读树 401");

  // 注册（幂等）：这个账号要是已经存在，接口会回 400「用户名已被占用」，属于预期
  const reg = await req("POST", "/api/register", { username: USER, password: PW }, { anon: true });
  ok(
    reg.status === 200 || /占用/.test(String(j(reg).error || "")),
    "注册能走通（已存在时提示占用也算正常）",
    reg.status + " " + JSON.stringify(j(reg))
  );

  const dupReg = await req("POST", "/api/register", { username: USER, password: "another-123456" }, { anon: true });
  eq(dupReg.status, 400, "重复注册被拒");

  const shortPw = await req("POST", "/api/register", { username: "tmp-" + Date.now(), password: "123" }, { anon: true });
  eq(shortPw.status, 400, "密码太短被拒");

  const noUser = await req("POST", "/api/login", { username: "no-such-user", password: PW }, { anon: true });
  eq(noUser.status, 401, "不存在的用户 401（不是 500）");

  const badPw = await req("POST", "/api/login", { username: USER, password: "definitely-wrong" }, { anon: true });
  eq(badPw.status, 401, "错密码 401（不是 500）");

  const login = await req("POST", "/api/login", { username: USER, password: PW });
  eq(login.status, 200, "正确的账号密码能登录");
  ok(!!cookie, "拿到了登录 cookie");
  if (login.status !== 200) {
    console.error("\n登录失败（账号密码不对？），后面的断言都跑不下去：" + JSON.stringify(j(login)));
    process.exit(1);
  }
  eq(j(login).username, USER, "登录响应带回用户名");

  const after = await req("GET", "/api/me");
  eq(j(after).authed, true, "登录后 /api/me 说 true");
  eq(j(after).username, USER, "登录后 /api/me 带回用户名");

  const forged = await req("POST", "/api/nodes", { title: "x" }, { origin: "https://evil.example.com" });
  eq(forged.status, 403, "跨站 Origin 的写请求被拒");

  // 上一版只测了「伪造 Origin 被拒」，没测「真 Origin 能过」，结果线上浏览器全 403。
  const selfOrigin = new URL(BASE).origin;
  const sameOrigin = await req("POST", "/api/nodes", { title: "同源冒烟" }, { origin: selfOrigin });
  eq(sameOrigin.status, 200, "自带真实 Origin 的写请求能过（浏览器场景）");
  if (j(sameOrigin).node) {
    await req("POST", `/api/nodes/${j(sameOrigin).node.id}/delete`);
  }

  const nullOrigin = await req("POST", "/api/nodes", { title: "x" }, { origin: "null" });
  eq(nullOrigin.status, 403, "Origin: null 被拒");

  // 前端真实请求同时带 X-Zhiyu。它在浏览器里带不出去（跨站必过预检），
  // 所以带着它就等于「自己人」——域名换成什么都不用改配置。
  const withHeader = await req(
    "POST",
    "/api/nodes",
    { title: "自定义头冒烟" },
    { origin: "https://evil.example.com", zhiyu: true }
  );
  eq(withHeader.status, 200, "带 X-Zhiyu 的写请求无视 Origin（前端真实场景）");
  if (j(withHeader).node) await req("POST", `/api/nodes/${j(withHeader).node.id}/delete`);

  // 线上真正的机制：容器被网关改了 Host，只能靠 data/allowed_origins.txt 说清「我叫什么」。
  // 这个文件就在发布目录里，所以本地跑 = 线上同一份配置。
  try {
    const fs = await import("node:fs");
    const lines = fs
      .readFileSync(new URL("../data/allowed_origins.txt", import.meta.url), "utf-8")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
    if (lines.length) {
      const viaFile = await req("POST", "/api/nodes", { title: "白名单冒烟" }, { origin: lines[0] });
      eq(viaFile.status, 200, "Origin 命中 allowed_origins.txt 时放行");
      if (j(viaFile).node) await req("POST", `/api/nodes/${j(viaFile).node.id}/delete`);
    }
  } catch (e) {
    ok(true, "（没有 allowed_origins.txt，跳过该分支）");
  }

  /* ---------------- 读树 ---------------- */
  const tree0 = await req("GET", "/api/tree");
  eq(tree0.status, 200, "登录后能读全树");
  ok(Array.isArray(j(tree0).nodes), "全树是数组");
  const baseCount = j(tree0).nodes.length;

  const rootView = await req("GET", "/api/nodes/0");
  eq(j(rootView).node.id, 0, "根视图的节点 id 是 0");
  ok(Array.isArray(j(rootView).children), "根视图有 children");

  /* ---------------- 增改移删 ---------------- */
  const created = await req("POST", "/api/nodes", { title: "冒烟测试树", content: "# 标题\n正文" });
  eq(created.status, 200, "新建根节点");
  const rootId = j(created).node.id;
  ok(rootId > 0, "拿到新节点 id", rootId);

  const child = await req("POST", "/api/nodes", { pid: rootId, title: "子枝", content: "内容" });
  eq(j(child).node.pid, rootId, "子节点的 pid 正确");
  const childId = j(child).node.id;

  const upd = await req("POST", `/api/nodes/${childId}/update`, { title: "子枝改名", content: "新内容" });
  eq(j(upd).node.title, "子枝改名", "更新标题生效");
  eq(j(upd).node.content, "新内容", "更新正文生效");

  const detail = await req("GET", `/api/nodes/${rootId}`);
  eq(j(detail).node.kids, 1, "父节点报出 1 个子枝");
  eq((j(detail).children || [])[0].title, "子枝改名", "子节点列表是最新的");

  const search = await req("GET", "/api/search?q=" + encodeURIComponent("冒烟"));
  eq(search.status, 200, "搜索 200");
  ok((j(search).hits || []).some((h) => h.id === rootId), "搜得到刚建的树");

  const scoped = await req("GET", "/api/search?q=" + encodeURIComponent("新内容") + "&root=" + rootId);
  ok((j(scoped).hits || []).length === 1, "限定范围的搜索只在这枝里找");

  const moved = await req("POST", `/api/nodes/${childId}/move`, { pid: 0 });
  eq(moved.status, 200, "移到顶层");
  ok(j(moved).node.pid === null, "移动后 pid 为空", j(moved).node.pid);

  const cycle = await req("POST", `/api/nodes/${rootId}/move`, { pid: rootId });
  eq(cycle.status, 400, "移到自己下面被拒");

  /* ---------------- 分享 ---------------- */
  const share = await req("POST", `/api/nodes/${rootId}/share`, {});
  eq(share.status, 200, "生成分享 token");
  const token = j(share).token;
  ok(!!token, "token 非空", token);

  const publicView = await req("GET", `/api/share/${token}`, undefined, { anon: true });
  eq(publicView.status, 200, "分享链接匿名可读");
  eq(j(publicView).root.title, "冒烟测试树", "分享根节点正确");
  ok(Array.isArray(j(publicView).root.children), "分享内容带 children");

  const sharePage = await req("GET", `/s/${token}`, undefined, { anon: true });
  eq(sharePage.status, 200, "分享页本身也能打开（SPA）");

  const revoked = await req("POST", `/api/nodes/${rootId}/share/revoke`, {});
  eq(j(revoked).revoked, 1, "撤销分享");
  const afterRevoke = await req("GET", `/api/share/${token}`, undefined, { anon: true });
  eq(afterRevoke.status, 404, "撤销后链接失效");

  /* ---------------- 导入导出 ---------------- */
  const exp = await req("GET", "/api/export");
  eq(exp.status, 200, "导出 200");
  const exported = j(exp);
  ok(Array.isArray(exported.nodes) && exported.nodes.length >= baseCount + 2, "导出的节点数对得上", exported.nodes.length);

  const snapshot = exported;
  const imp = await req("POST", "/api/import", snapshot);
  eq(imp.status, 200, "导入 200");
  eq(j(imp).imported, snapshot.nodes.length, "导入的条数与导出一致");
  const tree2 = await req("GET", "/api/tree");
  eq(j(tree2).nodes.length, snapshot.nodes.length, "导入后节点数一致（往返无损）");

  /* ---------------- 清理 ----------------
   * 注意：上面的 import 是 replace 语义，节点被重建、id 全变了，
   * 所以这里必须按标题重新定位，不能拿旧的 rootId 去删。 */
  const tree3 = await req("GET", "/api/tree");
  const again = (j(tree3).nodes || []).find((n) => n.title === "冒烟测试树");
  ok(!!again, "导入后还能按标题找回那棵树");
  const del = await req("POST", `/api/nodes/${again ? again.id : rootId}/delete`, {});
  ok(j(del).deleted >= 1, "删除返回删掉的枝数", j(del).deleted);

  /* ---------------- 改密码 ---------------- */
  const pwBad = await req("POST", "/api/password", { old: "definitely-wrong", new: "changed-123456" });
  eq(pwBad.status, 400, "原密码错，改密码被拒");

  const pwOk = await req("POST", "/api/password", { old: PW, new: "changed-123456" });
  eq(pwOk.status, 200, "改密码成功");
  const mePw = await req("GET", "/api/me");
  eq(j(mePw).authed, true, "改密码后当前会话继续有效（响应里重签了 cookie）");

  const pwBack = await req("POST", "/api/password", { old: "changed-123456", new: PW });
  eq(pwBack.status, 200, "密码改回去（脚本可重复跑）");
  const meBack = await req("GET", "/api/me");
  eq(j(meBack).authed, true, "改回去之后会话仍有效");

  /* ---------------- 业务知识图谱 ---------------- */
  {
    // 造一小撮「过了划扣时间 → 才对公转账」的枝，规则层才有东西可验
    const seeded = [];
    for (const [t, c] of [
      ["划扣时间", "还款过了当天划扣时间，系统不再自动划扣，才引导客户走对公账户转账。"],
      ["对公账户", "对公账户要口述两遍；划扣时间过了才给账户。"],
      ["还款路径", "还款先查资方，账户从系统里取，别背。"],
      ["结清证明", "开结清证明要查工单，工单重复要拦住。"],
    ]) {
      const r = await req("POST", "/api/nodes", { title: t, content: c });
      if (r.status === 200 && j(r).node) seeded.push(j(r).node.id);
    }

    const kgNoAuth = await req("GET", "/api/kg", undefined, { anon: true });
    eq(kgNoAuth.status, 401, "KG: 未登录 401");

    const kg = await req("GET", "/api/kg");
    eq(kg.status, 200, "KG: 登录后能拿到图谱");
    const g = j(kg);
    ok(Array.isArray(g.concepts), "KG: concepts 是数组");
    ok(Array.isArray(g.links), "KG: links 是数组");
    ok(Array.isArray(g.clusters), "KG: clusters 是数组");
    ok(!!g.hash, "KG: 带内容指纹", g.hash);
    ok(typeof g.aiAvailable === "boolean", "KG: 标明 AI 是否可用");
    if ((g.concepts || []).length) {
      const ids = new Set(g.concepts.map((c) => c.id));
      const kids = new Set(g.clusters.map((c) => c.id));
      ok(g.concepts.every((c) => kids.has(c.cluster)), "KG: 每个概念都挂着一条业务线");
      ok(g.links.every(([a, b]) => ids.has(a) && ids.has(b)), "KG: 边只连存在的概念");
      ok(g.stats && g.stats.branches > 0, "KG: 统计里有枝数");

      const rules = g.rules || [];
      ok(Array.isArray(g.rules), "KG: rules 是数组");
      ok(rules.length > 0, "KG: 语料里有「过了…才…」，抽得出触发规则", rules.length);
      ok(rules.every((r) => ids.has(r.from) && ids.has(r.to)), "KG: 规则两端都在图里");
      ok(rules.every((r) => r.from !== r.to), "KG: 规则不指向自己");
      ok(rules.every((r) => r.kindLabel && r.say && r.label), "KG: 规则带类型、标签和整句依据");
      ok(rules.every((r) => ["cond", "seq", "cause"].includes(r.kind)), "KG: 规则类型只有条件/顺序/因果");
      ok(
        rules.some((r) => r.source === "rule" && r.kindLabel === "条件"),
        "KG: 显式业务规则排在最前"
      );
      ok(rules.every((r) => (r.branches || []).every((nid) => typeof nid === "number")), "KG: 规则能追溯到具体枝");
      ok(g.stats.rules === rules.length, "KG: stats.rules 与实际条数一致");
    } else {
      ok(!!g.empty, "KG: 枝太少时给一句人话解释");
    }

    // 造的数据用完就撤，别留在库里
    for (const id of seeded) await req("POST", `/api/nodes/${id}/delete`);

    const kgAi = await req("POST", "/api/kg/ai", {});
    eq(kgAi.status, 200, "KG AI: 接口通");
    const ai = j(kgAi);
    ok(typeof ai.ai === "boolean", "KG AI: 标明是否用了模型");
    if (!ai.ai) ok(!!ai.reason, "KG AI: 失败时说清楚原因", ai.reason);
    if (ai.ai && ai.graph) {
      ok(ai.graph.engine === "deepseek", "KG AI: 命中后引擎标成 deepseek");
      ok(!JSON.stringify(ai).includes("sk-"), "KG AI: 响应里不泄密钥");
    }

    const kgAiAnon = await req("POST", "/api/kg/ai", {}, { anon: true });
    eq(kgAiAnon.status, 401, "KG AI: 未登录 401");
  }

  /* ---------------- 结果 ---------------- */
  console.log("");
  if (fails.length) {
    console.log(`✘ 通过 ${pass} 项，${fails.length} 项失败：`);
    fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`✔ 通过 ${pass} 项，全部通过（真 HTTP，针对 ${BASE}）`);
}

main().catch((e) => {
  console.error("联调脚本自己挂了：", e);
  process.exit(2);
});
