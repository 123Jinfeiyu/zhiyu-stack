<template>
  <div class="mask" :class="{ on: open }" @click="$emit('close')"></div>
  <aside class="map-panel" :class="{ on: open }" id="mapPanel">
    <div class="map-head">
      <div>
        <h2>整片树林</h2>
        <p class="map-sub">
          {{ nodes.length }} 枝 · {{ depthMax + 1 }} 代<template v-if="rootCount > 1"> · {{ rootCount }} 棵</template>
          · 根在最下面
        </p>
      </div>
      <div class="map-head-right">
        <button
          class="act export-act"
          id="mapExport"
          :disabled="exporting"
          :title="'把整片树林导出成高清 PNG（整张、不受当前缩放影响）'"
          @click="doExport"
        >
          {{ exporting ? "生成中…" : "⤓ 导出图片" }}
        </button>
        <div class="map-zoom">
          <button class="act" id="zoomOut" title="缩小" @click="zoomOut">−</button>
          <button class="act" id="zoomFit" title="适配窗口（不出现滚动条）" @click="fitView">{{ zoomPct }}</button>
          <button class="act" id="zoomIn" title="放大" @click="zoomIn">＋</button>
        </div>
        <button class="act" id="mapClose" @click="$emit('close')">收起</button>
      </div>
    </div>

    <div class="map-body" ref="bodyEl">
      <div class="tree-canvas" :data-zoom="zoom" :style="{ width: canvasW + 'px', height: canvasH + 'px' }">
        <div class="tree-zoom" :style="{ transform: 'scale(' + zoom + ')' }">
          <div class="tree-wrap" :style="{ width: size.w + 'px', height: size.h + 'px' }">
        <svg
          ref="svgEl"
          class="tree-svg"
          :class="{ grown }"
          :width="size.w"
          :height="size.h"
          :viewBox="`0 0 ${size.w} ${size.h}`"
        >
          <!-- 世代色带：一格一辈 -->
          <rect
            v-for="band in bands"
            :key="'band' + band.d"
            class="gen-band"
            :class="{ alt: band.alt }"
            x="0"
            :y="band.y"
            :width="size.w"
            :height="band.h"
          />

          <!-- 地面：每棵树都从这条线上长出来 -->
          <g v-for="t in trees" :key="'ground' + t.key">
            <ellipse class="glow-pad" :cx="t.rootX" :cy="t.ground" rx="92" ry="11" />
            <path
              class="branch trunk"
              :class="{ hot: hotSet.has(t.rootId) }"
              :d="`M${t.rootX},${t.baseline} V${t.ground}`"
              :style="{ '--dg': 0, '--dw': 3.2 }"
            />
          </g>

          <!-- 枝：父枝顶边往上抽，先直后拐，越往末梢越细 -->
          <path
            v-for="e in edges"
            :key="e.key"
            class="branch"
            :class="{ hot: isHotEdge(e) }"
            :d="e.d"
            :data-depth="e.depth"
            :style="{ '--dg': e.depth, '--dw': e.w }"
          />

          <!-- 节点 -->
          <g
            v-for="n in order"
            :key="n.id"
            class="map-item tree-node"
            :class="{
              cur: n.id === currentId,
              leaf: !n.kids,
              hot: hotSet.has(n.id),
              sel: n.id === selectedId,
              dying: n.id === pendingDel,
            }"
            :data-depth="n.depth"
            :data-x="Math.round(n.x)"
            :data-y="Math.round(n.y)"
            :data-id="n.id"
            :transform="`translate(${n.x},${n.y})`"
            :style="{ '--d': n.depth }"
            @click="select(n.id)"
            @dblclick="enter(n.id)"
            @mouseenter="hoverId = n.id"
            @mouseleave="hoverId = 0"
          >
            <title>{{ n.title }}{{ n.kids ? "（" + n.kids + " 枝）" : "（空枝）" }}</title>
            <circle v-if="n.kids" class="knob" :cx="NODE_W / 2" :cy="0" :r="knobR(n.depth)" />
            <rect class="box" :width="NODE_W" :height="NODE_H" rx="9" />
            <text class="lbl" x="12" :y="NODE_H / 2 + 4.5">{{ label(n.title) }}</text>
            <g v-if="n.kids" class="badge" :transform="`translate(${NODE_W - 17},${NODE_H / 2})`">
              <circle r="9" />
              <text y="3.6">{{ n.kids }}</text>
            </g>
          </g>
        </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作条：选中一枝之后，这里就是它的「把手」 -->
    <div class="map-foot" id="mapFoot" :class="{ warn: !!pendingDel }">
      <template v-if="pendingDel">
        <span class="foot-main">
          再按一次 <b>Del</b> 就删掉「<b>{{ selTitle }}</b>」<template v-if="selKids">，连同下面 {{ selKids }} 枝</template>
        </span>
        <span class="foot-acts">
          <button class="act" id="mapDelCancel" @click="cancelDel">算了</button>
        </span>
      </template>
      <template v-else-if="selectedId">
        <span class="foot-main">
          选中 <b>{{ selTitle }}</b> · <b>Del</b> 删除 · <b>F2</b> 改名 · <b>Ins</b> 加子枝 · <b>Enter</b> 进入
        </span>
        <span class="foot-acts">
          <button class="act" id="mapEdit" @click="$emit('edit', selectedId)">改</button>
          <button class="act" id="mapAdd" @click="$emit('create', selectedId)">＋子枝</button>
          <button class="act danger" id="mapDel" @click="askDel">删</button>
        </span>
      </template>
      <template v-else>
        根在最下面，一辈一辈往上抽 · 单击选中 · 双击钻进去 · <b>Del</b> 删 · <b>F2</b> 改名 · <b>Ins</b> 加子枝
      </template>
    </div>
  </aside>
