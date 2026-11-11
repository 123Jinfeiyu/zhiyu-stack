"""JSON API —— 手写，不引 DRF。

理由：这个应用就七个动作（登录、读树、增、改、移、删、搜）+ 分享/导入导出。
DRF 会带来 serializer、browsable API、分页等一大堆用不上的东西，还要在服务器上多装一个包。
这边只依赖 Django 自带的那点东西，跑起来轻、部署时零联网。
"""
from __future__ import annotations

import json
import re
import secrets
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.static import serve as static_serve

from server import auth

from . import kg, llm
from .models import Node, Share, User

ROOT_TITLE = "全部笔记"


class ApiError(Exception):
    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.msg = msg
        self.status = status


def _configured_origins() -> list[str]:
    """本站的对外地址清单。

    两处来源：
      1. 环境变量 ZY_ORIGINS（本地开发 / 自己有 VPS 时用）；
      2. DATA_DIR/allowed_origins.txt（一行一个地址，# 开头是注释）。

    为什么要有第 2 种：线上跑在平台网关后面，部署工具不给设环境变量，容器里
    又看不到自己被访问的域名（Host 被改写成内网地址），所以只能把「我叫什么」
    写进一个和数据库同目录的文件里，随项目一起上传。
    """
    out = list(getattr(settings, "PUBLIC_ORIGINS", []))
    # 两个位置都看一眼：DATA_DIR（线上就是 BASE_DIR/data）以及随代码发布的
    # BASE_DIR/data（本地用 ZY_DATA_DIR 换了个数据目录时也能读到同一份配置）。
    seen: set[str] = set()
    for p in (Path(settings.DATA_DIR) / "allowed_origins.txt",
              Path(settings.BASE_DIR) / "data" / "allowed_origins.txt"):
        key = str(p.resolve())
        if key in seen:
            continue
        seen.add(key)
        try:
            if not p.exists():
                continue
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    out.append(line)
        except Exception:  # noqa: BLE001 —— 读不到就当没配，不影响主流程
            pass
    return out


def _self_hosts(request) -> set[str]:
    """收集「本服务自己」可能被叫成的主机名。

    线上部署在反向代理后面，容器里收到的 Host 未必等于浏览器地址栏里的域名：
    CloudStudio 网关会把 Host 改写成内网地址，真正对外的主机名只出现在
    X-Forwarded-Host 里，或者干脆两边都拿不到。所以这里把请求头、代理透传
    头和显式配置一起收。

    只比主机名（去掉端口、转小写），不比较 scheme —— http/https 的差异由代理终结，
    对「是否跨站」没有判断价值。
    """
    names: set[str] = set()

    def add(raw: str | None) -> None:
        for part in str(raw or "").split(","):
            part = part.strip().lower()
            if not part:
                continue
            # 反代可能只透传 hostname，也可能透传 hostname:port
            names.add(part.split("://")[-1].split("/")[0].split(":")[0])

    add(request.META.get("HTTP_HOST"))
    add(request.META.get("HTTP_X_FORWARDED_HOST"))
    add(request.META.get("HTTP_X_FORWARDED_SERVER"))
    try:
        add(request.get_host())  # 没有 HTTP_HOST 时按 SERVER_NAME:SERVER_PORT 兜底
    except Exception:  # noqa: BLE001 —— DisallowedHost 之类，忽略
        pass
    for item in _configured_origins():
        add(item)
    names.discard("")
    return names


def _same_origin(request) -> bool:
    """挡掉跨站写请求。

    第一道：前端每个请求都带自定义头 X-Zhiyu。浏览器里跨站页面要带自定义头，
    必然先发 CORS 预检，而本服务不返回任何 CORS 头 → 预检就挂了，伪造的请求发不出来。
    同源请求不会触发预检，所以这个头对正常使用零成本。
    第二道：没有这个头时（curl、脚本、第三方集成）退回 Origin 与「自己」比对。
    SameSite=Lax 的 cookie 是第零道。
    """
    if request.META.get("HTTP_X_ZHIYU"):
        return True
    origin = request.META.get("HTTP_ORIGIN")
    if not origin:
        return True  # 非浏览器客户端（curl / 脚本）不带 Origin
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https"):
        return False  # Origin: null（沙箱 iframe、file://）不认
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    return host in _self_hosts(request)


