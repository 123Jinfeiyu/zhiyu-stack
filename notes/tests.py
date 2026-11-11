"""后端 API 测试。

跑法：python manage.py test notes -v 1
用的是内存 sqlite，不会碰 data/db.sqlite3。
"""
import json

from django.test import Client, TestCase

from .models import Node, User

# --- 测试用快速哈希 -------------------------------------------------------
# Django 默认 PBKDF2 要迭代百万次，一次约 0.2~0.3 秒。这个测试套里几乎每个用例
# 都要建用户 + 登录（一次 make + 一次 check），跑下来光哈希就要好几分钟。
# 这里把 hasher 换成 md5：验的是我们的注册/登录逻辑，不是 Django 的哈希实现。
import hashlib as _hashlib

import server.auth as _auth

_auth._dj_make = lambda raw: "md5$" + _hashlib.md5(str(raw).encode("utf-8")).hexdigest()
_auth._dj_check = lambda raw, h: h == "md5$" + _hashlib.md5(str(raw).encode("utf-8")).hexdigest()
# -------------------------------------------------------------------------


def jget(client, url):
    r = client.get(url)
    return r, json.loads(r.content)


def jpost(client, url, payload=None):
    r = client.post(url, data=json.dumps(payload or {}), content_type="application/json")
    return r, json.loads(r.content)


