<template>
  <div class="mask" :class="{ on: open }" @click="$emit('close')"></div>
  <section class="kg-panel" :class="{ on: open }" id="kgPanel">
    <header class="kg-head">
      <div class="kg-headline">
        <span class="kg-mark">◎</span>
        <div>
          <h2>业务知识图谱</h2>
          <p class="kg-sub" v-if="stats">
            {{ stats.branches }} 枝 · {{ stats.concepts }} 个业务概念 · {{ stats.clusters }} 条业务线 · 覆盖 {{ pct }}%
          </p>
          <p class="kg-sub" v-else>正在读你的树林…</p>
        </div>
      </div>
      <div class="kg-head-right">
        <span class="kg-engine" :class="{ on: isAI }" id="kgEngine" :title="engineTip">{{ engineText }}</span>
        <button class="act" id="kgRe" :disabled="loading || aiLoading" @click="reload">重新梳理</button>
        <button class="act export-act" id="kgExport" :disabled="exporting || !ready" @click="doExport">
          {{ exporting ? "生成中…" : "⤓ 导出图片" }}
        </button>
        <button class="act" id="kgClose" @click="$emit('close')">收起</button>
      </div>
    </header>

    <div class="kg-body">
      <div class="kg-canvas">
        <div v-if="loading" class="kg-hint">正在读你的树林…</div>
        <div v-else-if="empty" class="kg-hint" id="kgEmpty">{{ empty }}</div>
        <svg
          v-else
          ref="svgEl"
          id="kgSvg"
          class="kg-svg"
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="xMidYMid meet"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="onUp"
        >
          <g class="kg-links">
            <line
              v-for="l in linkViews"
              :key="l.key"
              class="kg-link"
              :class="{ hot: l.hot, dim: l.dim }"
              :x1="l.x1"
              :y1="l.y1"
              :x2="l.x2"
              :y2="l.y2"
              :stroke-width="l.w"
              :stroke-opacity="l.op"
            />
          </g>

          <!-- 有向规则：弧线 + 箭头 + 短标签。共现说不清"什么时候才做"，这一层说 -->
          <defs>
            <marker id="kgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto">
              <path class="kg-arrow" d="M0,0 L10,5 L0,10 Z" />
            </marker>
          </defs>
          <g class="kg-nodes">
            <g
              v-for="n in nodeViews"
              :key="n.id"
              class="kg-node"
              :class="{ hot: n.id === activeConcept, near: nearSet.has(n.id), dim: dimmed(n), dragging: drag && drag.id === n.id }"
              :transform="`translate(${n.x},${n.y})`"
              :data-id="n.id"
              @pointerdown="onDown(n, $event)"
              @click.stop="pickConcept(n)"
              @mouseenter="hoverId = n.id"
              @mouseleave="hoverId = ''"
            >
              <title>{{ n.name }} · {{ n.df }} 枝提到{{ cluster ? " · " + cluster.name : "" }}</title>
              <circle class="kg-halo" :r="n.r + 7" :fill="COLOR(n)" fill-opacity="0" />
              <circle
                class="kg-ball"
                :r="n.r"
                :fill="COLOR(n)"
                fill-opacity="0.14"
                :stroke="COLOR(n)"
                stroke-width="1.7"
              />
              <circle v-if="n.df >= 14" class="kg-core" :r="Math.max(3, n.r * 0.28)" :fill="COLOR(n)" fill-opacity="0.85" />
              <text
                class="kg-label"
                :y="n.r + 17"
                :font-size="n.name.length > 5 ? 12 : 13"
                text-anchor="middle"
              >
                {{ n.name }}
              </text>
            </g>
          </g>
          <g class="kg-rules" v-if="ruleViews.length">
            <g
              v-for="r in ruleViews"
              :key="r.id"
              class="kg-rule"
              :class="{ hot: r.hot, dim: r.dim, on: activeRule === r.id }"
              :data-rid="r.id"
              @click.stop="pickRule(r.id)"
            >
              <title>{{ r.kindLabel }}：{{ r.say || r.label }}</title>
              <path class="kg-rule-line" :d="r.d" :stroke="r.color" marker-end="url(#kgArrow)" />
              <g :transform="`translate(${r.lx},${r.ly})`">
                <rect class="kg-rule-bg" :x="-r.tw / 2 - 5" y="-9" :width="r.tw + 10" height="18" rx="9" />
                <text class="kg-rule-label" text-anchor="middle" y="4">{{ r.short }}</text>
              </g>
            </g>
          </g>

        </svg>

        <transition name="fade">
          <div v-if="aiLoading" class="kg-busy" id="kgBusy">✦ AI 正在读这 {{ stats ? stats.branches : "" }} 枝，提炼业务线…</div>
        </transition>
        <div v-if="!aiLoading && aiNote" class="kg-note" id="kgNote">{{ aiNote }}</div>
      </div>

      <aside class="kg-side">
        <!-- 选了一个概念：看它落在哪些枝上 -->
        <div v-if="concept" class="kg-detail" id="kgDetail">
          <button class="kg-back" id="kgBack" @click="activeConcept = ''">← 回到业务线</button>
          <h3 class="kg-detail-name">
            <span class="kg-dot" :style="{ background: COLOR(concept) }"></span>{{ concept.name }}
          </h3>
          <p class="kg-detail-meta">
            {{ concept.df }} 枝提到 · 属于「{{ clusterName(concept.cluster) }}」
          </p>
          <div class="kg-branch-list">
            <button
              v-for="b in conceptBranches"
              :key="b.id"
              class="kg-branch"
              @click="$emit('pick', b.id)"
            >
              <span>{{ b.title }}</span>
              <i>→</i>
            </button>
            <p v-if="!conceptBranches.length" class="kg-detail-meta">这枝里没有可跳转的记录。</p>
          </div>
        </div>

        <template v-else>
          <div v-if="graph && graph.insight" class="kg-insight" id="kgInsight">
            <span class="kg-insight-tag">✦ AI 洞察</span>
            <p>{{ graph.insight }}</p>
          </div>

          <!-- 触发规则：图上箭头的那几条，在这里能读完整个因果 -->
          <div v-if="rules.length" class="kg-rule-list" id="kgRules">
            <p class="kg-side-title">触发规则 <span>{{ rules.length }}</span></p>
            <button
              v-for="r in rules"
              :key="r.id"
              class="kg-rule-item"
              :class="{ on: activeRule === r.id }"
              :data-rid="r.id"
              @click="pickRule(r.id)"
            >
              <span class="kg-rule-head">
                <b class="kg-rule-kind">{{ r.kindLabel }}</b>
                <span class="kg-rule-short">{{ nameOf(r.from) }} → {{ nameOf(r.to) }}</span>
                <i>{{ r.branches.length }} 枝</i>
              </span>
              <span class="kg-rule-say">{{ r.say || r.label }}</span>
              <span v-if="r.why" class="kg-rule-why">{{ r.why }}</span>
            </button>
          </div>

          <p v-if="clusters.length" class="kg-side-title">业务线 <span>{{ clusters.length }}</span></p>
          <button
            v-for="c in clusters"
            :key="c.id"
            class="kg-line"
            :class="{ on: activeCluster === c.id }"
            :data-cid="c.id"
            @click="toggleCluster(c)"
          >
            <span class="kg-line-dot" :style="{ background: COLOR(c) }"></span>
            <span class="kg-line-main">
              <span class="kg-line-name">
                {{ c.name }}<em v-if="c.ai" title="由 AI 命名">✦</em>
              </span>
              <span class="kg-line-meta">{{ c.size }} 个概念 · {{ c.branches }} 枝</span>
              <span class="kg-line-desc">{{ c.summary }}</span>
              <span class="kg-points" v-if="c.points && c.points.length">
                <i v-for="(p, i) in c.points" :key="i">{{ p }}</i>
              </span>
            </span>
          </button>

          <p v-if="!loading && !clusters.length && !empty" class="kg-side-title">还没有业务线</p>
        </template>
      </aside>
    </div>

    <footer class="kg-foot">
      <span v-if="focusOn" class="kg-foot-focus">
        正在看「{{ focusName }}」
        <button class="act" @click="clearFocus">看全部</button>
      </span>
      <span v-else>
        点圆看它落在哪些枝 · <b>带箭头的弧线 = 触发规则</b>（谁在什么条件下才做）· 拖拽摆位置 · <b>Esc</b> 收起
      </span>
      <span class="kg-foot-right">{{ W }}×{{ H }} · 导出为 2 倍 PNG</span>
    </footer>
  </section>