</template>

<script setup>
/* 族谱树（倒过来的）：根在最下面，子枝往上长，像地上长出来的一棵树。
 *
 * 布局仍是「叶子排座次，父辈坐中间」：后序把每个叶子依次放到游标位置，
 * 父节点落在首尾两个孩子的正中间（一棵倒立的非满二叉树），只是把纵轴翻了个向 ——
 * 越深的世代 y 越小（越靠上）。一棵树一条横带，多棵树自上而下排开，各自扎在自己的地面上。
 *
 * DOM 顺序仍是深度优先前序 —— 视觉位置由 transform 决定，跟渲染顺序无关。
 *
 * 这棵树不只用来「看」：单击选中、Del 删除（两步）、F2 改名、Ins 加子枝、
 * Enter 钻进去。所有写操作都 emit 出去，由 TreeView 调接口 —— 面板自己不碰网络。
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { exportMapPng } from "../mapExport";
import { toast } from "../ui";

const props = defineProps({
  open: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
  currentId: { type: Number, default: 0 },
});
const emit = defineEmits(["pick", "close", "create", "edit", "remove"]);

const NODE_W = 148;
const NODE_H = 32;
const GAP_X = 12; // 相邻两枝的横向间距
const GAP_Y = 48; // 两代之间的层高
const BAND_GAP = 46; // 多棵树之间留的空
const GROUND_GAP = 22; // 根节点到地面那条线的距离（树干）
const STEP_Y = NODE_H + GAP_Y;
const PAD_X = 22;
const PAD_TOP = 30;
const PAD_BOTTOM = 26;
const FIT_INSET = 28; // 适配窗口时四周留的白
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;
const DEL_ARM_MS = 4000; // 两步删除：第一次 Del 之后多久自动撤销

const bodyEl = ref(null);
const svgEl = ref(null);
const exporting = ref(false);
const hoverId = ref(0);
const grown = ref(false);
const selectedId = ref(0);
const pendingDel = ref(0);
const zoom = ref(1); // 整片树林的缩放：打开时自动「适配窗口」，尽量不出滚动条
const userZoomed = ref(false); // 用户手动 +/- 过就不再自动重排
let delTimer = null;

/** 扁平清单 → 父子表 */
const kidMap = computed(() => {
  const m = new Map();
  for (const n of props.nodes) {
    const k = n.pid || 0;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  }
  return m;
});

