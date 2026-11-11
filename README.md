# 枝语 · 全栈版（Django 5.2 + Vue 3）

把原来那个单文件（`../zhiyu/`）重做成了前后端分离：**Django 存树、Vue 3 渲染**。
单文件版的交互全部保留，另外多了单文件做不到的三件事：

| | 单文件版 | 全栈版 |
|---|---|---|
| 数据在哪 | 浏览器 localStorage | 服务器 SQLite |
| 换设备 | 看不到 | 登录就看到 |
| 分享 | 导出 JSON 发给别人 | 一根枝生成只读链接 |
| 刷新/深链 | hash 路由 | 真 URL（`/n/3/7`），可直接收藏 |

---

## 跑起来

```bash
# 1) 装前端依赖并构建（只需在改前端后重跑）
cd frontend && npm install && npm run build

# 2) 本地起服务
cd .. && python serve_dev.py
# 默认 http://127.0.0.1:8000 ，端口用 PORT 环境变量改

# 服务器上（发布时）用的是另一个入口
python serve.py
```

两个入口的区别只有数据目录：`serve_dev.py` 把 `ZY_DATA_DIR` 指到 `.localdata/`，
`serve.py` 用默认的 `data/`。**这是故意的** —— 发布是整目录上传，
如果本地库放在 `data/` 里，就会被传上去覆盖服务器上真正的笔记。

**账号**：没有内置账号，也没有口令文件 —— 打开页面点「注册」自己建一个，注册完直接进去。
注册校验：用户名 2–20 个字（中文/字母/数字/下划线/点/横线），密码至少 6 位，
密码用 Django 的 PBKDF2 只存哈希。

**邀请码是选填的**，由部署者决定要不要收紧：在 `data/invite_codes.txt` 里一行写一个码
（`#` 开头是注释）。这个文件**不存在或为空 → 开放注册**；一旦有内容 → 注册必须填其中一个，
否则报「邀请码无效」。所以「先开放给大家用」和「只给自己人」是同一个开关。

**第一个注册的人会接手旧数据**：单口令时代留下的枝 `owner` 是空的，
第一个注册的账号自动认领它们（接口返回 `claimed: N`）。之后注册的人都从空树林开始，
互相看不到、改不到对方的枝。

> 依赖是**内置**的：Django 5.2 LTS + asgiref + sqlparse + tzdata 全在 `vendor/pylib/`，
> `manage.py` / `serve.py` / `wsgi.py` 开头把该目录塞进 `sys.path`。
> 所以服务器上**不需要 pip install，也不需要联网**。

---

## 目录