</template>

<script setup>
/* 业务知识图谱面板。
 *
 * 数据两段来：
 *   1. /api/kg        —— 本地算法算出来的图（概念 / 共现 / 业务线），几百毫秒就到，先画；
 *   2. /api/kg/ai     —— 让 DeepSeek 把业务线改成业务人看得懂的名字，慢就慢点，不挡着图。
 * 所以打开面板先看到图，再看到名字「活过来」——这比转圈等到超时体面得多。
 *
 * 面板自己不碰网络之外的事：点枝只 emit('pick')，跳转交给 TreeView。
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { api } from "../api";
import { exportMapPng } from "../mapExport";
import { clusterColor, layoutKg, linkPath, ruleLabelPoint, rulePath, PALETTE } from "../kgForce";
import { toast } from "../ui";

const props = defineProps({
  open: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
});
const emit = defineEmits(["close", "pick"]);

const W = 1180;
const H = 700;

const svgEl = ref(null);
const graph = ref(null);
const loading = ref(false);
const aiLoading = ref(false);
const aiNote = ref("");
const empty = ref("");
const exporting = ref(false);
const activeConcept = ref("");
const activeCluster = ref("");
const activeRule = ref(""); // 选中的触发规则
const hoverId = ref("");
const pos = ref({});
const drag = ref(null);
let loadedOnce = false;

const stats = computed(() => (graph.value ? graph.value.stats : null));
const pct = computed(() => (stats.value ? Math.round((stats.value.coverage || 0) * 100) : 0));
const clusters = computed(() => (graph.value ? graph.value.clusters || [] : []));
const rules = computed(() => (graph.value ? graph.value.rules || [] : []));
const isAI = computed(() => !!(graph.value && graph.value.engine === "deepseek"));
const ready = computed(() => !!(graph.value && graph.value.concepts && graph.value.concepts.length));

const engineText = computed(() => {
  if (aiLoading.value) return "✦ 正在提炼";
  if (aiNote.value && !isAI.value) return "本地语义分析";
  return isAI.value ? "✦ DeepSeek 梳理" : "本地语义分析";
});
const engineTip = computed(() =>
  isAI.value
    ? "业务线名字与洞察由 DeepSeek 生成；图的结构来自共现统计"
    : "图与业务线名由本地词频/共现算法生成；配了模型密钥后会自动升级"
);

const layout = computed(() =>
  layoutKg(graph.value ? graph.value.concepts : [], graph.value ? graph.value.links : [], {
    width: W,
    height: H,
  })
);

watch(
  layout,
  (l) => {
    const m = {};
    for (const n of l.nodes) m[n.id] = { x: n.x, y: n.y };
    pos.value = m;
  },
  { immediate: true }
);

const nodeViews = computed(() =>
  layout.value.nodes.map((n) => {
    const p = pos.value[n.id];
    return p ? { ...n, x: p.x, y: p.y } : n;
  })
);

const nodeById = computed(() => new Map(nodeViews.value.map((n) => [n.id, n])));

const concept = computed(() => {
  if (!activeConcept.value) return null;
  return (graph.value ? graph.value.concepts : []).find((c) => c.id === activeConcept.value) || null;
});

const cluster = computed(() => {
  if (!activeCluster.value) return null;
  return clusters.value.find((c) => c.id === activeCluster.value) || null;
});

/** 高亮范围：选簇 → 簇内全部；选概念 → 它和与它相连的概念 */
const nearSet = computed(() => {
  const s = new Set();
  if (activeConcept.value) {
    s.add(activeConcept.value);
    for (const [a, b] of graph.value ? graph.value.links : []) {
      if (a === activeConcept.value) s.add(b);
      if (b === activeConcept.value) s.add(a);
    }
    const c = concept.value;
    if (c) for (const x of graph.value.concepts) if (x.cluster === c.cluster) s.add(x.id);
  } else if (activeCluster.value) {
    for (const x of graph.value ? graph.value.concepts : []) if (x.cluster === activeCluster.value) s.add(x.id);
  } else if (activeRule.value) {
    const r = rules.value.find((x) => x.id === activeRule.value);
    if (r) {
      for (const id of [r.from, r.to]) {
        s.add(id);
        const c = conceptById(id);
        if (c) for (const x of graph.value.concepts) if (x.cluster === c.cluster) s.add(x.id);
      }
    }
  }
  return s;
});