const parentOf = computed(() => {
  const m = new Map();
  for (const n of props.nodes) m.set(n.id, n.pid || 0);
  return m;
});

const layout = computed(() => {
  const kidMapV = kidMap.value;
  const order = [];
  const trees = [];

  /** 这一枝往下最深还能长几代 —— 先量高度，才知道地面该画在哪 */
  const depthOf = (id, guard = 0) => {
    const kids = kidMapV.get(id) || [];
    if (!kids.length || guard > 200) return 0;
    let m = 0;
    for (const c of kids) m = Math.max(m, depthOf(c.id, guard + 1));
    return m + 1;
  };

  let cursorX = PAD_X;
  let top = PAD_TOP; // 这一棵最高那一代的顶边

  const place = (node, depth, baseline) => {
    const kids = kidMapV.get(node.id) || [];
    const info = {
      id: node.id,
      title: node.title,
      kids: kids.length,
      depth,
      baseline,
      x: 0,
      // 翻转：根在最下面（baseline 处），一辈一辈往上
      y: baseline - depth * STEP_Y - NODE_H,
    };
    order.push(info); // 前序：保证 .map-item 的 DOM 顺序 = 深度优先
    if (!kids.length) {
      info.x = cursorX;
      cursorX += NODE_W + GAP_X;
    } else {
      const placed = kids.map((c) => place(c, depth + 1, baseline));
      info.x = (placed[0].x + placed[placed.length - 1].x) / 2;
    }
    return info;
  };

  // 一棵树占一条横带：多棵时上下排开，而不是并排把画布拉成几米宽
  for (const r of kidMapV.get(0) || []) {
    cursorX = PAD_X;
    const start = order.length;
    const dMax = depthOf(r.id);
    const baseline = top + dMax * STEP_Y + NODE_H; // 根节点底边 = 这一条带的地面高度
    place(r, 0, baseline);
    const rootInfo = order[start];
    trees.push({
      key: r.id,
      rootId: r.id,
      top,
      baseline,
      ground: baseline + GROUND_GAP,
      depthMax: dMax,
      rootX: rootInfo.x + NODE_W / 2,
    });
    top = baseline + GROUND_GAP + BAND_GAP;
  }

  const byId = new Map(order.map((i) => [i.id, i]));
  const edges = [];
  for (const p of order) {
    for (const c of kidMapV.get(p.id) || []) {
      const ci = byId.get(c.id);
      if (!ci) continue;
      const px = p.x + NODE_W / 2;
      const py = p.y; // 父枝顶边：枝条从这里往上抽
      const cx = ci.x + NODE_W / 2;
      const cy = ci.y + NODE_H; // 子枝底边：枝条接到这里
      const dy = py - cy;
      // 控制点先直上／直下，中间才拐 —— 出来是「树干分叉」的弧，不是折线
      const k = Math.max(12, dy * 0.56);
      edges.push({
        key: p.id + "-" + c.id,
        pid: p.id,
        cid: c.id,
        depth: p.depth,
        w: Math.max(1, 2.6 - p.depth * 0.5), // 越往末梢越细
        d: `M${px},${py} C${px},${py - k} ${cx},${cy + k} ${cx},${cy}`,
      });
    }
  }

  const maxDepth = order.reduce((a, i) => Math.max(a, i.depth), 0);
  const maxX = order.reduce((a, i) => Math.max(a, i.x), 0);
  const w = Math.max(order.length ? maxX + NODE_W + PAD_X : 240, 240);
  const lowest = trees.length ? trees[trees.length - 1].ground : 120;
  const h = order.length ? lowest + PAD_BOTTOM : 120;

  // 色带按「一棵树一条」画，读起来像几份族谱摊在一张桌子上
  const bands = trees.map((t, i) => ({
    d: i,
    y: Math.max(0, t.top - 14),
    h: t.ground - t.top + NODE_H + 16,
    alt: i % 2 === 1,
  }));

  return { order, edges, bands, maxDepth, w, h, trees };
});

