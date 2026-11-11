"""AI 业务知识图谱：把「一林子枝」压成一张能看懂的图。

三层，每层都说得出理由：

  1. **概念** —— 从标题 + 正文里长出来的中文词：跨枝高频（df ≥ 阈值）的 2~4 字片段，
     去掉虚词边界，并且抑制「子串」——「对公账户」被选中时不再单独留一个「公账户」。
  2. **关系** —— 两个概念同时出现在多少枝里（共现次数）。不用语义相似度：
     共现可解释，点开一条边就能列出「哪些枝同时提到了它们」。
  3. **业务线** —— 概念图上的标签传播（确定性：按权重排序 + 字典序打破平票，
     不用随机数），每簇用权重最高的一两个概念命名。

DeepSeek 只做锦上添花的那一层：给业务线起人话名字、写一句概括和三个要点。
它**不参与构图** —— 图的结构永远来自数据本身，模型挂了、没网、没配额，
图谱照样能看，只是名字朴素一点。
"""
from __future__ import annotations

import hashlib
import math
import re
import time
from collections import Counter, defaultdict

# ---------------------------------------------------------------- 词表

# 只做「边界/碎片」过滤：出现这些字的片段一律不要（「资方的」「还款了呢」）。
# ※ 别往里加「还、更、最、对、为、以、在、有、不、要、会」——它们是好词的开头：
#   「还款」「更新」「最低还款」「对公账户」「为什么」「在线」「不良」「要求」「会话」。
STOP_CHARS = set("的了着和与及或都而也很太又再才只被把给让向从于之其此那哪个些么呢吧啊呀嘛哦嗯")

STOP_WORDS = {
    # 人称 / 称呼
    "我们", "你们", "他们", "她们", "自己", "别人", "大家", "客户", "用户", "对方",
    "您好", "你好", "请问", "辛苦", "麻烦", "稍等", "感谢", "谢谢", "再见",
    # 指代 / 疑问
    "什么", "怎么", "怎样", "为什么", "哪里", "哪儿", "这个", "那个", "这些", "那些",
    "这种", "那种", "这样", "那样", "这么", "那么", "有些", "有的", "其他", "其它",
    # 情态 / 连接
    "可以", "可能", "需要", "应该", "必须", "不能", "不是", "没有", "不要", "不用",
    "不会", "不用", "就是", "还是", "只是", "而是", "但是", "不过", "然后", "因为",
    "所以", "如果", "虽然", "而且", "并且", "或者", "以及", "对于", "关于", "通过",
    "根据", "由于", "按照", "作为", "同时", "另外", "此外", "因此", "于是",
    # 通用名词 / 泛动词
    "时候", "时间", "问题", "情况", "方面", "东西", "事情", "地方", "部分", "内容",
    "方式", "方法", "过程", "结果", "原因", "进行", "出现", "使用", "知道", "觉得",
    "认为", "表示", "说明", "包括", "属于", "成为", "具有", "存在", "发生", "开始",
    "结束", "继续", "保持", "提供", "确认", "核实", "查询", "咨询", "处理", "了解",
    # 方位 / 时间
    "这里", "那里", "上面", "下面", "前面", "后面", "里面", "外面", "中间",
    "已经", "正在", "将要", "刚刚", "马上", "立刻", "现在", "目前", "之后", "之前",
    "以后", "以前", "当时", "今天", "明天", "昨天",
    # 程度 / 序数
    "非常", "比较", "特别", "十分", "有点", "稍微", "更加", "最好", "至少", "几乎",
    "大概", "一句话", "第一", "第二", "第三", "首先", "其次", "最后", "一次", "一下",
    "一些", "一样", "一定", "一直", "一起", "一般", "一边", "这个",
    # 话术里的口水词 / 泛动作（出现在正文里太多，做概念节点没有信息量）
    "帮您", "为您", "给您", "告知", "联系", "建议", "无法", "不能", "可以", "需要",
    "客户认可", "核实", "核对", "反馈", "记录", "表示", "进行", "沟通", "说明",
    "辛苦您", "请您", "抱歉", "感谢您", "请问您", "麻烦您",
    "直接", "要求", "工作", "业务", "自动", "人工", "一下", "这边", "那边",
    "认可", "支持", "理解", "耐心等待", "开具", "收到", "明白", "确认", "同意",
    "相关", "有关", "以上", "以下", "其中", "一般情况",
}