const focusOn = computed(() => !!(activeConcept.value || activeCluster.value || activeRule.value));

const focusName = computed(() => {
  if (activeConcept.value && concept.value) return concept.value.name;
  if (activeCluster.value && cluster.value) return cluster.value.name;
  if (activeRule.value) {
    const r = rules.value.find((x) => x.id === activeRule.value);
    if (r) return nameOf(r.from) + " → " + nameOf(r.to);
  }
  return "全部";
});

function dimmed(n) {
  return focusOn.value && !nearSet.value.has(n.id);
}

const linkViews = computed(() => {
  const rows = [];
  const data = graph.value ? graph.value.links : [];
  for (const [a, b, w] of data) {
    const pa = nodeById.value.get(a);
    const pb = nodeById.value.get(b);
    if (!pa || !pb) continue;
    const p = linkPath(pa, pb);
    const hot = focusOn.value && nearSet.value.has(a) && nearSet.value.has(b);
    rows.push({
      key: a + "-" + b,
      ...p,
      w: Math.min(4.2, 1 + w * 0.13),
      op: hot ? 0.75 : 0.34,
      hot,
      dim: focusOn.value && !hot,
    });
  }
  return rows;
});

/* 规则边：弧线 + 箭头。同一条规则两端的共现直线还在，所以弧线要弯开一点 */
const ruleViews = computed(() => {
  if (!graph.value) return [];
  const rows = [];
  const all = graph.value.rules || [];
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const pa = nodeById.value.get(r.from);
    const pb = nodeById.value.get(r.to);
    if (!pa || !pb) continue;
    const bend = (i % 2 ? -1 : 1) * (58 + (i >> 1) * 26);
    const p = rulePath(pa, pb, bend);
    const short = r.short || (r.label || "").slice(0, 8);
    const tw = Math.max(30, short.length * 11 + 2);
    const at = ruleLabelPoint(p, [...nodeById.value.values()], { width: W, height: H, halfW: tw / 2 + 5 });
    const c = conceptById(r.from);
    const hot = !focusOn.value || (nearSet.value.has(r.from) && nearSet.value.has(r.to));
    rows.push({
      ...r,
      ...p,
      short,
      lx: at.x,
      ly: at.y,
      color: c ? COLOR(c) : PALETTE[0],
      tw,
      hot,
      dim: focusOn.value && !hot,
    });
  }
  return rows;
});