const order = computed(() => layout.value.order);
const edges = computed(() => layout.value.edges);
const bands = computed(() => layout.value.bands);
const trees = computed(() => layout.value.trees);
const depthMax = computed(() => layout.value.maxDepth);
const size = computed(() => ({ w: layout.value.w, h: layout.value.h }));
const rootCount = computed(() => (kidMap.value.get(0) || []).length);

/** 鼠标悬停时高亮「它 + 它的祖先」，路径一眼看清；有选中就先看选中的 */
const focusId = computed(() => hoverId.value || selectedId.value || props.currentId);
const hotSet = computed(() => {
  const s = new Set();
  let cur = focusId.value;
  let guard = 0;
  while (cur && guard++ < 300) {
    s.add(cur);
    cur = parentOf.value.get(cur) || 0;
  }
  return s;
});
const isHotEdge = (e) => hotSet.value.has(e.pid) && hotSet.value.has(e.cid);

const selNode = computed(() => order.value.find((n) => n.id === selectedId.value) || null);
const selTitle = computed(() => (selNode.value ? selNode.value.title : ""));
const selKids = computed(() => (selNode.value ? selNode.value.kids : 0));

const canvasW = computed(() => Math.ceil(size.value.w * zoom.value));
const canvasH = computed(() => Math.ceil(size.value.h * zoom.value));
const zoomPct = computed(() => Math.round(zoom.value * 100) + "%");

function label(t) {
  // 裁剪到 8 个字：再长就会顶到右边的「子枝数」徽标
  const s = String(t || "未命名");
  return s.length > 8 ? s.slice(0, 8) + "…" : s;
}

/** 分叉点上的圆点：主干粗、末梢细，跟 qsont 那种树一样 */
function knobR(depth) {
  return Math.max(1.8, 3.6 - depth * 0.45);
}

/* ------------------------------ 缩放：尽量不出滚动条 ------------------------------ */

/** 把整片树林缩到正好塞进可视区（只缩不放：树林比窗口小就保持 1:1） */
function applyFit() {
  const el = bodyEl.value;
  if (!el || !order.value.length) return;
  const cw = el.clientWidth;
  const ch = el.clientHeight;
  if (!cw || !ch) {
    zoom.value = 1; // jsdom / 面板还没量出尺寸时兜底
    return;
  }
  const z = Math.min(1, (cw - FIT_INSET) / size.value.w, (ch - FIT_INSET) / size.value.h);
  zoom.value = Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000);
  userZoomed.value = false;
}

function zoomIn() {
  userZoomed.value = true;
  zoom.value = Math.min(ZOOM_MAX, Math.round((zoom.value + ZOOM_STEP) * 1000) / 1000);
}

function zoomOut() {
  userZoomed.value = true;
  zoom.value = Math.max(ZOOM_MIN, Math.round((zoom.value - ZOOM_STEP) * 1000) / 1000);
}

function fitView() {
  applyFit();
}

function onResize() {
  if (!userZoomed.value) applyFit(); // 没手动调过就跟手窗口，调过就尊重用户
}

/* ------------------------------ 导出图片 ------------------------------ */

/** 导出的永远是「整张」原尺寸的 2 倍，跟当前缩放和滚动位置无关 */
async function doExport() {
  if (exporting.value || !svgEl.value) return;
  exporting.value = true;
  try {
    const sub = [props.nodes.length + " 枝", depthMax.value + 1 + " 代"];
    if (rootCount.value > 1) sub.push(rootCount.value + " 棵");
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const r = await exportMapPng(svgEl.value, {
      width: size.value.w,
      height: size.value.h,
      caption: [
        "枝语 · 整片树林",
        sub.join(" · ") + " · " + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
      ],
    });
    toast("已导出 " + r.width + "×" + r.height + " 的图片");
  } catch (e) {
    toast("导出失败：" + ((e && e.message) || "未知错误"));
  } finally {
    exporting.value = false;
  }
}

