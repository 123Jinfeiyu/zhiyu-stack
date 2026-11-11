"""WSGI 入口。兼容 gunicorn / uwsgi 直接指过来，也兼容 python serve.py。"""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
VENDOR = BASE_DIR / "vendor" / "pylib"
if VENDOR.is_dir() and str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "server.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
