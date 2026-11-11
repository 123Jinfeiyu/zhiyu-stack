"""单端口启动脚本：迁移 → 播种 → 起服务。

平台只要求「一个端口上跑一个 HTTP 服务」，所以这个脚本就是发布时的入口：
    python serve.py
端口从环境变量 PORT 取（默认 8000），监听 0.0.0.0。
"""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENDOR = BASE_DIR / "vendor" / "pylib"
if VENDOR.is_dir() and str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "server.settings")

import django  # noqa: E402
from django.core.management import call_command  # noqa: E402

django.setup()

call_command("migrate", interactive=False, verbosity=1)
call_command("seed", verbosity=1)

from django.core.management import execute_from_command_line  # noqa: E402

port = os.environ.get("PORT") or "8000"
print("[zhiyu] 起服务 0.0.0.0:%s" % port, flush=True)
execute_from_command_line(["manage.py", "runserver", "0.0.0.0:%s" % port, "--noreload"])