# 以这些字开头的片段基本是量词/指示语切出来的残片（「笔订单」「户认可」「这个」）。
# ※ 别放「大、小、中、上、下」——「大额」「小金额」「中间账户」都是真业务词。
BAD_HEAD = set("笔个位次元条份张句天年月日点种户您我你他她它这那哪每各某该本咱")

# 含这些片段就整条丢掉：「客户认可」「帮您查询」这类话术残片，
# 靠 STOP_WORDS 的整词匹配拦不住（它们不是独立的词，是拼出来的）。
STOP_FRAGMENTS = (
    "客户", "我们", "你们", "他们", "自己", "别人", "帮您", "为您", "给您", "请问",
    "辛苦", "麻烦", "抱歉", "感谢", "稍等", "可以", "需要", "不能", "无法", "告知",
    "联系", "建议", "核对", "核实", "反馈", "记录", "进行", "表示", "说明", "沟通",
)

CJK_RUN = re.compile(r"[\u4e00-\u9fa5]+")

MAX_TERMS = 30          # 图上最多画多少个概念
MAX_CLUSTERS = 7        # 业务线最多几条（再多颜色就分不清了）
MAX_TERM_LINKS = 4      # 一个概念最多连出去几条边，避免一团毛线


# ---------------------------------------------------------------- 抽取


def _score(term: str, df: int) -> float:
    """排序分：覆盖面为主，长词略微加分（「对公账户」比「账户」信息量大）。"""
    return df * (1 + 0.25 * (len(term) - 2))


def extract_terms(docs: dict, max_terms: int = MAX_TERMS):
    """docs: {枝 id: 文本} → [(词, df, [枝 id...])]，按分数降序。"""
    n = len(docs)
    if n == 0:
        return []
    min_df = max(2, int(math.ceil(n * 0.015)))

    df = Counter()
    where = defaultdict(list)
    for nid, text in docs.items():
        seen = set()
        for run in CJK_RUN.findall(text or ""):
            L = len(run)
            for size in (2, 3, 4):
                if L < size:
                    continue
                for i in range(L - size + 1):
                    g = run[i : i + size]
                    if g in STOP_WORDS or any(ch in STOP_CHARS for ch in g):
                        continue
                    if g[0] in BAD_HEAD:
                        continue
                    if any(f in g for f in STOP_FRAGMENTS):
                        continue
                    if g not in seen:
                        seen.add(g)
                        df[g] += 1
                        where[g].append(nid)

    cand = [g for g in df if df[g] >= min_df]
    # 先长后短：长词先占位，短词只有在「显著更常见」时才算独立概念
    cand.sort(key=lambda g: (-len(g), -df[g], g))
    kept = []
    for g in cand:
        if any(g in k and g != k and df[g] <= df[k] * 1.6 for k in kept):
            continue
        kept.append(g)

    kept.sort(key=lambda g: (-_score(g, df[g]), -len(g), g))
    kept = kept[:max_terms]
    return [(g, df[g], where[g]) for g in kept]


# ---------------------------------------------------------------- 关系


def build_links(terms, docs):
    """概念共现：两词同时出现在多少枝里。返回 {(i, j): 次数}（i < j）。"""
    idx = {name: i for i, (name, _df, _ids) in enumerate(terms)}
    hits = defaultdict(list)
    for i, (_name, _df, ids) in enumerate(terms):
        for nid in ids:
            hits[nid].append(i)

    weight = {i: terms[i][1] for i in idx.values()}
    co = Counter()
    for _nid, ids in hits.items():
        # 一枝命中太多概念时只留权重最高的那些，否则每一枝都变成全连接
        if len(ids) > 14:
            ids = sorted(ids, key=lambda i: (-weight[i], i))[:14]
        ids = sorted(ids)
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                co[(ids[a], ids[b])] += 1

    # 只留「至少两枝同时提到」的边，再给每个概念留最强的那几条
    strong = {k: v for k, v in co.items() if v >= 2}
    per_node = defaultdict(list)
    for (a, b), w in strong.items():
        per_node[a].append((w, b))
        per_node[b].append((w, a))
    keep = set()
    for i, arr in per_node.items():
        for w, j in sorted(arr, key=lambda t: (-t[0], t[1]))[:MAX_TERM_LINKS]:
            keep.add((min(i, j), max(i, j)))
    return {k: strong[k] for k in keep}


