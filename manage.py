#!/usr/bin/env python
"""枝语 · 全栈版 —— Django 入口。

依赖是**内置**在 vendor/pylib 里的（Django 5.2 LTS 及其三个纯 Python 依赖），
所以服务器上不需要联网、也不需要 pip install。下面这三行 sys.path 就是在干这件事。
"""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENDOR = BASE_DIR / "vendor" / "pylib"
if VENDOR.is_dir() and str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "server.settings")


def main():
    from django.core.management import execute_from_command_line

    argv = sys.argv
    # 起服务前顺手把迁移做完 —— 这个应用只有一张表，部署时少一个手动步骤就少一次出错
    if len(argv) > 1 and argv[1] in ("runserver", "runserver_plus"):
        try:
            from django.core.management import call_command

            call_command("migrate", interactive=False, verbosity=0)
            call_command("seed", verbosity=0)
        except Exception as exc:  # noqa: BLE001 - 迁移失败时让下面的 runserver 报更明确的错
            print("[zhiyu] 自动迁移失败：%r" % (exc,), file=sys.stderr)

    execute_from_command_line(argv)


if __name__ == "__main__":
    main()