```
zhiyu-stack/
├─ manage.py            Django 入口（内置 vendor 注入 + runserver 前自动迁移）
├─ serve.py             发布入口：迁移 → 播种 → runserver 0.0.0.0:$PORT
├─ server/
│  ├─ settings.py       极简配置：无 session/auth/admin/csrf 中间件
│  ├─ auth.py           用户校验 + HMAC 签名 cookie（密码哈希掺进签名 → 改密码即旧 cookie 失效）
│  └─ urls.py           全部接口 + /assets/ 静态 + SPA 兜底
├─ notes/
│  ├─ models.py         User（PBKDF2 密码）、Node（owner + parent 自关联，CASCADE）、Share（token）
│  ├─ views.py          手写 JSON API，不引 DRF
│  ├─ tests.py          76 项后端测试
│  └─ management/commands/seed.py   首次启动播种三棵树
├─ frontend/
│  ├─ src/App.vue       登录门 / 树 / 分享 / 确认框
│  ├─ src/components/   TreeView / NodeCard / EditorDrawer / MiniMap / ShareView / LoginView
│  ├─ src/md.js         迷你 Markdown（先转义再解析，挡 XSS）
│  ├─ src/router.js     / 、/n/1/2 、/s/<token> 三种形态
│  └─ tests/            61 项组件测试（vitest + 内存假后端）
├─ tests/http_smoke.mjs 49 项真 HTTP 联调（打真服务，不经过 Django test client）
├─ vendor/pylib/        内置的 Django 及相关依赖
└─ data/                运行时（db.sqlite3 / secret.txt / 可选的 invite_codes.txt）
```

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 公开，返回节点数 |
| GET | `/api/me` | 公开，返回是否已登录、用户名、`inviteRequired` |
| POST | `/api/register` | `{username,password,invite?}` → 建号并直接登录 |
| POST | `/api/login` · `/api/logout` | 账号密码换 cookie / 清 cookie |
| POST | `/api/password` | `{old,new}` 改密码（验原密码，响应重签 cookie；其他设备的旧 cookie 全失效） |
| GET | `/api/tree` | 全森林扁平清单（小地图与搜索用） |
| GET | `/api/nodes/0` | 根视图：所有顶层树 |
| GET | `/api/nodes/<id>` | 单个节点 + 子节点 + 祖先链（一次请求画完整屏） |
| POST | `/api/nodes` | 新建 `{pid,title,content}`，pid=0 为顶层 |
| POST | `/api/nodes/<id>/update` | 改标题/正文 |
| POST | `/api/nodes/<id>/move` | 移动，会拒绝移进自己的子孙 |
| POST | `/api/nodes/<id>/delete` | 连根删除，返回删除条数 |
| POST | `/api/nodes/<id>/share` | 生成只读 token（幂等） |
| POST | `/api/nodes/<id>/share/revoke` | 撤销 |
| GET | `/api/share/<token>` | **公开**，返回嵌套子树 |
| GET | `/api/export` · POST `/api/import` | 备份 / 恢复（replace 语义） |
| GET | `/api/kg` | 业务知识图谱（本地算法：概念 / 共现 / 业务线，几百毫秒） |
| POST | `/api/kg/ai` | 让 DeepSeek 给业务线起人话名字；失败软降级，按内容指纹缓存 |

鉴权：`zhiyu_auth` cookie，httpOnly + SameSite=Lax + HMAC 签名 + 7 天有效期。
写请求额外校验 `Origin` 与 `Host` 同源。

---

## 业务知识图谱（AI）

顶栏 ◎ 打开。三层，每层都说得出理由：

1. **概念** —— 从标题+正文里长出来的中文词（2~4 字 n-gram，df≥阈值，虚词边界过滤 + 子串抑制 + 量词首字过滤）；
2. **关系** —— 两个概念同时出现在多少枝里（共现），可解释：点开概念就能列出「它落在哪些枝」；
3. **业务线** —— 概念图上的层次聚类（average linkage + Jaccard，确定性、无随机数），
   每簇用权重最高的一两个概念先占个名；
4. **触发规则（有向）** —— 共现只说明「老一起出现」，说不出「什么条件下才做」。
   这一层专门抽方向：图上画成带箭头的弧线，侧栏给出整句依据和「为什么」。
   来源只有两种，都不靠猜：
   - **显式规则** `RULES`（`notes/kg.py` 顶部）：业务方确认过的口径，写死在代码里。
     例：`划扣 → 对公账户`（还款过了当天划扣时间、系统不再自动划扣，才能引导线下对公转账；
     没过就给账户 = 客户转一次、系统再扣一次 = 重复扣款）；
   - **文本句式**：`过了…才…` / `只有…才…` / `如果…就…` / `…之后才…` / `先…再…` / `因为…所以…`，
     两端都得能对上图里的概念，对不上就不编；整句出处已被显式规则覆盖的不再重复画。
   规则两端的概念词频再低也会被补进图（`ensure_rule_terms`），否则线画不出来。

DeepSeek 只做锦上添花：给业务线起人话名字、写一句概括和三个要点、给一句整体洞察。
**它不参与构图** —— 模型挂了/没网/没配额，图谱照样能看，只是名字朴素一点。
前端两段式：`/api/kg` 先出图，`/api/kg/ai` 后改名，AI 慢也不挡着看。