# ---------------------------------------------------------------- 触发规则
#
# 共现只说明「这两个词老一起出现」，说不出「谁先谁后、在什么条件下」。
# 业务上真正要记住的偏偏是后一种，比如：
#   「还款过了当天划扣时间（系统不再自动划扣）→ 才引导客户往对公账户转账」
# 所以单独一层，抽**有向**的规则：
#   1. 显式规则 RULES —— 业务方确认过的口径，写死在代码里，不靠猜；
#   2. 文本句式 —— 「过了X才Y」「先X再Y」「如果X就Y」「因为X所以Y」，
#      两端都要能对上图里的概念，对不上就不编。
# 规则两端的概念如果词频太低进不了 top30，会被强行补进图 —— 规则必须画得出来。

RULES = [
    {
        "if": "划扣",
        "then": "对公",
        "kind": "cond",
        "short": "过了划扣时间",
        "say": "还款过了当天划扣时间（系统不再自动划扣）→ 才引导客户线下对公转账",
        "why": "没过划扣时间要等系统自动扣；提前给账户，客户转一次、系统再扣一次，就成重复扣款",
    },
]

# (正则, 左段组号, 右段组号, 类型)。左段是前置条件/原因，右段是结果。
CAUSE_PATTERNS = [
    (r"过了([^。；\n｜|→]{2,12}?)(?:，|,)?(?:才|才能|才可|再)([^。；\n｜|→]{2,16})", 1, 2, "cond"),
    (r"只有([^。；\n｜|→]{2,12}?)(?:，|,)?才(?:能)?([^。；\n｜|→]{2,16})", 1, 2, "cond"),
    (r"如果([^。；\n｜|→]{2,12}?)(?:，|,)?(?:就|则)([^。；\n｜|→]{2,16})", 1, 2, "cond"),
    (r"([^。；\n｜|→]{2,12}?)之后(?:，|,)?(?:才|再)([^。；\n｜|→]{2,16})", 1, 2, "seq"),
    (r"先([^。；\n｜|→]{2,10}?)[，,](?:再|然后)([^。；\n｜|→]{2,16})", 1, 2, "seq"),
    (r"因为([^。；\n｜|→]{2,12}?)[，,]?\s*所以([^。；\n｜|→]{2,16})", 1, 2, "cause"),
]

KIND_LABEL = {"cond": "条件", "seq": "顺序", "cause": "因果"}


def _find_term(frag: str, names) -> str:
    """把一个自由文本片段对到图里的概念：取最长那个（越具体越准）。"""
    best = ""
    f = (frag or "").strip()
    if len(f) < 2:
        return ""
    for n in names:
        if len(n) < 2:
            continue
        if n in f or f in n:
            if len(n) > len(best):
                best = n
    return best


def ensure_rule_terms(terms, docs, max_terms: int = MAX_TERMS):
    """显式规则用到的词，词频再低也要留在图里（放在末尾，不抢业务线命名）。"""
    names = [t[0] for t in terms]
    extra, taken = [], set(names)
    for r in RULES:
        for kw in (r["if"], r["then"]):
            if any(kw in n for n in taken):
                continue
            ids = sorted(nid for nid, text in docs.items() if kw in text)
            if len(ids) >= 2:
                extra.append((kw, len(ids), ids))
                taken.add(kw)
    if not extra:
        return terms
    keep = max(1, max_terms - len(extra))
    return list(terms[:keep]) + extra


