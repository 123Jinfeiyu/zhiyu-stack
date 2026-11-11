"""Django 配置 —— 刻意保持极简。

没有 session / auth / admin / csrf 中间件：
  · 鉴权用的是自签名的 httpOnly cookie（见 server/auth.py），不依赖数据库里的用户表；
  · 所有接口只吃 JSON，且 cookie 是 SameSite=Lax + 写操作校验 Origin。
这样 INSTALLED_APPS 只有一个 notes，启动最快，依赖最少。
"""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ZY_DATA_DIR") or (BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
# 前端构建产物目录：叫 web 而不是 dist —— 发布时会跳过 dist/build/out 这类构建目录
DIST_DIR = BASE_DIR / "web"


def _read_or_create(name: str, factory) -> str:
    p = DATA_DIR / name
    if p.exists():
        v = p.read_text(encoding="utf-8").strip()
        if v:
            return v
    v = factory()
    p.write_text(v, encoding="utf-8")
    return v


SECRET_KEY = os.environ.get("ZY_SECRET") or _read_or_create(
    "secret.txt", lambda: secrets.token_urlsafe(48)
)

DEBUG = os.environ.get("ZY_DEBUG") == "1"
ALLOWED_HOSTS = ["*"]
APPEND_SLASH = False

INSTALLED_APPS = ["notes"]
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "server.urls"
WSGI_APPLICATION = "server.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [DIST_DIR],
        "APP_DIRS": False,
        "OPTIONS": {"context_processors": []},
    }
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        "OPTIONS": {"timeout": 20},
    }
}

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = False
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Vite 的产物落在 frontend/dist，静态前缀是 /assets/
STATIC_URL = "/assets/"
STATIC_ROOT = DIST_DIR / "assets"
STATICFILES_DIRS = []

# 登录态
AUTH_COOKIE = "zhiyu_auth"
AUTH_TTL = 7 * 24 * 3600

# 写操作的 Origin 白名单。线上跑在反向代理后面（CloudStudio 网关），容器里收到的
# Host 头不一定等于浏览器地址栏里的域名，所以除了请求头里能拿到的 host，还允许
# 用环境变量 ZY_ORIGINS 显式声明「本站的公开地址」（逗号分隔，带不带协议都行）。
PUBLIC_ORIGINS = [
    part.strip()
    for part in (os.environ.get("ZY_ORIGINS") or "").split(",")
    if part.strip()
]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