const conceptBranches = computed(() => {
  if (!concept.value) return [];
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  return (concept.value.branches || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 10)
    .map((n) => ({ id: n.id, title: n.title }));
});

function conceptById(id) {
  return (graph.value ? graph.value.concepts : []).find((c) => c.id === id) || null;
}

function nameOf(id) {
  const c = conceptById(id);
  return c ? c.name : "";
}

function COLOR(c) {
  return clusterColor(clusters.value, c && c.cluster ? c.cluster : c && c.id ? c.id : "");
}

function clusterName(cid) {
  const c = clusters.value.find((x) => x.id === cid);
  return c ? c.name : "未归类";
}

/* ------------------------------ 数据 ------------------------------ */

async function load(force) {
  loading.value = true;
  empty.value = "";
  aiNote.value = "";
  activeConcept.value = "";
  activeCluster.value = "";
  activeRule.value = "";
  try {
    const r = await api.kg();
    graph.value = r;
    empty.value = r.empty || "";
    loadedOnce = true;
    if (!r.empty && r.aiAvailable) askAI(!!force);
    else if (!r.empty && !r.aiAvailable) aiNote.value = "这台服务器没配模型密钥，业务线名用的是本地算法";
  } catch (e) {
    empty.value = "图谱没算出来：" + ((e && e.message) || "未知错误");
  } finally {
    loading.value = false;
  }
}

async function askAI(force) {
  if (!graph.value || aiLoading.value) return;
  aiLoading.value = true;
  aiNote.value = "";
  try {
    const r = await api.kgAI(graph.value.hash, !!force);
    if (r.ai && r.graph) {
      graph.value = { ...r.graph, aiAvailable: true };
      aiNote.value = r.cached ? "✦ 用的是上次的 AI 梳理（枝没变过）" : "✦ AI 梳理完成";
    } else {
      aiNote.value = r.reason || "模型这次没成，已用本地语义分析";
    }
  } catch (e) {
    aiNote.value = "模型这次没成（" + ((e && e.message) || "请求失败") + "），已用本地语义分析";
  } finally {
    aiLoading.value = false;
  }
}

function reload() {
  load(true);
}

/* ------------------------------ 交互 ------------------------------ */

function pickConcept(n) {
  if (drag.value && drag.value.moved) return;
  activeCluster.value = "";
  activeRule.value = "";
  activeConcept.value = activeConcept.value === n.id ? "" : n.id;
}