def build_rules(terms, docs, limit: int = 8):
    """返回有向规则（用概念下标表示两端）：[{"a","b","kind","label","say","why","branches","source"}]。"""
    names = [t[0] for t in terms]
    rows = []  # 同 (a,b,kind) 合并

    def add(a_name, b_name, kind, label, branches, say="", why="", source="text", short=""):
        if not a_name or not b_name or a_name == b_name:
            return
        try:
            a, b = names.index(a_name), names.index(b_name)
        except ValueError:
            return
        key = (a, b, kind)
        for row in rows:
            if row["key"] == key:
                row["branches"] = sorted(set(row["branches"]) | set(branches))
                if len(label) < len(row["label"]):
                    row["label"] = label
                if short and not row["short"]:
                    row["short"] = short
                if say and not row["say"]:
                    row["say"] = say
                if why and not row["why"]:
                    row["why"] = why
                return
        rows.append({
            "key": key, "a": a, "b": b, "kind": kind,
            "label": label, "short": short, "say": say, "why": why,
            "branches": sorted(set(branches)), "source": source,
        })

    # 1) 显式规则
    for r in RULES:
        a_name = _find_term(r["if"], names)
        b_name = _find_term(r["then"], names)
        if not a_name or not b_name:
            continue
        both = [
            nid for nid, text in docs.items()
            if r["if"] in text and r["then"] in text
        ]
        only = [nid for nid, text in docs.items() if r["if"] in text]
        if not (both or only):
            # 语料里根本没提这件事 —— 硬画一条没有出处的规则，就是在编
            continue
        add(
            a_name, b_name, r["kind"], r["say"], both or only[:8],
            say=r["say"], why=r["why"], source="rule", short=r.get("short") or "",
        )

    # 2) 文本句式
    for nid, text in sorted(docs.items()):
        for pat, gi, gj, kind in CAUSE_PATTERNS:
            for m in re.finditer(pat, text):
                left, right = _clip(m.group(gi), 12), _clip(m.group(gj), 12)
                # 「先还款当期款项后，再…」里那个「后」是句式带出来的，标签里去掉更像人话
                if kind == "seq" and left.endswith("后") and len(left) > 3:
                    left = left[:-1]
                if kind == "seq" and left.startswith("先"):
                    left = left[1:]
                a_name, b_name = _find_term(left, names), _find_term(right, names)
                if not a_name or not b_name or a_name == b_name:
                    continue
                add(a_name, b_name, kind, left + " → " + right, [nid], short=_clip(left, 8))

    # 文本规则如果整段出处都被某条显式规则覆盖（同一个起点），就不再重复画一遍
    explicit = [r for r in rows if r["source"] == "rule"]
    rows = [
        r for r in rows
        if r["source"] == "rule"
        or not any(e["a"] == r["a"] and set(r["branches"]) <= set(e["branches"]) for e in explicit)
    ]
    rows.sort(key=lambda r: (r["source"] != "rule", -len(r["branches"]), r["a"], r["b"]))
    return rows[:limit]


# ---------------------------------------------------------------- 聚类


def _jaccard(a: int, b: int, terms) -> float:
    """两词覆盖的枝有多重合。用 Jaccard 而不是「交集/较小者」：
    后者会让「还款」这种到处出现的词跟谁都像，最后全被吸进一个簇。"""
    sa, sb = set(terms[a][2]), set(terms[b][2])
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def cluster_terms(terms, limit: int) -> list:
    """层次聚类（average linkage），切到 limit 簇。

    为什么不用标签传播：概念图几乎是个稠密图（同一枝里什么词都有），
    传播两轮就会把全部概念染成同一种颜色 —— 试过，152 枝最后只剩 1 簇。
    层次聚类按「共现重合度」自下而上合并，能留住「账户类」「工单类」这种细分。
    """
    n = len(terms)
    groups = [[i] for i in range(n)]
    if n == 0:
        return []
    cache: dict = {}

    def sim(g1, g2) -> float:
        key = (id(g1), id(g2))
        if key in cache:
            return cache[key]
        vals = [_jaccard(a, b, terms) for a in g1 for b in g2]
        v = sum(vals) / len(vals) if vals else 0.0
        cache[key] = v
        return v

    while len(groups) > max(1, limit):
        best = None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                s = sim(groups[i], groups[j])
                if best is None or s > best[0]:
                    best = (s, i, j)
        if best is None:
            break
        _s, i, j = best
        groups[i] = groups[i] + groups[j]
        groups.pop(j)
        cache.clear()

    # 只剩一个概念的簇太孤单，并进跟它最像的那簇
    groups = [g for g in groups if g]
    if len(groups) > 2:
        singles = [g for g in groups if len(g) == 1]
        for s in singles:
            rest = [g for g in groups if g is not s]
            if not rest:
                break
            near = max(rest, key=lambda g: sim(s, g))
            near.extend(s)
            groups.remove(s)
            cache.clear()
    return groups


