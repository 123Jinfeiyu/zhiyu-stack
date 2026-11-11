"""本地开发入口：数据和发布用的那份分开。

为什么要分开：发布是「整目录上传」，如果 `data/db.sqlite3` 在发布目录里，
你本机这份库就会被传上去，把服务器上用户真正写下的笔记覆盖掉。
所以本地开发走 `.localdata/`，`data/` 只留口令与密钥两个小文件。

    python serve_dev.py        # 本地，端口 PORT 或 8000
    python serve.py            # 服务器（data/ 下自建库）
"""
import os
import runpy
from pathlib import Path

BASE = Path(__file__).resolve().parent
os.environ.setdefault("ZY_DATA_DIR", str(BASE / ".localdata"))
Path(os.environ["ZY_DATA_DIR"]).mkdir(parents=True, exist_ok=True)

runpy.run_path(str(BASE / "serve.py"), run_name="__main__")
