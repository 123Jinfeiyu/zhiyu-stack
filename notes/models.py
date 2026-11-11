from django.db import models


class User(models.Model):
    """一个使用者。

    密码只存 PBKDF2 哈希（django.contrib.auth.hashers），不存明文。
    invite 记下注册时用的邀请码（选填，留空表示开放注册时进来的）。
    """

    username = models.CharField(max_length=40, unique=True)
    pw_hash = models.CharField(max_length=256)
    invite = models.CharField(max_length=40, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.username


class Node(models.Model):
    """一根枝 —— 树的节点。

    parent 为空表示这是一棵独立的树（首页那一排卡片）。
    删除父节点时子节点一并删除（枝断则叶落），由 CASCADE 保证。

    owner 为空是历史数据：单口令时代没有用户，第一个注册的人会认领它们。
    """

    owner = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.CASCADE, related_name="nodes"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="children"
    )
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["parent"]), models.Index(fields=["owner"])]

    def __str__(self) -> str:
        return "%s#%s" % (self.title, self.pk)

    def ancestors(self):
        """从根到自己的祖先链（不含自身）。"""
        out, cur, guard = [], self.parent, 0
        while cur is not None and guard < 200:
            out.append(cur)
            cur = cur.parent
            guard += 1
        return list(reversed(out))


class Share(models.Model):
    """只读分享：一枚 token 对应一棵子树。"""

    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name="shares")
    token = models.CharField(max_length=32, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