模型配置（可选）：`data/llm.json`（或环境变量 `ZY_LLM_KEY`）：

```json
{ "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat", "timeout": 25 }
```

- 密钥**只在服务端**：所有接口的响应都不会带出 key（有测试锁着）。
- 只允许 https 公网 baseUrl：带密钥的请求头不能流向内网地址。
- AI 结果按「枝的标题+正文指纹」缓存在 `data/kg_ai_cache.json`，枝没变就不再花 token；
  「重新梳理」按钮会 force 重算。

## 整片树林：直接在族谱上改

树的形状是一棵**倒过来长的真树**（参考 qsont.me 首页那棵）：根在最下面的地面上，
子枝一辈一辈往上抽，枝条是弯曲的贝塞尔弧、越往末梢越细，分叉处有小圆点，
每棵树的根都扎在一小片地光上。布局仍是「叶子排座次，父辈坐中间」的倒立非满二叉树，
只是纵轴翻了向。


顶栏那棵小树打开的不只是一张图，是一份**可以改的族谱**：

| 键 / 动作 | 作用 |
|---|---|
| 单击 | 选中这一枝（面板不关，底部操作条变成它的「把手」） |
| 双击 / Enter | 钻进这一枝 |
| ↑ ↓ | 在同一片树林里换选中，视野跟着走 |
| **Del / Backspace** | **删掉这一枝（连根）**：第一次只把整枝标红、操作条上写「再按一次 Del」，4 秒内再按才真删；Esc 或点「算了」撤销 |
| F2 | 打开抽屉改标题与正文 |
| Ins / n | 在**选中**那枝下面长新枝 |

几个实现上的决定：

- **面板自己不碰网络**：所有写操作都 `emit` 给 `TreeView`，由它调接口、刷新 `allNodes`，
  族谱图跟着响应式重排。这样「删掉当前所在的枝要退回上一层」「保存后刷新」只有一处实现。
- **两步删除而不是确认框**：族谱占了整屏，再叠一个模态框会挡住树，看不见自己删的是哪一枝。
  「原地标红 + 再按一次」既看得见目标，也少一次点击。
- **F2 必须先拉全文**：`/api/tree` 的节点只带标题（省流量），直接塞进抽屉会把正文覆盖成空。
- **抽屉从族谱里打开时先把族谱收起**，关掉抽屉再还原：两层 `position: fixed` 面板叠在一起，
  遮罩层级和点击穿透都很难调，不如让它俩轮流上场。
- **族谱开着时 `TreeView` 的键盘处理器直接 return**，否则按 `n` 会被两边同时接住 ——
  新建会开到「当前钻进去的位置」，而不是族谱里选中的那一枝。

---

## 测试

```bash
# 后端（53 项）
python manage.py test notes

# 前端（61 项，需要先 npm install）
cd frontend && npx vitest run

# 真 HTTP 联调（53 项，需要先起服务）
node tests/http_smoke.mjs http://127.0.0.1:8123 zhiyu-2049
```

三层是刻意分开的：

- **Django TestCase** 走内部请求对象，验的是模型与视图逻辑；
- **vitest** 用内存假后端驱动真实组件，验的是「组件以为接口长什么样」；
- **http_smoke.mjs** 打真服务，验的是 cookie 属性、静态文件、SPA 兜底、跨站头这些
  前两者都碰不到的东西。它跑在临时数据目录上，不会污染 `data/`。

---

## 安全模型（写操作为什么不随便放行）

三道，从弱到强：

0. **cookie 是 `SameSite=Lax` + `httpOnly`**：跨站的 POST 根本不会带上登录态。
1. **自定义请求头 `X-Zhiyu: 1`**：前端每个请求都带。浏览器里跨站页面要带自定义头，
   必然先发 CORS 预检，而本服务一个 CORS 头都不回 → 预检就挂了，伪造请求发不出去。
   同源请求不触发预检，所以对正常使用零成本。**这道不依赖域名**，换链接也不会误伤。
