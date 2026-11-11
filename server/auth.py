"""登录态：数据库里的用户 + 自签名 cookie。

为什么不用 Django 的 session / auth 应用：
  · 这个应用只有一个 INSTALLED_APPS，引 session 表 + auth 中间件会多出一堆表和迁移；
  · 我们只要「这是谁」和「改密码后旧 cookie 作废」两件事，HMAC 签名足够。

cookie 里是 `uid.签发时间.签名`，签名密钥 = SECRET_KEY + 该用户密码哈希的前缀，
所以改密码（或换 SECRET_KEY）会让所有旧 cookie 立刻失效。
"""
from __future__ import annotations

import hashlib
import hmac
import re
import time
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import check_password as _dj_check
from django.contrib.auth.hashers import make_password as _dj_make

USERNAME_MIN, USERNAME_MAX = 2, 20
PASSWORD_MIN = 6
PASSWORD_MAX = 128

_USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fa5.-]+$", re.UNICODE)


# ------------------------------------------------------------------ 注册校验


def clean_username(raw) -> str:
    name = str(raw or "").strip()
    if len(name) < USERNAME_MIN:
        raise ValueError("用户名至少 %d 个字" % USERNAME_MIN)
    if len(name) > USERNAME_MAX:
        raise ValueError("用户名最多 %d 个字" % USERNAME_MAX)
    if not _USERNAME_RE.match(name):
        raise ValueError("用户名只能用中文、字母、数字、下划线、点和横线")
    return name


def clean_password(raw) -> str:
    pw = str(raw or "")
    if len(pw) < PASSWORD_MIN:
        raise ValueError("密码至少 %d 位" % PASSWORD_MIN)
    if len(pw) > PASSWORD_MAX:
        raise ValueError("密码太长了")
    return pw


def hash_password(raw: str) -> str:
    return _dj_make(raw)


def verify_password(user, raw) -> bool:
    if user is None or not raw:
        return False
    try:
        return _dj_check(str(raw), user.pw_hash)
    except Exception:
        # 哈希格式坏掉（手改过库）时当作验证失败，不要 500
        return False


# ------------------------------------------------------------------ 邀请码


def _invite_file() -> Path:
    return Path(settings.DATA_DIR) / "invite_codes.txt"


def invite_codes() -> list[str]:
    """有效邀请码列表。文件不存在或为空 → 空列表（= 邀请码非必填）。"""
    p = _invite_file()
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def invite_required() -> bool:
    return bool(invite_codes())


def check_invite(code) -> bool:
    """没配置名单时一律通过（邀请码选填）；配置了就必须在名单里。"""
    codes = invite_codes()
    if not codes:
        return True
    given = str(code or "").strip()
    if not given:
        return False
    for c in codes:
        # 都转 bytes 再比：compare_digest 遇到非 ASCII 的 str 会抛 TypeError
        if hmac.compare_digest(c.encode("utf-8"), given.encode("utf-8")):
            return True
    return False


# ------------------------------------------------------------------ token


def _secret_for(user) -> bytes:
    return (settings.SECRET_KEY + "|" + (user.pw_hash or "")[:40]).encode("utf-8")


def issue_token(user, now: int | None = None) -> str:
    ts = str(int(now if now is not None else time.time()))
    msg = "%s.%s" % (user.pk, ts)
    sig = hmac.new(_secret_for(user), msg.encode("utf-8"), hashlib.sha256).hexdigest()
    return msg + "." + sig


def _parse(token: str):
    parts = (token or "").split(".")
    if len(parts) != 3:
        return None
    uid, ts, sig = parts
    if not uid.isdigit() or not ts.isdigit():
        return None
    return int(uid), int(ts), sig


def token_ok(token: str, now: int | None = None) -> bool:
    from notes.models import User  # 延迟导入：models 要等 app registry 就绪

    parsed = _parse(token)
    if parsed is None:
        return False
    uid, ts, sig = parsed
    cur = int(now if now is not None else time.time())
    if ts - cur > 300:  # 时间来自未来（超过 5 分钟）视为伪造
        return False
    if cur - ts > settings.AUTH_TTL:
        return False
    user = User.objects.filter(pk=uid).first()
    if user is None:
        return False
    want = hmac.new(_secret_for(user), ("%s.%s" % (uid, ts)).encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, want)


def token_age(token: str, now: int | None = None) -> int:
    """token 已经签发多久了（秒）；解析不了返回一个很大的数。"""
    parsed = _parse(token)
    if parsed is None:
        return 10 ** 9
    cur = int(now if now is not None else time.time())
    return cur - parsed[1]


def current_user(request):
    from notes.models import User

    token = request.COOKIES.get(settings.AUTH_COOKIE, "")
    parsed = _parse(token)
    if parsed is None or not token_ok(token):
        return None
    return User.objects.filter(pk=parsed[0]).first()


def is_logged_in(request) -> bool:
    return current_user(request) is not None


def set_cookie(response, request, user):
    response.set_cookie(
        settings.AUTH_COOKIE,
        issue_token(user),
        max_age=settings.AUTH_TTL,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure(),
        path="/",
    )
    return response


def clear_cookie(response):
    response.delete_cookie(settings.AUTH_COOKIE, path="/")
    return response