# ---------------------------------------------------------------- 组装


def _clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def build(nodes, max_terms: int = MAX_TERMS, max_clusters: int = MAX_CLUSTERS) -> dict:
    """nodes: [{"id","title","content"}] → 可直接 JSON 化的图谱。"""
    nodes = list(nodes or [])
    docs = {int(n["id"]): (str(n.get("title") or "") + "。" + str(n.get("content") or "")) for n in nodes}
    by_id = {int(n["id"]): n for n in nodes}

    if len(docs) < 3:
        return {
            "engine": "local",
            "stats": {"branches": len(docs), "concepts": 0, "links": 0, "clusters": 0, "coverage": 0, "rules": 0},
            "concepts": [], "links": [], "clusters": [], "rules": [], "insight": "",
            "empty": "枝还太少（至少 3 枝）—— 先种几枝，再来梳理。",
        }

    terms = extract_terms(docs, max_terms=max_terms)
    if not terms:
        return {
            "engine": "local",
            "stats": {"branches": len(docs), "concepts": 0, "links": 0, "clusters": 0, "coverage": 0, "rules": 0},
            "concepts": [], "links": [], "clusters": [], "rules": [], "insight": "",
            "empty": "这些枝还读不出共同的业务词 —— 写具体一点（谁、做什么、卡在哪），概念就长出来了。",
        }

    terms = ensure_rule_terms(terms, docs, max_terms=max_terms)
    links = build_links(terms, docs)
    rules = build_rules(terms, docs)

    weight = {i: terms[i][1] for i in range(len(terms))}
    groups = cluster_terms(terms, max_clusters)
    groups.sort(key=lambda g: (-sum(weight[i] for i in g), min(terms[i][0] for i in g)))

    clusters = []
    for ci, g in enumerate(groups):
        members = sorted(g, key=lambda i: (-weight[i], terms[i][0]))
        name_terms = [terms[i][0] for i in members]
        # 两枝代表：取簇内概念命中最多、内容最长的那几枝
        hit_count = Counter()
        for i in members:
            for nid in terms[i][2]:
                hit_count[nid] += 1
        reps = [
            nid
            for nid, _c in sorted(hit_count.items(), key=lambda kv: (-kv[1], kv[0]))[:2]
            if nid in by_id
        ]
        name = name_terms[0] if len(name_terms) == 1 else name_terms[0] + " · " + name_terms[1]
        clusters.append({
            "id": "c%d" % (ci + 1),
            "name": name,
            "terms": ["k%d" % (i + 1) for i in members],
            "size": len(members),
            "branches": len(hit_count),
            "summary": "共 %d 枝涉及，最常出现「%s」。%s" % (
                len(hit_count),
                "」「".join(name_terms[:3]),
                ("代表枝：" + "、".join(_clip(by_id[n]["title"], 14) for n in reps)) if reps else "",
            ),
            "points": [_clip(by_id[n]["title"], 24) for n in reps],
            "ai": False,
        })

    cluster_of = {}
    for c in clusters:
        for tid in c["terms"]:
            cluster_of[tid] = c["id"]

    concepts = []
    for i, (name, df, ids) in enumerate(terms):
        kid = "k%d" % (i + 1)
        concepts.append({
            "id": kid,
            "name": name,
            "df": df,
            "cluster": cluster_of.get(kid, ""),
            "branches": sorted(ids)[:12],
        })

    link_rows = []
    for (a, b), w in sorted(links.items(), key=lambda kv: (-kv[1], kv[0])):
        link_rows.append(["k%d" % (a + 1), "k%d" % (b + 1), w])

    covered = len({nid for _n, _d, ids in terms for nid in ids})
    rule_rows = [
        {
            "id": "r%d" % (n + 1),
            "from": "k%d" % (r["a"] + 1),
            "to": "k%d" % (r["b"] + 1),
            "kind": r["kind"],
            "kindLabel": KIND_LABEL.get(r["kind"], "条件"),
            "label": r["label"],
            "short": r["short"] or _clip(r["label"], 8),
            "say": r["say"],
            "why": r["why"],
            "branches": r["branches"][:12],
            "source": r["source"],
        }
        for n, r in enumerate(rules)
    ]
    return {
        "engine": "local",
        "stats": {
            "branches": len(docs),
            "concepts": len(concepts),
            "links": len(link_rows),
            "clusters": len(clusters),
            "rules": len(rule_rows),
            "coverage": round(covered / len(docs), 3),
        },
        "concepts": concepts,
        "links": link_rows,
        "clusters": clusters,
        "rules": rule_rows,
        "insight": "",
        "empty": "",
    }


