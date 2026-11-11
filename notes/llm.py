"""DeepSeek（OpenAI 兼容接口）客户端 —— 只服务「业务知识图谱」的命名与洞察。

三条原则：

1. **密钥只在服务端**。前端永远看不见 key，`/api/kg` 和 `/api/*` 都不会把它吐出去。
   配置来源：环境变量 ZY_LLM_KEY 优先，其次 DATA_DIR/llm.json（随项目上传）。
2. **失败必须软着陆**。没网、超时、配额用完、返回的不是 JSON —— 一律返回 None，
   图谱退回本地算法起的名字。一个锦上添花的功能不能把主功能拖死。
3. **按内容指纹缓存**。同一批枝梳理过一次就不再花 token；枝有改动（hash 变了）才重算。
   缓存文件：DATA_DIR/kg_ai_cache.json。
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings

DEFAULTS = {
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "timeout": 28,
}

_SYSTEM = (
    "你是一位资深的客服/运营业务分析师。用户会把一棵「业务笔记树」压缩成的若干簇交给你，"
    "每簇有：自动抽取的关键概念、覆盖枝数、几条代表枝的标题与片段；"
    "另外还会给一份 `rules`：已经从原文里抽出来的**触发规则**（什么条件/顺序之下才做什么动作）。\n"
    "请完成两件事：\n"
    "1. 给每个簇起一个**业务人能秒懂的名字**（4~10 个字，不要用「簇一」「主题A」这类空话，"
    "要指出真实的业务场景，例如「小金额还款与共管账户」「资方拒收后的归属判断」）；\n"
    "2. 用一句话概括这簇在讲什么（30~50 字，说清「什么情况下、按什么规则、结果如何」），"
    "并给 3 条可执行的要点（每条 15 字以内，动词开头）。\n"
    "**如果某簇涉及触发条件（例如「过了当天划扣时间、系统不再自动扣款，才让客户转对公账户」），"
    "名字或概括里必须带上这个条件** —— 业务上错的是条件，不是动作本身。\n"
    "另外给一句整体洞察（不超过 60 字），指出这几条业务线之间的关系或最容易被做错的地方。\n"
    "只输出 JSON，不要 markdown 代码块，不要解释。格式：\n"
    '{"insight":"……","clusters":[{"key":"c1","name":"……","summary":"……",'
    '"points":["……","……","……"]}]}\n'
    "key 必须原样使用用户给的簇 key。"
)


def config() -> dict:
    cfg = dict(DEFAULTS)
    cfg["apiKey"] = os.environ.get("ZY_LLM_KEY") or ""
    if os.environ.get("ZY_LLM_BASE"):
        cfg["baseUrl"] = os.environ["ZY_LLM_BASE"]
    if os.environ.get("ZY_LLM_MODEL"):
        cfg["model"] = os.environ["ZY_LLM_MODEL"]

    p = Path(settings.DATA_DIR) / "llm.json"
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 —— 配置坏了就当没配
            data = {}
        if isinstance(data, dict):
            for k in ("apiKey", "api_key", "key"):
                if not cfg["apiKey"] and data.get(k):
                    cfg["apiKey"] = str(data[k]).strip()
                    break
            if data.get("baseUrl"):
                cfg["baseUrl"] = str(data["baseUrl"]).strip()
            if data.get("model"):
                cfg["model"] = str(data["model"]).strip()
            if data.get("timeout"):
                try:
                    cfg["timeout"] = max(5, min(60, int(data["timeout"])))
                except Exception:  # noqa: BLE001
                    pass
    cfg["baseUrl"] = cfg["baseUrl"].rstrip("/")
    return cfg


def available() -> bool:
    return bool(config().get("apiKey"))


def _safe_url(base: str) -> bool:
    """只允许 https 公网地址：密钥会被塞进请求头，不能让它流向内网或本机。"""
    try:
        u = urlparse(base)
    except Exception:  # noqa: BLE001
        return False
    if u.scheme != "https" or not u.hostname:
        return False
    try:
        ip = ipaddress.ip_address(u.hostname)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local)
    except ValueError:
        try:
            ips = {i[4][0] for i in socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)}
        except Exception:  # noqa: BLE001 —— 解析不了就让 urllib 去报
            return True
        for raw in ips:
            try:
                if ipaddress.ip_address(raw).is_private:
                    return False
            except ValueError:
                continue
        return True


def chat(messages, cfg: dict | None = None) -> str | None:
    cfg = cfg or config()
    if not cfg.get("apiKey"):
        return None
    if not _safe_url(cfg["baseUrl"]):
        return None
    body = json.dumps({
        "model": cfg["model"],
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1600,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["baseUrl"] + "/chat/completions",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg["apiKey"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None
    try:
        data = json.loads(raw)
        return data["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        return None


def _parse_json(text: str) -> dict | None:
    """模型偶尔会套一层 ```json，或者前后多一句话 —— 都削掉再解析。"""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        data = json.loads(t)
        return data if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        pass
    i, j = t.find("{"), t.rfind("}")
    if 0 <= i < j:
        try:
            data = json.loads(t[i : j + 1])
            return data if isinstance(data, dict) else None
        except Exception:  # noqa: BLE001
            return None
    return None


def enhance(payload: dict) -> tuple[dict | None, str]:
    """返回 (结果, 说明)。说明是给前端显示的失败原因，不含任何密钥。"""
    cfg = config()
    if not cfg.get("apiKey"):
        return None, "没配密钥，图谱用的是本地语义分析"

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    text = chat(messages, cfg)
    if not text:
        return None, "模型暂时没回应（网络或配额），已用本地语义分析"
    data = _parse_json(text)
    if not data or not isinstance(data.get("clusters"), list):
        return None, "模型返回的格式不对，已用本地语义分析"
    return data, "deepseek"


# ---------------------------------------------------------------- 缓存


def _cache_path() -> Path:
    return Path(settings.DATA_DIR) / "kg_ai_cache.json"


def load_cache(hash_: str) -> dict | None:
    p = _cache_path()
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if isinstance(data, dict) and data.get("hash") == hash_ and isinstance(data.get("ai"), dict):
        return data["ai"]
    return None


def save_cache(hash_: str, ai: dict) -> None:
    p = _cache_path()
    try:
        p.write_text(
            json.dumps({"hash": hash_, "ai": ai, "at": int(__import__("time").time())}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001 —— 缓存写不进去不影响返回结果
        pass