/* ------------------------------ 选中 / 操作 ------------------------------ */

function select(id) {
  if (pendingDel.value && pendingDel.value !== id) cancelDel();
  selectedId.value = id;
}

function enter(id) {
  emit("pick", id);
}

function askDel() {
  const n = selNode.value;
  if (!n) return;
  if (pendingDel.value === n.id) {
    doDelete();
    return;
  }
  // 第一步：变红、把「再按一次」写在操作条上；4 秒不按就当没发生
  clearTimeout(delTimer);
  pendingDel.value = n.id;
  delTimer = setTimeout(() => {
    pendingDel.value = 0;
  }, DEL_ARM_MS);
}

function doDelete() {
  const id = pendingDel.value || selectedId.value;
  clearTimeout(delTimer);
  pendingDel.value = 0;
  selectedId.value = 0;
  emit("remove", id);
}

function cancelDel() {
  clearTimeout(delTimer);
  pendingDel.value = 0;
}

/** 方向键换枝时，把新选中那枝拉到视野中间（坐标要乘上缩放） */
function centerOn(info) {
  const el = bodyEl.value;
  if (!el || !info) return;
  el.scrollLeft = Math.max(0, (info.x + NODE_W / 2) * zoom.value - el.clientWidth / 2);
  el.scrollTop = Math.max(0, (info.y + NODE_H / 2) * zoom.value - el.clientHeight / 2);
}

function onKey(e) {
  if (!props.open) return;
  if (e.defaultPrevented) return; // 外层（比如抽屉）已经消化掉了这个键
  const tag = ((e.target && e.target.tagName) || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return; // 别抢输入框的键

  const k = e.key;

  if (k === "Escape") {
    e.preventDefault();
    if (pendingDel.value) return cancelDel();
    emit("close");
    return;
  }
  if (k === "Delete" || k === "Backspace") {
    if (!selectedId.value) return;
    e.preventDefault(); // 顺手挡掉 Backspace 的「后退」
    askDel();
    return;
  }
  if (k === "F2") {
    if (!selectedId.value) return;
    e.preventDefault();
    emit("edit", selectedId.value);
    return;
  }
  if (k === "Insert" || k === "n" || k === "N") {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    emit("create", selectedId.value || props.currentId || 0);
    return;
  }
  if (k === "Enter") {
    if (!selectedId.value) return;
    e.preventDefault();
    enter(selectedId.value);
    return;
  }
  if (k === "ArrowDown" || k === "ArrowUp") {
    const list = order.value;
    if (!list.length) return;
    e.preventDefault();
    let i = list.findIndex((n) => n.id === selectedId.value);
    if (i < 0) i = k === "ArrowDown" ? -1 : list.length;
    const next = k === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    selectedId.value = list[next].id;
    centerOn(list[next]);
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

/** 打开时重放一次生长动画，缩到「整片都看得见」，窗口变了也跟着适配 */
watch(
  () => props.open,
  async (on) => {
    if (!on) {
      grown.value = false;
      hoverId.value = 0;
      cancelDel();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      return;
    }
    // 从抽屉里回来时保留上次选中的那枝，别让人重新找一遍
    if (!selectedId.value || !props.nodes.some((n) => n.id === selectedId.value)) {
      selectedId.value = props.currentId || 0;
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    await nextTick();
    grown.value = true;
    applyFit();
  }
);

/** 枝被删掉之后，别让选中框停在一枝不存在的地方；树林变大了也重新适配一下 */
watch(
  () => props.nodes,
  (list) => {
    if (selectedId.value && !list.some((n) => n.id === selectedId.value)) {
      selectedId.value = 0;
      cancelDel();
    }
    if (props.open && !userZoomed.value) applyFit();
  }
);

onUnmounted(() => {
  clearTimeout(delTimer);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onResize);
});
</script>