def api(auth_required: bool = True):
    def deco(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            try:
                if request.method in ("POST", "PUT", "PATCH", "DELETE") and not _same_origin(request):
                    # 排障提示：把「浏览器说的自己」和「服务端看到的自己」都带回去。
                    # 跨站攻击者看不到响应体（没有 CORS 头），这里不会泄露给第三方。
                    raise ApiError(
                        "跨站请求被拒绝（origin=%s，服务端认为自己是 %s）"
                        % (request.META.get("HTTP_ORIGIN"), "/".join(sorted(_self_hosts(request))) or "（空）"),
                        403,
                    )
                user = auth.current_user(request)
                request.zuser = user
                if auth_required and user is None:
                    raise ApiError("未登录", 401)
                data = view(request, *args, **kwargs)
                if isinstance(data, JsonResponse):
                    return data
                return JsonResponse(data, json_dumps_params={"ensure_ascii": False})
            except ApiError as exc:
                return JsonResponse(
                    {"ok": False, "error": exc.msg}, status=exc.status,
                    json_dumps_params={"ensure_ascii": False},
                )
            except Http404:
                return JsonResponse(
                    {"ok": False, "error": "节点不存在"}, status=404,
                    json_dumps_params={"ensure_ascii": False},
                )
            except Exception as exc:  # noqa: BLE001
                import logging

                logging.getLogger("zhiyu").exception("api 挂了")
                return JsonResponse(
                    {"ok": False, "error": "服务端错误：%s" % (exc,)}, status=500,
                    json_dumps_params={"ensure_ascii": False},
                )

        return wrapper

    return deco


def _body(request) -> dict:
    if not request.body:
        return {}
    try:
        data = json.loads(request.body.decode("utf-8"))
    except Exception:
        raise ApiError("请求体不是合法 JSON")
    if not isinstance(data, dict):
        raise ApiError("请求体必须是 JSON 对象")
    return data


def _ts(dt) -> int:
    return int(dt.timestamp())


def _brief(n: Node, kids: int = 0) -> dict:
    return {"id": n.pk, "pid": n.parent_id, "title": n.title, "kids": kids, "updated": _ts(n.updated_at)}


def _full(n: Node, kids: int = 0) -> dict:
    d = _brief(n, kids)
    d["content"] = n.content or ""
    return d


def _with_counts(qs):
    return qs.annotate(kid_count=Count("children"))


def _my(user):
    """只用来看得见的枝：别人的枝对所有接口等于不存在。"""
    return Node.objects.filter(owner=user)


def _get_node(nid, user=None) -> Node:
    qs = Node.objects.all() if user is None else _my(user)
    node = qs.filter(pk=nid).first()
    if node is None:
        raise Http404
    return node


def _descendant_ids(node: Node) -> list[int]:
    """广度优先取全部子孙 id（含自身）。"""
    seen = [node.pk]
    frontier = [node.pk]
    while frontier:
        nxt = list(Node.objects.filter(parent_id__in=frontier).values_list("pk", flat=True))
        nxt = [i for i in nxt if i not in seen]
        seen.extend(nxt)
        frontier = nxt
    return seen


# ------------------------------------------------------------------ 会话


@require_GET
@api(auth_required=False)
def health(request):
    return {"ok": True, "app": "zhiyu", "nodes": Node.objects.count(), "users": User.objects.count()}


@require_GET
@api(auth_required=False)
def me(request):
    user = request.zuser
    if user is None:
        return {"ok": True, "authed": False, "username": "", "nodes": 0,
                "inviteRequired": auth.invite_required()}
    resp = JsonResponse(
        {"ok": True, "authed": True, "username": user.username,
         "nodes": _my(user).count(), "inviteRequired": auth.invite_required()},
        json_dumps_params={"ensure_ascii": False},
    )
    # 用了一半寿命就续签，省得在家写着写着被踢下线
    if auth.token_age(request.COOKIES.get(settings.AUTH_COOKIE, "")) > settings.AUTH_TTL // 2:
        auth.set_cookie(resp, request, user)
    return resp


@require_POST
@api(auth_required=False)
def login(request):
    data = _body(request)
    name = str(data.get("username") or "").strip()
    user = User.objects.filter(username=name).first() if name else None
    if user is None or not auth.verify_password(user, data.get("password") or ""):
        # 不区分「没这个人」和「密码错」，免得被拿来撞用户名
        raise ApiError("用户名或密码不对", 401)
    return auth.set_cookie(
        JsonResponse({"ok": True, "username": user.username}, json_dumps_params={"ensure_ascii": False}),
        request,
        user,
    )


@require_POST
@api(auth_required=False)
def register(request):
    data = _body(request)
    try:
        name = auth.clean_username(data.get("username"))
        pw = auth.clean_password(data.get("password"))
    except ValueError as exc:
        raise ApiError(str(exc))

    invite = str(data.get("invite") or "").strip()
    if not auth.check_invite(invite):
        raise ApiError("邀请码无效，请向站长索取" if invite else "本站需要邀请码才能注册")

    if User.objects.filter(username=name).exists():
        raise ApiError("用户名已被占用")

    with transaction.atomic():
        user = User.objects.create(username=name, pw_hash=auth.hash_password(pw), invite=invite)
        # 单口令时代没有用户，那批无主之枝由第一个注册的人接手
        claimed = 0
        if User.objects.count() == 1:
            claimed = Node.objects.filter(owner__isnull=True).update(owner=user)

    return auth.set_cookie(
        JsonResponse(
            {"ok": True, "username": user.username, "claimed": claimed},
            json_dumps_params={"ensure_ascii": False},
        ),
        request,
        user,
    )


@require_POST
@api(auth_required=False)
def logout(request):
    return auth.clear_cookie(JsonResponse({"ok": True}))


@require_POST
@api()
def change_password(request):
    """改密码。

    cookie 签名掺了密码哈希 → 换哈希后旧 cookie 立刻失效，所以必须在
    响应里重签一枚新 cookie，不然用户改完密码当場就被自己踢下线。
    """
    user = request.zuser
    data = _body(request)
    if not auth.verify_password(user, data.get("old") or ""):
        raise ApiError("原密码不对")
    try:
        pw = auth.clean_password(data.get("new"))
    except ValueError as exc:
        raise ApiError(str(exc))
    if pw == data.get("old"):
        raise ApiError("新密码不能和原密码一样")

    user.pw_hash = auth.hash_password(pw)
    user.save(update_fields=["pw_hash"])
    return auth.set_cookie(
        JsonResponse({"ok": True}, json_dumps_params={"ensure_ascii": False}),
        request,
        user,
    )


# ------------------------------------------------------------------ 读树


@require_GET
@api()
def tree(request):
    """整棵森林的扁平清单 —— 小地图、搜索、移动目标选择都吃这一份。"""
    rows = _with_counts(_my(request.zuser).order_by("id"))
    return {"ok": True, "nodes": [_brief(n, n.kid_count) for n in rows], "rootTitle": ROOT_TITLE}


@require_GET
@api()
def node_detail(request, nid: int):
    if nid == 0:
        kids = _with_counts(_my(request.zuser).filter(parent__isnull=True).order_by("id"))
        return {
            "ok": True,
            "node": {"id": 0, "pid": None, "title": ROOT_TITLE, "content": "", "kids": kids.count(), "updated": 0},
            "children": [_full(n, n.kid_count) for n in kids],
            "crumbs": [],
        }

    node = _get_node(nid, request.zuser)
    kids = _with_counts(node.children.order_by("id"))
    crumbs = [_brief(a, 1) for a in node.ancestors()]
    return {
        "ok": True,
        "node": _full(node, kids.count()),
        "children": [_full(n, n.kid_count) for n in kids],
        "crumbs": crumbs,
    }


@require_GET
@api()
def search(request):
    q = (request.GET.get("q") or "").strip()
    if not q:
        raise ApiError("缺少搜索词 q")
    root_id = request.GET.get("root") or "0"
    if root_id.isdigit() and int(root_id) != 0:
        scope_ids = _descendant_ids(_get_node(int(root_id), request.zuser))
    else:
        scope_ids = None

    qs = _my(request.zuser)
    if scope_ids is not None:
        qs = qs.filter(pk__in=scope_ids)
    qs = qs.filter(Q(title__icontains=q) | Q(content__icontains=q)).order_by("id")
    qs = _with_counts(qs)

    hits = []
    for n in qs[:80]:
        snippet = ""
        low = (n.content or "").lower()
        idx = low.find(q.lower())
        if idx >= 0:
            start = max(0, idx - 30)
            snippet = (n.content or "")[start : start + 100].replace("\n", " ")
        hits.append({**_brief(n, n.kid_count), "snippet": snippet})
    return {"ok": True, "q": q, "hits": hits}


# ------------------------------------------------------------------ 写


@require_POST
@api()
def create_node(request):
    data = _body(request)
    title = (data.get("title") or "").strip() or "未命名"
    content = data.get("content") or ""
    pid = data.get("pid") or 0
    parent = None
    if int(pid) != 0:
        parent = _get_node(int(pid), request.zuser)
    node = Node.objects.create(owner=request.zuser, parent=parent, title=title[:200], content=content)
    return {"ok": True, "node": _full(node, 0)}


@require_POST
@api()
def update_node(request, nid: int):
    node = _get_node(nid, request.zuser)
    data = _body(request)
    changed = []
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            raise ApiError("标题不能为空")
        node.title = title[:200]
        changed.append("title")
    if "content" in data:
        node.content = data.get("content") or ""
        changed.append("content")
    if changed:
        node.save(update_fields=changed + ["updated_at"])
    return {"ok": True, "node": _full(node, node.children.count())}


@require_POST
@api()
def move_node(request, nid: int):
    node = _get_node(nid, request.zuser)
    data = _body(request)
    raw = data.get("pid", 0)
    pid = int(raw or 0)
    if pid == 0:
        target = None
    else:
        if pid == node.pk:
            raise ApiError("不能移到自己下面")
        target = _get_node(pid, request.zuser)
        # 移进自己的子孙会造成环 —— 检查目标是否在子树里
        if target.pk in _descendant_ids(node):
            raise ApiError("不能移到自己的子孙下面")
    node.parent = target
    node.save(update_fields=["parent", "updated_at"])
    return {"ok": True, "node": _brief(node, node.children.count())}


@require_POST
@api()
def delete_node(request, nid: int):
    node = _get_node(nid, request.zuser)
    ids = _descendant_ids(node)
    with transaction.atomic():
        Node.objects.filter(pk=node.pk).delete()
    return {"ok": True, "deleted": len(ids)}


# ------------------------------------------------------------------ 分享

_TOKEN_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _share_token() -> str:
    """12 位定长分享码（去掉了容易看混的 l/1/0/O）。"""
    return "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(12))


@require_POST
@api()
def share_node(request, nid: int):
    node = _get_node(nid, request.zuser)
    share = Share.objects.filter(node=node).order_by("-created_at").first()
    if share is None:
        # 分享码用「定长字母数字」：早先写成 token_urlsafe(9) 再剔除 -/_ ，
        # 约三分之一的概率只剩 10~11 位（时好时坏的测试就是它），这里改成定长生成。
        share = Share.objects.create(node=node, token=_share_token())
    return {"ok": True, "token": share.token, "title": node.title}


@require_POST
@api()
def revoke_share(request, nid: int):
    _get_node(nid, request.zuser)
    n = Share.objects.filter(node_id=nid).delete()[0]
    return {"ok": True, "revoked": n}


def _nested(node: Node, depth: int = 0, visited=None) -> dict:
    visited = visited or set()
    if node.pk in visited or depth > 8:
        return {**_full(node, 0), "children": []}
    visited.add(node.pk)
    kids = _with_counts(node.children.order_by("id"))
    return {**_full(node, kids.count()), "children": [_nested(k, depth + 1, visited) for k in kids]}


@require_GET
@api(auth_required=False)
def share_view(request, token: str):
    share = Share.objects.select_related("node").filter(token=token).first()
    if share is None:
        raise ApiError("分享链接无效或已撤销", 404)
    crumbs = [_brief(a, 1) for a in share.node.ancestors()]
    return {"ok": True, "root": _nested(share.node), "crumbs": crumbs}


@require_GET
@api()
def share_list(request):
    rows = Share.objects.select_related("node").filter(node__owner=request.zuser)[:50]
    return {
        "ok": True,
        "shares": [{"token": s.token, "node": s.node_id, "title": s.node.title} for s in rows],
    }


# ------------------------------------------------------------------ 导入导出


@require_GET
@api()
def export_all(request):
    rows = _my(request.zuser).order_by("id")
    return {
        "ok": True,
        "version": 1,
        "exportedAt": _ts(Node.objects.order_by("-updated_at").first().updated_at) if rows else 0,
        "nodes": [
            {"id": n.pk, "pid": n.parent_id or 0, "title": n.title, "content": n.content or ""}
            for n in rows
        ],
    }


@require_POST
@api()
def import_all(request):
    data = _body(request)
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        raise ApiError("缺少 nodes 数组")
    mode = data.get("mode") or "replace"

    # 先按旧 id 建映射，再二次挂父子，避免依赖数组顺序
    old_ids = []
    for item in nodes:
        if not isinstance(item, dict):
            raise ApiError("nodes 里有非对象元素")
        title = (item.get("title") or "").strip()
        if not title:
            raise ApiError("有节点缺标题")
        old_ids.append((item.get("id"), title, item.get("content") or "", item.get("pid") or 0))

    with transaction.atomic():
        if mode == "replace":
            Node.objects.filter(owner=request.zuser).delete()
            Share.objects.filter(node__owner=request.zuser).delete()
        mapping = {}
        for oid, title, content, _pid in old_ids:
            n = Node.objects.create(owner=request.zuser, title=title[:200], content=content)
            mapping[oid] = n
        for oid, _t, _c, pid in old_ids:
            if pid and pid in mapping and mapping[oid].parent_id != mapping[pid].pk:
                if mapping[pid].pk != mapping[oid].pk:
                    mapping[oid].parent = mapping[pid]
                    mapping[oid].save(update_fields=["parent", "updated_at"])
    return {"ok": True, "imported": len(old_ids)}


# ------------------------------------------------------------------ 业务知识图谱


def _kg_nodes(user) -> list:
    return [
        {"id": n.pk, "title": n.title, "content": n.content or ""}
        for n in _my(user).only("id", "title", "content").order_by("id")
    ]


@require_GET
@api()
def kg_graph(request):
    """整片林子的业务知识图谱。

    先给本地算法算出来的图（快、离线可用），前端拿到就能画；
    AI 命名与洞察是第二个请求（/api/kg/ai），慢也不挡着图先出来。
    """
    nodes = _kg_nodes(request.zuser)
    graph = kg.build(nodes)
    graph["hash"] = kg.content_hash(nodes)
    graph["aiAvailable"] = llm.available()
    graph["builtAt"] = kg.now()
    return {"ok": True, **graph}


@require_POST
@api()
def kg_ai(request):
    """让模型给业务线起人话名字。

    命中缓存（枝没变过）直接返回；否则调一次，失败就老实说失败 ——
    调用方会继续用本地名字，功能不残。
    """
    data = _body(request)
    nodes = _kg_nodes(request.zuser)
    h = kg.content_hash(nodes)
    force = bool(data.get("force"))

    if not force:
        cached = llm.load_cache(h)
        if cached:
            graph = kg.apply_ai(kg.build(nodes), cached)
            graph["hash"] = h
            graph["aiAvailable"] = True
            graph["builtAt"] = kg.now()
            return {"ok": True, "ai": True, "cached": True, "graph": graph, "reason": ""}

    graph = kg.build(nodes)
    if not graph.get("concepts"):
        return {"ok": True, "ai": False, "reason": graph.get("empty") or "还没有可分析的概念"}

    ai, reason = llm.enhance(kg.prompt_payload(graph, nodes))
    if not ai:
        return {"ok": True, "ai": False, "reason": reason}

    llm.save_cache(h, ai)
    merged = kg.apply_ai(graph, ai)
    merged["hash"] = h
    merged["aiAvailable"] = True
    merged["builtAt"] = kg.now()
    return {"ok": True, "ai": True, "cached": False, "graph": merged, "reason": ""}


# ------------------------------------------------------------------ 图片上传

# 声明类型 → 扩展名。真正做主的是文件头魔数（_sniff_image），
# declared 只用来在「两边都认识却对不上」时拦一道伪装的。
_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB —— 记笔记的截图够用，也防把磁盘塞爆


def _sniff_image(head: bytes) -> str | None:
    """看文件头前几个字节认图片格式，认不出返回 None。

    信任魔数而不是 Content-Type：后者是客户端说了算的，curl 一行就能伪造。
    """
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return ".webp"
    return None


def _uploads_dir() -> Path:
    d = Path(settings.DATA_DIR) / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


@require_POST
@api()
def upload_image(request):
    """把一张图片存进 DATA_DIR/uploads，返回可以直接写进 Markdown 的 /up/ 链接。

    和 db.sqlite3 同住 data/ 目录：那是线上唯一确定不会被发布覆盖清空
    的运行期目录，图片跟着数据库走，备份/迁移也只需要带走一个目录。
    """
    f = request.FILES.get("file")
    if f is None:
        raise ApiError("缺少文件字段 file（multipart/form-data）")
    if f.size == 0:
        raise ApiError("文件是空的")
    if f.size > MAX_IMAGE_BYTES:
        raise ApiError("图片太大了，请压缩到 5MB 以内")

    head = f.read(16)
    f.seek(0)
    ext = _sniff_image(head)
    if ext is None:
        raise ApiError("只支持 PNG / JPG / GIF / WebP 图片")
    declared = str(f.content_type or "").split(";")[0].strip().lower()
    if declared in _IMAGE_TYPES and _IMAGE_TYPES[declared] != ext:
        raise ApiError("文件内容与声明类型不一致，已拒绝")

    name = secrets.token_hex(8) + ext
    with open(_uploads_dir() / name, "wb") as out:
        for chunk in f.chunks():
            out.write(chunk)
    return {"ok": True, "url": "/up/" + name, "size": f.size, "type": ext.lstrip(".")}


@require_GET
def uploaded_file(request, name: str):
    """只读服务上传的图片。不要求登录 —— 分享页是公开的，图片得跟着公开。

    文件名只认「16 位十六进制 + 四种扩展名」这个自己生成的格式，
    穿不进 "../" 之类的路径花招；再交给 Django 的静态服务读文件。
    """
    if not re.fullmatch(r"[0-9a-f]{16}\.(png|jpg|gif|webp)", name):
        return JsonResponse({"ok": False, "error": "文件不存在"}, status=404)
    p = _uploads_dir() / name
    if not p.is_file():
        return JsonResponse({"ok": False, "error": "文件不存在"}, status=404)
    resp = static_serve(request, name, document_root=str(_uploads_dir()))
    # 文件名是随机的、内容永不再变，放开缓存可以省掉大量重复下载
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


# ------------------------------------------------------------------ 静态与 SPA


def api_not_found(request, rest: str = ""):
    """未定义的 /api/* 必须回 JSON 404，不能掉进 SPA 兜底返回 HTML。

    否则客户端 `res.json()` 会抛「返回不是 JSON（200）」，排查时非常误导。
    """
    return JsonResponse(
        {"ok": False, "error": "接口不存在：/api/" + (rest or "")},
        status=404,
        json_dumps_params={"ensure_ascii": False},
    )


def spa(request, path: str = ""):
    """所有非 /api、非 /assets 的路径都交给前端路由。"""
    index = settings.DIST_DIR / "index.html"
    if not index.exists():
        return JsonResponse(
            {
                "ok": False,
                "error": "前端还没构建。在 frontend/ 里跑 npm run build（或 npm run dev 开发）。",
            },
            status=503,
        )
    if path in ("favicon.ico", "robots.txt"):
        from django.http import HttpResponse

        return HttpResponse(status=204)
    return static_serve(request, "index.html", document_root=str(settings.DIST_DIR))


def assets(request, path: str):
    return static_serve(request, path, document_root=str(settings.DIST_DIR / "assets"))