def content_hash(nodes) -> str:
    """图的指纹：枝的标题 + 正文变了一点，AI 就得重算。"""
    h = hashlib.sha1()
    for n in sorted(nodes, key=lambda x: int(x["id"])):
        h.update(str(n["id"]).encode())
        h.update(b"\x00")
        h.update(str(n.get("title") or "").encode("utf-8"))
        h.update(b"\x00")
        h.update(str(n.get("content") or "").encode("utf-8"))
        h.update(b"\x01")
    return h.hexdigest()[:16]


def prompt_payload(graph: dict, nodes) -> dict:
    """交给模型的材料：只给概念簇 + 代表枝，不给全文（省 token，也免得塞进无关话术）。"""
    by_id = {int(n["id"]): n for n in nodes}
    out = []
    for c in graph["clusters"]:
        names = [x["name"] for x in graph["concepts"] if x["id"] in set(c["terms"])][:6]
        samples = []
        for tid in c["terms"][:6]:
            for nid in _branch_ids(graph, tid):
                n = by_id.get(nid)
                if n:
                    samples.append(_clip(n.get("title"), 18) + "：" + _clip(n.get("content"), 60))
                if len(samples) >= 4:
                    break
            if len(samples) >= 4:
                break
        out.append({"key": c["id"], "terms": names, "branches": c["branches"], "samples": samples[:4]})
    names = {c["id"]: c["name"] for c in graph.get("concepts") or []}
    rules = [
        {
            "rule": r.get("say") or r.get("label") or "",
            "kind": r.get("kindLabel") or "",
            "from": names.get(r.get("from"), ""),
            "to": names.get(r.get("to"), ""),
            "branches": len(r.get("branches") or []),
        }
        for r in (graph.get("rules") or [])[:8]
    ]
    return {
        "branches": graph["stats"]["branches"],
        "coverage": graph["stats"]["coverage"],
        "clusters": out,
        "rules": rules,
    }


def _branch_ids(graph, tid):
    for c in graph["concepts"]:
        if c["id"] == tid:
            return c["branches"]
    return []


def apply_ai(graph: dict, ai: dict) -> dict:
    """把模型给的业务线名字/概括贴回图上。字段不合规就原样返回（本地名字也不难看）。"""
    if not isinstance(ai, dict):
        return graph
    by_key = {}
    for row in ai.get("clusters") or []:
        if isinstance(row, dict) and row.get("key"):
            by_key[str(row["key"])] = row

    for c in graph["clusters"]:
        row = by_key.get(c["id"])
        if not row:
            continue
        name = _clip(row.get("name") or "", 18)
        summary = _clip(row.get("summary") or "", 120)
        if name:
            c["name"] = name
        if summary:
            c["summary"] = summary
        points = [p for p in (row.get("points") or []) if isinstance(p, str) and p.strip()][:4]
        if points:
            c["points"] = [_clip(p, 40) for p in points]
        c["ai"] = True
    insight = _clip(ai.get("insight") or "", 200)
    if insight:
        graph["insight"] = insight
    graph["engine"] = "deepseek"
    return graph


def now() -> int:
    return int(time.time())
