"""首次启动时种一棵示例树 —— 空页面没人知道该怎么用。"""
from django.core.management.base import BaseCommand

from notes.models import Node

SEED = [
    {
        "title": "枝语 · 使用说明",
        "content": "这是一棵**可以钻进去的**笔记树。\n\n每张卡片是一根枝，点进去看它的 subtree。"
        "没有文件夹、没有侧边栏，位置就写在面包屑里。",
        "kids": [
            {
                "title": "怎么钻取",
                "content": "1. 点卡片**标题**钻进下一层\n2. 点面包屑退回来\n3. 地址栏会跟着变，刷新不会丢位置",
                "kids": [
                    {"title": "为什么不是文件夹", "content": "文件夹只有一层真相，而想法是长出来的。\n\n> 你不需要先想好它该放哪，先写，再从上面长出下一枝。"},
                    {"title": "深一点也没关系", "content": "钻到第 5、6 层都正常 —— 面包屑会横向滚动，小地图永远能一键跳回。"},
                ],
            },
            {
                "title": "Markdown 支持什么",
                "content": "标题、列表、代码块、引用、粗体、斜体、删除线、链接、图片，都有。\n\n```js\nconst idea = grow('from a seed');\n```",
            },
            {
                "title": "快捷键",
                "content": "- `n` 新建一枝\n- `Esc` 退一层（编辑器打开时先关编辑器）\n- `Ctrl/⌘ + Enter` 保存\n- `/` 聚焦搜索",
            },
        ],
    },
    {
        "title": "这周要做的事",
        "content": "写到一半就可以丢进来，不用整理。",
        "kids": [
            {"title": "把毕设的第三章骨架搭出来", "content": "先列标题，不要写正文。\n\n- [ ] 3.1 问题定义\n- [ ] 3.2 数据来源\n- [ ] 3.3 建模思路"},
            {"title": "刷完科目一数字专项", "content": "扣分题还差 30 道。**别背题，背数字族谱。**"},
        ],
    },
    {
        "title": "一句可以长的句子",
        "content": "「把想法写下来」和「把想法种下去」的区别在于：\n\n写下来的会结束，种下去的会长。",
    },
]


def _build(items, parent=None):
    for item in items:
        node = Node.objects.create(parent=parent, title=item["title"], content=item.get("content", ""))
        if item.get("kids"):
            _build(item["kids"], node)


class Command(BaseCommand):
    help = "库为空时写入示例树"

    def handle(self, *args, **opts):
        if Node.objects.exists():
            if opts.get("verbosity", 1):
                self.stdout.write("[zhiyu] 已有数据，跳过播种")
            return
        _build(SEED)
        if opts.get("verbosity", 1):
            self.stdout.write("[zhiyu] 已播种 %d 根枝" % Node.objects.count())