function toggleCluster(c) {
  activeConcept.value = "";
  activeRule.value = "";
  activeCluster.value = activeCluster.value === c.id ? "" : c.id;
}

function pickRule(id) {
  activeConcept.value = "";
  activeCluster.value = "";
  activeRule.value = activeRule.value === id ? "" : id;
}

function clearFocus() {
  activeConcept.value = "";
  activeCluster.value = "";
  activeRule.value = "";
}

function toSvgPoint(ev) {
  const svg = svgEl.value;
  if (svg && svg.createSVGPoint && svg.getScreenCTM) {
    try {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const m = svg.getScreenCTM();
      if (m) return pt.matrixTransform(m.inverse());
    } catch {
      /* jsdom / 老浏览器没有矩阵，走下面的兜底 */
    }
  }
  const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
  return {
    x: ((ev.clientX - rect.left) / (rect.width || W)) * W,
    y: ((ev.clientY - rect.top) / (rect.height || H)) * H,
  };
}

function onDown(n, ev) {
  // 拖拽只改「屏幕上的位置」，不动底层布局：重新打开面板又回到初始排布
  const p = toSvgPoint(ev);
  drag.value = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false, startX: p.x, startY: p.y };
  if (ev && ev.preventDefault) ev.preventDefault();
}

function onMove(ev) {
  const d = drag.value;
  if (!d) return;
  const p = toSvgPoint(ev);
  if (Math.hypot(p.x - d.startX, p.y - d.startY) > 4) d.moved = true;
  const nx = Math.max(24, Math.min(W - 24, p.x - d.dx));
  const ny = Math.max(24, Math.min(H - 24, p.y - d.dy));
  pos.value = { ...pos.value, [d.id]: { x: Math.round(nx), y: Math.round(ny) } };
}

function onUp() {
  const d = drag.value;
  if (!d) return;
  drag.value = null;
}

/* ------------------------------ 导出 ------------------------------ */

const KG_FONT = '"PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", system-ui, sans-serif';

function kgCss(v) {
  return [
    `svg{font-family:${KG_FONT};background:${v["--bg"]}}`,
    ".kg-link{stroke:" + v["--ink-3"] + ";stroke-linecap:round}",
    ".kg-node{opacity:1!important;animation:none!important}",
    ".kg-node .kg-halo{fill-opacity:.12}",
    ".kg-label{stroke:" + v["--bg"] + ";stroke-width:4;stroke-linejoin:round;paint-order:stroke;fill:" + v["--ink"] + ";font-weight:600}",
    ".kg-core{stroke:none}",
    ".kg-rule-line{fill:none;stroke-width:2}",
    ".kg-arrow{fill:" + v["--ink-3"] + "}",
    ".kg-rule-bg{fill:" + v["--bg"] + ";stroke:" + v["--line"] + "}",
    ".kg-rule-label{fill:" + v["--ink"] + ";font-size:11px;font-weight:600}",
  ].join("\n");
}

async function doExport() {
  if (exporting.value || !svgEl.value || !ready.value) return;
  exporting.value = true;
  try {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const right = [
      stats.value.branches + " 枝",
      stats.value.concepts + " 概念",
      stats.value.clusters + " 业务线",
      isAI.value ? "AI 梳理" : "本地语义",
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
    ].join(" · ");
    const r = await exportMapPng(svgEl.value, {
      width: W,
      height: H,
      left: "枝语 · 业务知识图谱",
      css: kgCss,
      caption: ["枝语 · 业务知识图谱", right],
      filename: "枝语-知识图谱-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".png",
    });
    toast("已导出 " + r.width + "×" + r.height + " 的图片");
  } catch (e) {
    toast("导出失败：" + ((e && e.message) || "未知错误"));
  } finally {
    exporting.value = false;
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

watch(
  () => props.open,
  (on) => {
    if (on) {
      if (!loadedOnce) load(false);
      else if (!graph.value) load(false);
      window.addEventListener("keydown", onKey);
    } else {
      window.removeEventListener("keydown", onKey);
      drag.value = null;
      hoverId.value = "";
    }
  },
  { immediate: true } // 面板一挂载就是开着的（测试/直接定位到图谱）也要能加载
);

function onKey(e) {
  if (!props.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (activeConcept.value || activeCluster.value) clearFocus();
    else emit("close");
  }
}

onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>