class BaseCase(TestCase):
    username = "tester"
    pw = "test-pass-1234"

    def setUp(self):
        import server.auth as auth

        self.c = Client()
        self.user = User.objects.create(username=self.username, pw_hash=auth.hash_password(self.pw))
        self.login()

    def login(self, user=None, pw=None):
        u = user or self.user
        r = self.c.post(
            "/api/login",
            data=json.dumps({"username": u.username, "password": pw or self.pw}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def node(self, title, parent=None, content=""):
        return Node.objects.create(owner=self.user, title=title, parent=parent, content=content)


class AuthTests(BaseCase):
    def test_health_is_public(self):
        c = Client()
        r, d = jget(c, "/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(d["ok"])

    def test_wrong_password_rejected(self):
        c = Client()
        r = c.post(
            "/api/login",
            data=json.dumps({"username": self.username, "password": "nope"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("zhiyu_auth", r.cookies.keys())

    def test_unknown_user_rejected(self):
        c = Client()
        r = c.post(
            "/api/login",
            data=json.dumps({"username": "no-such-one", "password": self.pw}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("zhiyu_auth", r.cookies.keys())

    def test_login_sets_httponly_cookie(self):
        c = Client()
        r = c.post(
            "/api/login",
            data=json.dumps({"username": self.username, "password": self.pw}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        cookie = r.cookies["zhiyu_auth"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")

    def test_me_reports_state(self):
        _, d = jget(Client(), "/api/me")
        self.assertFalse(d["authed"])
        _, d = jget(self.c, "/api/me")
        self.assertTrue(d["authed"])

    def test_requires_auth(self):
        c = Client()
        for url in ("/api/tree", "/api/nodes/0", "/api/search?q=x"):
            r, d = jget(c, url)
            self.assertEqual(r.status_code, 401, url)
            self.assertIn("未登录", d["error"])

    def test_cross_site_write_blocked(self):
        r = self.c.post(
            "/api/nodes",
            data=json.dumps({"title": "x"}),
            content_type="application/json",
            HTTP_ORIGIN="https://evil.example.com",
        )
        self.assertEqual(r.status_code, 403)

    # —— Origin 白名单（线上踩过：浏览器发 Origin，代理改写了 Host，写操作全 403）——
    def _write(self, origin, **extra):
        return self.c.post(
            "/api/nodes",
            data=json.dumps({"title": "同源测试"}),
            content_type="application/json",
            HTTP_ORIGIN=origin,
            **extra,
        )

    def test_same_origin_write_allowed(self):
        self.assertEqual(self._write("http://testserver").status_code, 200)

    def test_same_origin_ignores_case_and_port(self):
        self.assertEqual(self._write("HTTP://TESTSERVER:8000").status_code, 200)

    def test_origin_trusts_forwarded_host(self):
        """反代把 Host 改写成内网地址时，对外域名只出现在 X-Forwarded-Host 里。"""
        r = self._write("https://notes.example.com", HTTP_X_FORWARDED_HOST="notes.example.com")
        self.assertEqual(r.status_code, 200)

    def test_origin_trusts_public_origins_setting(self):
        with self.settings(PUBLIC_ORIGINS=["https://notes.example.com"]):
            self.assertEqual(self._write("https://notes.example.com").status_code, 200)

    def test_origin_trusts_allowed_origins_file(self):
        """线上不给设环境变量，对外域名靠 data/allowed_origins.txt 带上去。"""
        import tempfile
        from pathlib import Path

        from django.test import override_settings

        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "allowed_origins.txt").write_text(
                "# 注释行\nhttps://notes.example.com\n", encoding="utf-8"
            )
            with override_settings(DATA_DIR=tmp, PUBLIC_ORIGINS=[]):
                self.assertEqual(self._write("https://notes.example.com").status_code, 200)
                self.assertEqual(self._write("https://evil.example.com").status_code, 403)

    def test_null_origin_blocked(self):
        """sandbox iframe / file:// 发的是 Origin: null，不能当成同源。"""
        self.assertEqual(self._write("null").status_code, 403)

    def test_custom_header_bypasses_origin_check(self):
        """前端每个请求都带 X-Zhiyu：跨站页面带不出自定义头（预检过不去），
        所以带了就是自己人，域名换了也不用改配置。"""
        r = self.c.post(
            "/api/nodes",
            data=json.dumps({"title": "带自定义头"}),
            content_type="application/json",
            HTTP_ORIGIN="https://evil.example.com",
            HTTP_X_ZHIYU="1",
        )
        self.assertEqual(r.status_code, 200)

    def test_lookalike_host_blocked(self):
        with self.settings(PUBLIC_ORIGINS=["https://notes.example.com"]):
            self.assertEqual(self._write("https://notes.example.com.evil.com").status_code, 403)
            self.assertEqual(self._write("https://evilnotes.example.com").status_code, 403)

    def test_get_without_origin_still_fine(self):
        """读请求不受 Origin 限制，带个外站 Origin 也能读（只挡写）。"""
        r = self.c.get("/api/nodes/0", HTTP_ORIGIN="https://evil.example.com")
        self.assertEqual(r.status_code, 200)

    def test_logout_clears_cookie(self):
        r = self.c.post("/api/logout")
        self.assertEqual(r.status_code, 200)
        _, d = jget(self.c, "/api/me")
        self.assertFalse(d["authed"])

    def test_password_change_invalidates_cookie(self):
        import server.auth as auth

        c = Client()
        r = c.post(
            "/api/login",
            data=json.dumps({"username": self.username, "password": self.pw}),
            content_type="application/json",
        )
        token = r.cookies["zhiyu_auth"].value
        self.assertTrue(auth.token_ok(token))
        self.user.pw_hash = auth.hash_password("another-pass-9999")
        self.user.save(update_fields=["pw_hash"])
        self.assertFalse(auth.token_ok(token), "改密码后旧 cookie 必须失效")


class TreeReadTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.a = self.node("A")
        self.a1 = self.node("A1", self.a, "content one")
        self.a11 = self.node("A11", self.a1)
        self.b = self.node("B")

    def test_tree_flat(self):
        _, d = jget(self.c, "/api/tree")
        self.assertEqual(len(d["nodes"]), 4)
        by = {n["title"]: n for n in d["nodes"]}
        self.assertEqual(by["A"]["kids"], 1)
        self.assertIsNone(by["A"]["pid"])
        self.assertEqual(by["A1"]["pid"], self.a.pk)

    def test_root_view(self):
        _, d = jget(self.c, "/api/nodes/0")
        self.assertEqual(d["node"]["id"], 0)
        self.assertEqual([c["title"] for c in d["children"]], ["A", "B"])
        self.assertEqual(d["children"][0]["kids"], 1)
        self.assertEqual(d["crumbs"], [])

    def test_node_view(self):
        _, d = jget(self.c, "/api/nodes/%d" % self.a1.pk)
        self.assertEqual(d["node"]["title"], "A1")
        self.assertEqual(d["node"]["content"], "content one")
        self.assertEqual([c["title"] for c in d["children"]], ["A11"])
        self.assertEqual([c["title"] for c in d["crumbs"]], ["A"])

    def test_missing_node_404(self):
        r, d = jget(self.c, "/api/nodes/999999")
        self.assertEqual(r.status_code, 404)
        self.assertFalse(d["ok"])

    def test_children_ordered_by_id(self):
        for i in range(3):
            self.node("k%d" % i, self.b)
        _, d = jget(self.c, "/api/nodes/%d" % self.b.pk)
        self.assertEqual([c["title"] for c in d["children"]], ["k0", "k1", "k2"])


class WriteTests(BaseCase):
    def test_create_root_and_child(self):
        _, d = jpost(self.c, "/api/nodes", {"title": "新枝"})
        nid = d["node"]["id"]
        self.assertIsNone(d["node"]["pid"])
        _, d2 = jpost(self.c, "/api/nodes", {"pid": nid, "title": "子枝", "content": "hi"})
        self.assertEqual(d2["node"]["pid"], nid)
        self.assertEqual(Node.objects.get(pk=nid).children.count(), 1)

    def test_create_defaults_title(self):
        _, d = jpost(self.c, "/api/nodes", {})
        self.assertEqual(d["node"]["title"], "未命名")

    def test_update_title_and_content(self):
        n = self.node("旧")
        _, d = jpost(self.c, "/api/nodes/%d/update" % n.pk, {"title": "新", "content": "正文"})
        self.assertEqual(d["node"]["title"], "新")
        n.refresh_from_db()
        self.assertEqual(n.content, "正文")

    def test_update_empty_title_rejected(self):
        n = self.node("旧")
        r, d = jpost(self.c, "/api/nodes/%d/update" % n.pk, {"title": "   "})
        self.assertEqual(r.status_code, 400)
        self.assertIn("标题不能为空", d["error"])

    def test_move_to_root(self):
        a = self.node("A")
        child = self.node("c", a)
        _, d = jpost(self.c, "/api/nodes/%d/move" % child.pk, {"pid": 0})
        self.assertIsNone(d["node"]["pid"])

    def test_move_into_descendant_rejected(self):
        a = self.node("A")
        b = self.node("B", a)
        r, d = jpost(self.c, "/api/nodes/%d/move" % a.pk, {"pid": b.pk})
        self.assertEqual(r.status_code, 400)
        self.assertIn("子孙", d["error"])

    def test_move_into_self_rejected(self):
        a = self.node("A")
        r, d = jpost(self.c, "/api/nodes/%d/move" % a.pk, {"pid": a.pk})
        self.assertEqual(r.status_code, 400)

    def test_delete_cascades(self):
        a = self.node("A")
        b = self.node("B", a)
        self.node("C", b)
        self.node("D")
        _, d = jpost(self.c, "/api/nodes/%d/delete" % a.pk, {})
        self.assertEqual(d["deleted"], 3)
        self.assertEqual(Node.objects.count(), 1)

    def test_max_title_truncated(self):
        _, d = jpost(self.c, "/api/nodes", {"title": "长" * 300})
        self.assertEqual(len(d["node"]["title"]), 200)


class SearchTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.a = self.node("烘焙笔记", content="面粉 500g")
        self.a1 = self.node("可颂", self.a, "黄油要冷")
        self.b = self.node("另一棵树", content="面粉 100g")

    def test_search_all(self):
        _, d = jget(self.c, "/api/search?q=面粉")
        self.assertEqual(len(d["hits"]), 2)

    def test_search_scoped(self):
        _, d = jget(self.c, "/api/search?q=面粉&root=%d" % self.a.pk)
        self.assertEqual([h["title"] for h in d["hits"]], ["烘焙笔记"])

    def test_search_scoped_deep(self):
        _, d = jget(self.c, "/api/search?q=黄油&root=%d" % self.a.pk)
        self.assertEqual([h["title"] for h in d["hits"]], ["可颂"])

    def test_search_case_insensitive(self):
        self.node("Markdown", content="Hello World")
        _, d = jget(self.c, "/api/search?q=hello")
        self.assertEqual(len(d["hits"]), 1)

    def test_search_requires_q(self):
        r, d = jget(self.c, "/api/search")
        self.assertEqual(r.status_code, 400)

    def test_search_snippet(self):
        long = "x" * 40 + "关键词" + "y" * 40
        self.node("snippet", content=long)
        _, d = jget(self.c, "/api/search?q=关键词")
        self.assertIn("关键词", d["hits"][0]["snippet"])


class ShareTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.a = self.node("公开的树")
        self.a1 = self.node("第一枝", self.a, "正文")
        self.node("第二枝", self.a)

    def test_share_creates_token(self):
        _, d = jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        self.assertTrue(d["token"])
        self.assertEqual(len(d["token"]), 12)

    def test_share_is_idempotent(self):
        _, d1 = jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        _, d2 = jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        self.assertEqual(d1["token"], d2["token"])

    def test_share_readable_without_login(self):
        _, d = jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        anon = Client()
        r, s = jget(anon, "/api/share/%s" % d["token"])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(s["root"]["title"], "公开的树")
        self.assertEqual(len(s["root"]["children"]), 2)
        self.assertEqual(s["root"]["children"][0]["content"], "正文")

    def test_bad_token_404(self):
        r, d = jget(Client(), "/api/share/nope123")
        self.assertEqual(r.status_code, 404)

    def test_revoke(self):
        _, d = jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        _, rv = jpost(self.c, "/api/nodes/%d/share/revoke" % self.a.pk, {})
        self.assertEqual(rv["revoked"], 1)
        r, _ = jget(Client(), "/api/share/%s" % d["token"])
        self.assertEqual(r.status_code, 404)

    def test_share_list(self):
        jpost(self.c, "/api/nodes/%d/share" % self.a.pk, {})
        _, d = jget(self.c, "/api/shares")
        self.assertEqual(len(d["shares"]), 1)
        self.assertEqual(d["shares"][0]["title"], "公开的树")


class BackupTests(BaseCase):
    def test_export_shape(self):
        a = self.node("A")
        self.node("B", a, "正文")
        _, d = jget(self.c, "/api/export")
        self.assertEqual(d["version"], 1)
        self.assertEqual(len(d["nodes"]), 2)
        self.assertEqual(d["nodes"][1]["pid"], a.pk)

    def test_roundtrip(self):
        a = self.node("A")
        b = self.node("B", a, "正文")
        _, d = jget(self.c, "/api/export")
        # 换成一份全新的库
        Node.objects.all().delete()
        r, res = jpost(self.c, "/api/import", d)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(res["imported"], 2)
        titles = sorted(Node.objects.values_list("title", flat=True))
        self.assertEqual(titles, ["A", "B"])
        new_b = Node.objects.get(title="B")
        self.assertEqual(new_b.parent.title, "A")
        self.assertEqual(new_b.content, "正文")
        self.assertNotEqual(new_b.pk, b.pk)

    def test_import_replace_clears(self):
        self.node("旧")
        _, res = jpost(self.c, "/api/import", {"nodes": [{"id": 1, "pid": 0, "title": "新", "content": ""}]})
        self.assertEqual(res["imported"], 1)
        self.assertEqual(list(Node.objects.values_list("title", flat=True)), ["新"])

    def test_import_bad_payload(self):
        r, d = jpost(self.c, "/api/import", {"nodes": "nope"})
        self.assertEqual(r.status_code, 400)
        r, d = jpost(self.c, "/api/import", {"nodes": [{"id": 1}]})
        self.assertEqual(r.status_code, 400)

    def test_import_ignores_dangling_parent(self):
        _, res = jpost(self.c, "/api/import", {"nodes": [{"id": 5, "pid": 99, "title": "孤儿"}]})
        self.assertEqual(res["imported"], 1)
        self.assertIsNone(Node.objects.get(title="孤儿").parent)

    def test_import_cannot_self_parent(self):
        jpost(self.c, "/api/import", {"nodes": [{"id": 7, "pid": 7, "title": "自己"}]})
        self.assertIsNone(Node.objects.get(title="自己").parent)


class UnicodePasswordTests(TestCase):
    """密码允许中文 —— 这里守着一个真踩过的坑。

    hmac.compare_digest 对含非 ASCII 的 str 会抛 TypeError，最初写成直接比较 str，
    导致「输错密码」返回 500 而不是 401。凡是要比的东西，非 ASCII 一律先 encode。
    """

    def test_chinese_password(self):
        import server.auth as auth

        User.objects.create(username="青苔", pw_hash=auth.hash_password("青苔-meadow-4347"))
        c = Client()
        r = c.post(
            "/api/login",
            data=json.dumps({"username": "青苔", "password": "错的"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401, "错密码应该 401 而不是 500")

        r = c.post(
            "/api/login",
            data=json.dumps({"username": "青苔", "password": "青苔-meadow-4347"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)

    def test_chinese_username(self):
        import server.auth as auth

        User.objects.create(username="小树", pw_hash=auth.hash_password("plain-123456"))
        r = Client().post(
            "/api/login",
            data=json.dumps({"username": "小树", "password": "plain-123456"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)


class RegisterTests(TestCase):
    """注册：用户名/密码校验、重名、邀请码（选填，配了名单才必填）、首个用户认领无主之枝。"""

    def setUp(self):
        self.c = Client()

    def reg(self, username="newbie", password="pass-123456", invite=None, client=None):
        payload = {"username": username, "password": password}
        if invite is not None:
            payload["invite"] = invite
        r = (client or self.c).post(
            "/api/register", data=json.dumps(payload), content_type="application/json"
        )
        return r, json.loads(r.content)

    def test_register_and_autologin(self):
        r, d = self.reg()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(d["ok"])
        self.assertEqual(d["username"], "newbie")
        self.assertIn("zhiyu_auth", r.cookies.keys())
        _, me = jget(self.c, "/api/me")
        self.assertTrue(me["authed"])
        self.assertEqual(me["username"], "newbie")

    def test_duplicate_username(self):
        self.reg()
        r, d = self.reg(password="another-123456")
        self.assertEqual(r.status_code, 400)
        self.assertIn("占用", d["error"])

    def test_short_password_rejected(self):
        r, d = self.reg(password="123")
        self.assertEqual(r.status_code, 400)
        self.assertIn("密码", d["error"])

    def test_bad_username_rejected(self):
        r, d = self.reg(username="a")
        self.assertEqual(r.status_code, 400)
        self.assertIn("用户名", d["error"])

    def test_invite_optional_by_default(self):
        # 没配邀请码名单时，不填也能注册
        r, d = self.reg(username="open-user")
        self.assertEqual(r.status_code, 200, r.content)

    def test_first_user_claims_orphan_nodes(self):
        orphan = Node.objects.create(owner=None, title="老树的枝")
        r, d = self.reg(username="first-one")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(d["claimed"], 1)
        orphan.refresh_from_db()
        self.assertEqual(orphan.owner.username, "first-one")

    def test_second_user_does_not_claim(self):
        self.reg(username="one")
        orphan = Node.objects.create(owner=None, title="后来的无主枝")
        r, d = self.reg(username="two", password="pass-654321")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(d["claimed"], 0)
        orphan.refresh_from_db()
        self.assertIsNone(orphan.owner)


class InviteCodeTests(TestCase):
    """data/invite_codes.txt 有内容 → 注册必须带有效邀请码。"""

    def setUp(self):
        from django.conf import settings

        self.f = settings.DATA_DIR / "invite_codes.txt"
        self.f.write_text("# 测试用名单\nMOSS-2049\nTWIG-8848\n", encoding="utf-8")
        self.addCleanup(lambda: self.f.exists() and self.f.unlink())
        self.c = Client()

    def reg(self, invite=None):
        payload = {"username": "invited", "password": "pass-123456"}
        if invite is not None:
            payload["invite"] = invite
        r = self.c.post("/api/register", data=json.dumps(payload), content_type="application/json")
        return r, json.loads(r.content)

    def test_missing_invite_rejected(self):
        r, d = self.reg()
        self.assertEqual(r.status_code, 400)
        self.assertIn("邀请码", d["error"])

    def test_wrong_invite_rejected(self):
        r, d = self.reg("NOPE-0000")
        self.assertEqual(r.status_code, 400)
        self.assertIn("邀请码", d["error"])

    def test_good_invite_accepted(self):
        r, d = self.reg("MOSS-2049")
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(username="invited")
        self.assertEqual(u.invite, "MOSS-2049")

    def test_me_reports_invite_required(self):
        _, d = jget(Client(), "/api/me")
        self.assertTrue(d["inviteRequired"])


class IsolationTests(TestCase):
    """别人的枝必须像不存在一样：读不到、改不了、删不掉、搜不到、导出里没有。"""

    def setUp(self):
        import server.auth as auth

        self.a = User.objects.create(username="alice", pw_hash=auth.hash_password("alice-pass-1"))
        self.b = User.objects.create(username="bob", pw_hash=auth.hash_password("bob-pass-1"))
        self.na = Node.objects.create(owner=self.a, title="爱丽丝的枝", content="秘密")
        self.nb = Node.objects.create(owner=self.b, title="鲍勃的枝")

        self.ca = Client()
        self.ca.post(
            "/api/login",
            data=json.dumps({"username": "alice", "password": "alice-pass-1"}),
            content_type="application/json",
        )
        self.cb = Client()
        self.cb.post(
            "/api/login",
            data=json.dumps({"username": "bob", "password": "bob-pass-1"}),
            content_type="application/json",
        )

    def test_root_lists_only_own(self):
        _, d = jget(self.ca, "/api/nodes/0")
        self.assertEqual([n["title"] for n in d["children"]], ["爱丽丝的枝"])

    def test_cannot_read_other_node(self):
        r, _ = jget(self.cb, "/api/nodes/%d" % self.na.pk)
        self.assertEqual(r.status_code, 404)

    def test_cannot_update_other_node(self):
        r, _ = jpost(self.cb, "/api/nodes/%d/update" % self.na.pk, {"title": "改掉"})
        self.assertEqual(r.status_code, 404)
        self.na.refresh_from_db()
        self.assertEqual(self.na.title, "爱丽丝的枝")

    def test_cannot_delete_other_node(self):
        r, _ = jpost(self.cb, "/api/nodes/%d/delete" % self.na.pk)
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Node.objects.filter(pk=self.na.pk).exists())

    def test_cannot_move_into_other_tree(self):
        r, _ = jpost(self.cb, "/api/nodes/%d/move" % self.nb.pk, {"pid": self.na.pk})
        self.assertEqual(r.status_code, 404)

    def test_search_stays_inside_own_tree(self):
        _, d = jget(self.cb, "/api/search?q=%E7%A7%98%E5%AF%86")  # 搜「秘密」
        self.assertEqual(d["hits"], [])

    def test_export_only_own(self):
        _, d = jget(self.cb, "/api/export")
        self.assertEqual([n["title"] for n in d["nodes"]], ["鲍勃的枝"])

    def test_import_replace_does_not_touch_others(self):
        jpost(self.cb, "/api/import", {"mode": "replace", "nodes": [{"id": 1, "pid": 0, "title": "新的"}]})
        self.assertTrue(Node.objects.filter(pk=self.na.pk).exists(), "别人的枝不能被 replace 清掉")
        self.assertFalse(Node.objects.filter(pk=self.nb.pk).exists())

    def test_share_list_only_own(self):
        Share = __import__("notes.models", fromlist=["Share"]).Share
        Share.objects.create(node=self.na, token="aaaabbbbcccc")
        _, d = jget(self.cb, "/api/shares")
        self.assertEqual(d["shares"], [])

    def test_tree_lists_only_own(self):
        _, d = jget(self.cb, "/api/tree")
        self.assertEqual([n["title"] for n in d["nodes"]], ["鲍勃的枝"])


class SpaTests(TestCase):
    def test_spa_without_build_is_503(self):
        r = Client().get("/")
        self.assertIn(r.status_code, (200, 503))

    def test_api_prefix_not_swallowed_by_spa(self):
        r = Client().get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/json", r["Content-Type"])

    def test_unknown_api_returns_json_404(self):
        for url in ("/api/nope", "/api/state", "/api/nodes/1/nope"):
            r = Client().get(url)
            self.assertEqual(r.status_code, 404, url)
            self.assertIn("application/json", r["Content-Type"], url)
            self.assertFalse(json.loads(r.content)["ok"], url)


class ChangePasswordTests(BaseCase):
    """改密码：验旧、校验新、换哈希后旧 cookie 失效而响应里的新 cookie 有效。"""

    def post(self, old, new):
        r = self.c.post(
            "/api/password", data=json.dumps({"old": old, "new": new}), content_type="application/json"
        )
        return r, json.loads(r.content)

    def test_ok_and_relogin(self):
        r, d = self.post(self.pw, "brand-new-pass")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(d["ok"])
        # 响应里带了新 cookie（签名掺新哈希），当前会话继续有效
        self.assertIn("zhiyu_auth", r.cookies.keys())
        _, me = jget(self.c, "/api/me")
        self.assertTrue(me["authed"])

        # 退出后：旧密码 401，新密码能进
        self.c.post("/api/logout")
        r = self.c.post(
            "/api/login", data=json.dumps({"username": self.username, "password": self.pw}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401)
        r = self.c.post(
            "/api/login", data=json.dumps({"username": self.username, "password": "brand-new-pass"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)

    def test_wrong_old_password(self):
        r, d = self.post("definitely-wrong", "brand-new-pass")
        self.assertEqual(r.status_code, 400)
        self.assertIn("原密码", d["error"])

    def test_new_password_too_short(self):
        r, _ = self.post(self.pw, "123")
        self.assertEqual(r.status_code, 400)

    def test_new_same_as_old(self):
        r, d = self.post(self.pw, self.pw)
        self.assertEqual(r.status_code, 400)
        self.assertIn("一样", d["error"])

    def test_old_cookie_invalid_after_change(self):
        """换哈希后，改密码前签发的旧 cookie 必须失效（签名密钥掺哈希前缀）。"""
        import server.auth as auth
        from django.conf import settings as dj_settings

        old_cookie = auth.issue_token(self.user)  # 模摘：改密码前拿到的 token
        self.post(self.pw, "brand-new-pass")
        c2 = Client()
        c2.cookies[dj_settings.AUTH_COOKIE] = old_cookie
        _, me = jget(c2, "/api/me")
        self.assertFalse(me["authed"])

    def test_requires_login(self):
        r = Client().post(
            "/api/password", data=json.dumps({"old": "x", "new": "yyyyyy"}), content_type="application/json"
        )
        self.assertEqual(r.status_code, 401)


# ------------------------------------------------------------------ 业务知识图谱

import shutil as _shutil
import tempfile as _tempfile
from pathlib import Path as _Path
from unittest.mock import patch as _patch

from django.test import override_settings as _override_settings


class KgTests(BaseCase):
    """图谱接口。不断言「抽出了哪个词」（那是算法细节，会随语料变），
    只断言结构、隔离、缓存与降级 —— 这些坏了才是真的坏了。"""

    ROWS = [
        ("还款账户", "客户要还款，先提供对公账户，账户信息要核对姓名。"),
        ("还款路径", "还款先查资方，账户从系统里取，别背。"),
        ("对公账户", "对公账户口述两遍，账户信息核对后再说。"),
        ("结清证明", "开结清证明要查工单，工单重复要拦住。"),
        ("结清工单", "结清之后开工单，工单里写清用途。"),
        ("工单模板", "工单模板里写结清证明用途，别漏。"),
    ]

    def setUp(self):
        super().setUp()
        self.tmp = _tempfile.mkdtemp(prefix="zykg")
        self._ov = _override_settings(DATA_DIR=_Path(self.tmp))
        self._ov.enable()

    def tearDown(self):
        self._ov.disable()
        _shutil.rmtree(self.tmp, ignore_errors=True)
        super().tearDown()

    def seed(self, rows=None):
        return [self.node(t, content=c).pk for t, c in (rows or self.ROWS)]

    def fake_llm(self):
        return {
            "insight": "两条线都卡在「先查再答」。",
            "clusters": [
                {"key": "c1", "name": "还款与账户", "summary": "还款前先确认账户归属。", "points": ["先查资方", "账户从系统取"]},
                {"key": "c2", "name": "结清与工单", "summary": "结清证明走工单。", "points": ["先查重"]},
            ],
        }

    def test_requires_login(self):
        r = Client().get("/api/kg")
        self.assertEqual(r.status_code, 401)

    def test_empty_forest_says_so(self):
        r, d = jget(self.c, "/api/kg")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(d["stats"]["branches"], 0)
        self.assertTrue(d["empty"])
        self.assertEqual(d["concepts"], [])
        self.assertEqual(d["clusters"], [])

    def test_two_branches_not_enough(self):
        self.node("一", content="还款")
        self.node("二", content="账户")
        _, d = jget(self.c, "/api/kg")
        self.assertIn("至少", d["empty"])
        self.assertEqual(d["concepts"], [])

    def test_shape_is_consistent(self):
        self.seed()
        r, d = jget(self.c, "/api/kg")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(d["stats"]["branches"], 6)
        cids = {c["id"] for c in d["concepts"]}
        kids = {c["id"] for c in d["clusters"]}
        self.assertTrue(cids)
        self.assertTrue(kids)
        # 每个概念都要挂到一条业务线上，每条业务线都要有概念
        for c in d["concepts"]:
            self.assertIn(c["cluster"], kids)
            self.assertGreaterEqual(c["df"], 2)
            self.assertLessEqual(len(c["branches"]), 12)
        for cl in d["clusters"]:
            self.assertTrue(cl["terms"])
            self.assertTrue(cl["name"])
            self.assertTrue(cl["summary"])
        # 边只连存在的概念，权重至少 2（只出现一次的不算关系）
        for a, b, w in d["links"]:
            self.assertIn(a, cids)
            self.assertIn(b, cids)
            self.assertGreaterEqual(w, 2)
        self.assertGreater(d["stats"]["coverage"], 0)
        self.assertTrue(d["hash"])

    def test_same_data_same_graph(self):
        self.seed()
        _, a = jget(self.c, "/api/kg")
        _, b = jget(self.c, "/api/kg")
        self.assertEqual(a["hash"], b["hash"])
        self.assertEqual(a["concepts"], b["concepts"])
        self.assertEqual(a["links"], b["links"])

    def test_hash_changes_when_content_changes(self):
        pid = self.seed()[0]
        _, a = jget(self.c, "/api/kg")
        self.assertTrue(jpost(self.c, "/api/nodes/%d/update" % pid, {"content": "完全换一段内容，加上结清与工单"})[0].status_code == 200)
        _, b = jget(self.c, "/api/kg")
        self.assertNotEqual(a["hash"], b["hash"])

    def test_other_users_are_invisible(self):
        self.seed()
        u2 = User.objects.create(username="other", pw_hash="x")
        c2 = Client()
        c2.post(
            "/api/login",
            data=json.dumps({"username": "other", "password": "nope"}),
            content_type="application/json",
        )
        import server.auth as auth

        u2.pw_hash = auth.hash_password("other-pass-1234")
        u2.save()
        c2 = Client()
        c2.post(
            "/api/login",
            data=json.dumps({"username": "other", "password": "other-pass-1234"}),
            content_type="application/json",
        )
        _, d = jget(c2, "/api/kg")
        self.assertEqual(d["stats"]["branches"], 0)
        self.assertTrue(d["empty"])

    def test_ai_names_replace_local_ones(self):
        self.seed()
        cfg = {"apiKey": "sk-test-not-a-real-key", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg), _patch(
            "notes.llm.chat", return_value=json.dumps(self.fake_llm(), ensure_ascii=False)
        ) as chat:
            r, d = jpost(self.c, "/api/kg/ai", {})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(d["ai"])
        self.assertEqual(chat.call_count, 1)
        g = d["graph"]
        self.assertEqual(g["engine"], "deepseek")
        self.assertEqual(g["insight"], "两条线都卡在「先查再答」。")
        named = {c["id"]: c for c in g["clusters"]}
        self.assertEqual(named["c1"]["name"], "还款与账户")
        self.assertTrue(named["c1"]["ai"])
        self.assertEqual(named["c1"]["points"], ["先查资方", "账户从系统取"])
        # 本地结构没被模型改坏：概念与边还在
        self.assertEqual(len(g["concepts"]), len(d["graph"]["concepts"]))
        self.assertTrue(g["links"])

    def test_ai_result_is_cached_by_hash(self):
        self.seed()
        cfg = {"apiKey": "sk-test", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg), _patch(
            "notes.llm.chat", return_value=json.dumps(self.fake_llm(), ensure_ascii=False)
        ):
            jpost(self.c, "/api/kg/ai", {})

        with _patch("notes.llm.config", return_value=cfg), _patch("notes.llm.chat") as chat:
            _, d = jpost(self.c, "/api/kg/ai", {})
        self.assertFalse(chat.called)  # 枝没变，不该再花一次 token
        self.assertTrue(d["cached"])
        self.assertEqual(d["graph"]["engine"], "deepseek")

    def test_force_rebuild_ignores_cache(self):
        self.seed()
        cfg = {"apiKey": "sk-test", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg), _patch(
            "notes.llm.chat", return_value=json.dumps(self.fake_llm(), ensure_ascii=False)
        ):
            jpost(self.c, "/api/kg/ai", {})
        with _patch("notes.llm.config", return_value=cfg), _patch(
            "notes.llm.chat", return_value=json.dumps(self.fake_llm(), ensure_ascii=False)
        ) as chat:
            _, d = jpost(self.c, "/api/kg/ai", {"force": True})
        self.assertEqual(chat.call_count, 1)
        self.assertFalse(d["cached"])

    def test_no_key_falls_back_quietly(self):
        self.seed()
        cfg = {"apiKey": "", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg):
            _, d = jpost(self.c, "/api/kg/ai", {})
        self.assertFalse(d["ai"])
        self.assertIn("密钥", d["reason"])
        self.assertNotIn("graph", d)

    def test_bad_json_from_model_is_not_fatal(self):
        self.seed()
        cfg = {"apiKey": "sk-test", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg), _patch("notes.llm.chat", return_value="好的，我分析了一下……"):
            _, d = jpost(self.c, "/api/kg/ai", {})
        self.assertFalse(d["ai"])
        self.assertTrue(d["reason"])
        # 图本身还能取
        _, g = jget(self.c, "/api/kg")
        self.assertTrue(g["concepts"])

    def test_model_fenced_json_is_accepted(self):
        self.seed()
        cfg = {"apiKey": "sk-test", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        fenced = "```json\n" + json.dumps(self.fake_llm(), ensure_ascii=False) + "\n```"
        with _patch("notes.llm.config", return_value=cfg), _patch("notes.llm.chat", return_value=fenced):
            _, d = jpost(self.c, "/api/kg/ai", {})
        self.assertTrue(d["ai"])

    def test_key_never_leaks(self):
        self.seed()
        cfg = {"apiKey": "sk-secret-should-not-appear", "baseUrl": "https://api.deepseek.com", "model": "m", "timeout": 5}
        with _patch("notes.llm.config", return_value=cfg), _patch(
            "notes.llm.chat", return_value=json.dumps(self.fake_llm(), ensure_ascii=False)
        ):
            r1, _ = jget(self.c, "/api/kg")
            r2, _ = jpost(self.c, "/api/kg/ai", {})
        for r in (r1, r2):
            body = r.content.decode("utf-8")
            self.assertNotIn("sk-secret", body)
            self.assertNotIn("apiKey", body)

    def test_ai_requires_login(self):
        r = Client().post("/api/kg/ai", data="{}", content_type="application/json")
        self.assertEqual(r.status_code, 401)


class KgRuleTests(BaseCase):
    """触发规则层：共现是「老一起出现」，规则是「满足了什么才做什么」，
    后者必须有方向、有出处，并且不能编。"""

    ROWS = [
        ("划扣时间", "还款过了当天划扣时间，系统不再自动划扣，才引导客户走对公账户转账。"),
        ("对公账户", "对公账户要口述两遍；划扣时间过了才给账户。"),
        ("还款路径", "还款先查资方，账户从系统里取，别背。"),
        ("结清证明", "开结清证明要查工单，工单重复要拦住。"),
        ("结清工单", "结清之后开工单，工单里写清用途。"),
        ("工单模板", "工单模板里写结清证明用途，别漏。"),
    ]

    def seed(self, rows=None):
        return [self.node(t, content=c).pk for t, c in (rows or self.ROWS)]

    def test_rules_have_direction_and_source(self):
        ids = self.seed(self.ROWS)
        _, d = jget(self.c, "/api/kg")
        rules = d["rules"]
        self.assertTrue(rules, "语料里有明确的「过了…才…」，应该抽得出来")
        cids = {c["id"] for c in d["concepts"]}
        for r in rules:
            self.assertIn(r["from"], cids)
            self.assertIn(r["to"], cids)
            self.assertNotEqual(r["from"], r["to"], "规则不能指向自己")
            self.assertIn(r["kind"], ("cond", "seq", "cause"))
            self.assertTrue(r["kindLabel"])
            self.assertTrue(r["label"])
            self.assertTrue(r["short"])
            self.assertTrue(set(r["branches"]) <= set(ids))
        self.assertEqual(d["stats"]["rules"], len(rules))

    def test_explicit_rule_comes_first_and_is_whole(self):
        self.seed(self.ROWS)
        _, d = jget(self.c, "/api/kg")
        first = d["rules"][0]
        self.assertEqual(first["source"], "rule")
        self.assertEqual(first["kindLabel"], "条件")
        self.assertEqual(first["short"], "过了划扣时间")
        self.assertIn("系统不再自动划扣", first["say"])
        self.assertIn("重复扣款", first["why"])
        self.assertGreaterEqual(len(first["branches"]), 2)

    def test_rule_endpoints_are_always_in_graph(self):
        """规则两端如果词频低进不了 top30，也要被补进图 —— 否则线画不出来。"""
        self.seed(self.ROWS)
        _, d = jget(self.c, "/api/kg")
        names = [c["name"] for c in d["concepts"]]
        self.assertTrue(any("划扣" in n for n in names))
        self.assertTrue(any("对公" in n for n in names))

    def test_no_matching_corpus_no_rule(self):
        """语料里没提划扣，就不该冒出那条规则（有「对公」也不行）。"""
        self.seed([
            ("还款账户", "客户要还款，先提供对公账户，账户信息要核对姓名。"),
            ("还款路径", "还款先查资方，账户从系统里取，别背。"),
            ("对公账户", "对公账户口述两遍，账户信息核对后再说。"),
            ("结清证明", "开结清证明要查工单，工单重复要拦住。"),
            ("结清工单", "结清之后开工单，工单里写清用途。"),
            ("工单模板", "工单模板里写结清证明用途，别漏。"),
        ])
        _, d = jget(self.c, "/api/kg")
        self.assertFalse([r for r in d["rules"] if r["source"] == "rule"])
        for r in d["rules"]:
            self.assertNotIn("划扣", r["say"])

    def test_rules_do_not_change_the_graph_shape(self):
        """规则是叠加层：加了它，概念/边/业务线还是原来那套结构。"""
        self.seed(self.ROWS)
        _, a = jget(self.c, "/api/kg")
        self.assertIn("rules", a)
        for c in a["concepts"]:
            self.assertGreaterEqual(c["df"], 2)
        self.assertTrue(a["links"])
        self.assertTrue(a["clusters"])