2. **Origin 与「自己」比对**：没带自定义头时（curl、脚本）才走这里。

第 2 道必须知道「自己叫什么」，而线上在网关后面，容器收到的 `Host` 是被改写过的
内网地址 —— 直接比对必然失败，表现就是**所有写操作 403「跨站请求被拒绝」**。
所以对外地址写在 `data/allowed_origins.txt`（一行一个，随项目一起上传；本地用
`ZY_DATA_DIR` 换了数据目录时会回落到 `BASE_DIR/data/` 这份）。它和请求头里的
`Host` / `X-Forwarded-Host` / `X-Forwarded-Server` 一起构成「我是谁」的候选集合。

换域名 / 发布到新链接时：往这个文件加一行即可，或者干脆什么都不做（前端带自定义头，
走的是第 1 道）。

---

## 踩过的坑

1. **`hmac.compare_digest` 只吃 ASCII**。密码/邀请码允许中文时，直接比较 `str` 会抛 TypeError，
   于是「输错密码」变成 500 而不是 401。必须比 `bytes`。
   单测里原本把口令换成了 ASCII，正好绕过这个坑 —— 后来补了中文密码用例才抓住。
2. **多用户之后，所有查询都得带 `owner`**。漏一处就是「别人的枝能被我改」这种数据事故，
   而且不会报错、只在慢慢看的时候才发现。`tests.py` 的 `IsolationTests` 专门盯这件事：
   读、改、删、移、搜、导出、导入替换、分享列表、整树清单，九个口子逐个试。
2. **`data/` 不能跟着发布目录一起乱动**。db 只在服务器上长，本机那份是种子，
   覆盖线上等于回滚用户数据。发布前先想清楚哪份是真身。
3. **SPA 兜底要排在 `/api/` 之后**，否则 `/api/anything` 会被当成前端路由返回 index.html
   （前端拿到 HTML 去 `res.json()`，报的错会非常误导）。
4. **`import` 是 replace 语义**：节点会重建、id 全变。任何「导入后再按旧 id 操作」的脚本
   都会 404 —— 联调脚本里就踩过一次，改成按标题重新定位。
5. **只测了「伪造 Origin 被拒」，没测「真 Origin 能过」**：线上网关改写 `Host`，浏览器
   发的是真域名，于是所有写操作 403。curl 默认不带 `Origin`，所以怎么测都是好的。
   **凡是校验来源的逻辑，必须用「浏览器真实会发的头」也测一遍。**
6. **`token_urlsafe(9)` 再剔掉 `-`/`_` 会变长度**：约三分之一概率只剩 10~11 位，
   于是 `len(token) == 12` 的断言时好时坏（跑五遍才看出一遍红）。分享码改成定长字母表生成。

---

## 发布

这个目录是独立的发布单元：

```
directory   = ...\Spider\zhiyu-stack
language    = python
installCmd  = ""                  ← 依赖已内置，不需要装任何东西
startCmd    = python serve.py      ← 监听 $PORT，绑 0.0.0.0
```

注意：`frontend/node_modules/` 不要跟着上传（发布本身会排除，但别手工往里塞）。
`web/` 是构建产物，**必须**跟着上传，服务器上没有 Node。

### 两条硬约束（都踩过）

1. **构建产物目录不能叫 `dist` / `build` / `out`。** 发布工具上传时会排除构建产物目录，
   我第一次把 Vue 产物放在 `frontend/dist/`，它整个没被传上去，服务器上 Django
   找不到 `index.html`，对每个请求都回 503。现在产物落在 `web/`。
2. **`data/db.sqlite3` 不要进发布目录。** 服务器首次启动会自己 migrate + seed。
   把本机那份传上去 = 用你本地的旧笔记覆盖线上用户写的东西。
   本地开发因此走 `.localdata/`（见上面的 `serve_dev.py`）。
   **重新发布前**如果线上已经有真实笔记，先 `GET /api/export` 导一份留底。
