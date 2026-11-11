<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">枝</span>
        <span class="brand-text">
          枝语
          <small>长出来的笔记</small>
        </span>
      </div>
      <div class="top-actions">
        <button class="iconbtn" id="mapBtn" title="整片树林（族谱）" @click="mapOpen = true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <path d="M12 4v4" />
            <path d="M6 20v-3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3" />
            <path d="M4 20v-4a2 2 0 0 1 2-2h4M16 14h2a2 2 0 0 1 2 2v4" />
            <circle cx="12" cy="10" r="2.2" />
          </svg>
        </button>
        <button class="iconbtn" id="kgBtn" title="业务知识图谱（AI 梳理业务线）" @click="kgOpen = true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="5" r="2.4" />
            <circle cx="5" cy="18" r="2.4" />
            <circle cx="19" cy="18" r="2.4" />
            <path d="M10.3 6.8 6.6 15.6M13.7 6.8l3.7 8.8M7.4 18h9.2" />
          </svg>
        </button>
        <button class="iconbtn" id="themeBtn" :title="'主题：' + themeLabel" @click="cycleTheme">
          {{ themeIcon }}
        </button>
        <div class="scale-wrap">
          <button
            class="iconbtn text-btn"
            id="scaleBtn"
            :title="'文字大小 ' + pctText + '（Ctrl + / - 调，Ctrl 0 复位）'"
            @click="scaleOpen = !scaleOpen"
          >
            Aa
          </button>
          <div v-if="scaleOpen" class="scale-pop" id="scalePop">
            <button id="scaleDown" title="缩小（Ctrl -）" @click="onScaleDown">−</button>
            <button class="val" id="scaleReset" title="点一下回到 100%（Ctrl 0）" @click="onScaleReset">
              {{ pctText }}
            </button>
            <button id="scaleUp" title="放大（Ctrl +）" @click="onScaleUp">＋</button>
            <span class="hint">Ctrl +/−</span>
          </div>
        </div>
        <button class="iconbtn" id="pwBtn" title="改密码" @click="openPw">🔑</button>
        <button
          class="iconbtn"
          id="logoutBtn"
          :title="currentUser ? '退出（' + currentUser + '）' : '退出'"
          @click="$emit('logout')"
        >
          ⏻
        </button>
      </div>
    </header>

    <!-- 面包屑 -->
    <nav class="crumbbar" id="crumb">
      <button class="crumb" :class="{ cur: currentId === 0 }" @click="goRoot">全部笔记</button>
      <template v-for="(c, i) in view.crumbs" :key="c.id">
        <span class="crumb-sep">/</span>
        <button class="crumb" @click="gotoDepth(i)">{{ c.title }}</button>
      </template>
      <template v-if="currentId !== 0">
        <span class="crumb-sep">/</span>
        <span class="crumb cur">{{ view.node ? view.node.title : "…" }}</span>
      </template>
    </nav>

    <!-- 移动横幅 -->
    <div v-if="moving" class="banner" id="moveBanner">
      <span>正在移动 <b>{{ moving.title }}</b></span>
      <span class="grow">钻到目标位置，再点右边。</span>
      <button class="btn btn-sm" id="moveCancel" @click="moving = null">取消</button>
      <button class="btn btn-sm btn-primary" id="moveConfirm" @click="moveHere">
        移到这里（{{ currentId === 0 ? "顶层" : view.node && view.node.title }}）
      </button>
    </div>

    <!-- 当前节点 -->
    <section class="sheet" v-if="view.node" id="currentSheet">
      <div class="node-head">
        <h1 id="curTitle">{{ currentId === 0 ? "你的树林" : view.node.title }}</h1>
        <div class="node-meta">
          <span v-if="currentId !== 0 && view.node.kids" class="tag">{{ view.node.kids }} 根子枝</span>
          <span v-if="currentId === 0">{{ allNodes.length }} 枝 · 点卡片钻进去</span>
          <span v-else-if="view.node.updated">{{ whenText(view.node.updated) }}</span>
          <span v-if="currentId === 0" class="tag">按 n 新建</span>
        </div>
        <div class="node-body md" v-if="currentId !== 0 && view.node.content" v-html="bodyHtml" id="curBody"></div>
        <div class="node-body" v-else-if="currentId === 0">
          每一张卡片都是一根枝。点进去看它长出了什么，面包屑永远能带你退回来。
          <button class="linkbtn" id="openTree" @click="mapOpen = true">看整片树林的族谱 →</button>
        </div>
      </div>
    </section>

    <!-- 搜索 -->
    <div class="toolrow">
      <div class="searchbox">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          id="searchInput"
          ref="searchEl"
          v-model="q"
          type="search"
          :placeholder="currentId === 0 ? '搜整片树林' : '在这枝以下搜'"
        />
        <button v-if="q" class="search-clear" id="searchClear" @click="q = ''">清除</button>
      </div>
      <button class="btn" @click="openCreate">新枝</button>
    </div>

    <p v-if="err" class="err">{{ err }}</p>

    <!-- 卡片网格 -->
    <div v-if="!loading" class="grid" id="grid">
      <NodeCard
        v-for="n in cards"
        :key="n.id"
        :node="n"
        :moving="moving && moving.id === n.id"
        @enter="onEnter"
        @edit="openEdit"
        @move="startMove"
        @share="doShare"
        @remove="doRemove"
      />
    </div>

    <div v-else class="loading">正在长出来…</div>

    <div v-if="!loading && !cards.length" class="empty" id="empty">
      <p v-if="q">这一片没找到「{{ q }}」。</p>
      <p v-else>这里还是一根空枝。写点什么，它会开始长。</p>
      <button class="btn btn-primary" id="emptyAdd" @click="openCreate">长出第一枝</button>
    </div>

    <button class="fab" id="fab" title="新枝（n）" @click="openCreate">＋</button>

    <MiniMap
      :open="mapOpen"
      :nodes="allNodes"
      :current-id="currentId"
      @pick="pickFromMap"
      @close="mapOpen = false"
      @create="createUnder"
      @edit="editFromMap"
      @remove="removeFromMap"
    />

    <KnowledgeGraph :open="kgOpen" :nodes="allNodes" @close="kgOpen = false" @pick="pickFromGraph" />

    <EditorDrawer
      :open="drawerOpen"
      :model="editing || {}"
      :parent-title="currentId === 0 ? '' : view.node && view.node.title"
      :busy="busy"
      @save="saveNode"
      @close="closeDrawer"
      @remove="doRemove"
    />

    <!-- 分享链接 -->
    <div v-if="shareUrl" class="modal" id="shareModal">
      <div class="modal-card">
        <p>这枝的只读链接（别人打开只能看，不能改）：</p>
        <input class="input" id="shareUrlInput" :value="shareUrl" readonly @focus="$event.target.select()" />
        <div class="modal-acts" style="margin-top: 14px">
          <button class="btn" @click="shareUrl = ''">关闭</button>
          <button class="btn btn-primary" id="shareCopy" @click="copyShare">复制</button>
        </div>
      </div>
    </div>

    <!-- 改密码 -->
    <div v-if="pwOpen" class="modal" id="pwModal">
      <div class="modal-card">
        <p>改密码（改完当前登录继续有效，其他设备要重新登录）</p>
        <div class="field">
          <label class="label" for="pwOld">原密码</label>
          <input class="input" id="pwOld" type="password" v-model="pwOld" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="label" for="pwNew">新密码（至少 6 位）</label>
          <input class="input" id="pwNew" type="password" v-model="pwNew" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="label" for="pwRepeat">再输一遍新密码</label>
          <input
            class="input"
            id="pwRepeat"
            type="password"
            v-model="pwRepeat"
            autocomplete="new-password"
            @keyup.enter="submitPw"
          />
        </div>
        <p v-if="pwErr" class="form-err" id="pwErr">{{ pwErr }}</p>
        <div class="modal-acts" style="margin-top: 14px">
          <button class="btn" id="pwCancel" @click="closePw">取消</button>
          <button class="btn btn-primary" id="pwSave" :disabled="pwBusy" @click="submitPw">
            {{ pwBusy ? "保存中…" : "保存" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api } from "../api";
import { renderMd } from "../md";
import { cycleTheme, themeIcon, themeLabel, applyTheme } from "../theme";
import { askConfirm, currentUser, toast } from "../ui";
import { scaleDown, scaleReset, scaleUp, uiScale } from "../uiscale";
import EditorDrawer from "./EditorDrawer.vue";
import KnowledgeGraph from "./KnowledgeGraph.vue";
import MiniMap from "./MiniMap.vue";
import NodeCard from "./NodeCard.vue";

const props = defineProps({ path: { type: Array, default: () => [] } });
const emit = defineEmits(["navigate", "logout"]);

const view = ref({ node: null, children: [], crumbs: [] });
const allNodes = ref([]);
const loading = ref(true);
const err = ref("");
const q = ref("");
const hits = ref(null);
const mapOpen = ref(false);
const kgOpen = ref(false); // 业务知识图谱（AI）
const drawerOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const moving = ref(null);
const shareUrl = ref("");

/* ---- 改密码 ---- */
const pwOpen = ref(false);
const pwOld = ref("");
const pwNew = ref("");
const pwRepeat = ref("");
const pwErr = ref("");
const pwBusy = ref(false);

function openPw() {
  pwOld.value = "";
  pwNew.value = "";
  pwRepeat.value = "";
  pwErr.value = "";
  pwOpen.value = true;
}

function closePw() {
  if (pwBusy.value) return;
  pwOpen.value = false;
}

async function submitPw() {
  if (pwBusy.value) return;
  if (!pwOld.value || !pwNew.value) {
    pwErr.value = "原密码和新密码都要填";
    return;
  }
  if (pwNew.value !== pwRepeat.value) {
    pwErr.value = "两遍新密码不一样";
    return;
  }
  pwErr.value = "";
  pwBusy.value = true;
  try {
    await api.changePassword(pwOld.value, pwNew.value);
    pwOpen.value = false;
    toast("密码已改，当前设备继续有效");
  } catch (e) {
    pwErr.value = e && e.message ? e.message : "改失败了，再试一次";
  } finally {
    pwBusy.value = false;
  }
}
/** 字号控件的弹出层 */
const scaleOpen = ref(false);
const searchEl = ref(null);
/** 新建时的父枝：抽屉默认挂在「当前所在枝」下，但从族谱里按 Ins 时改成选中那枝 */
const createPid = ref(0);
/** 抽屉是从族谱里打开的，关掉之后把族谱还原回去，好接着操作 */
const mapBack = ref(false);
let debounceTimer = null;

const currentId = computed(() => (props.path.length ? props.path[props.path.length - 1] : 0));
const cards = computed(() => (hits.value ? hits.value : view.value.children || []));
const bodyHtml = computed(() => renderMd(view.value.node ? view.value.node.content : ""));
const pctText = computed(() => Math.round(uiScale.value * 100) + "%");

function onScaleUp() {
  scaleUp();
}
function onScaleDown() {
  scaleDown();
}
function onScaleReset() {
  scaleReset();
}

function pathTo(to) {
  emit("navigate", { name: "tree", path: to });
}
function goRoot() {
  pathTo([]);
}
function gotoDepth(i) {
  pathTo(props.path.slice(0, i + 1));
}
function goUp() {
  pathTo(props.path.slice(0, -1));
}

function whenText(ts) {
  const d = new Date(Number(ts) * 1000);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

async function load() {
  loading.value = true;
  err.value = "";
  try {
    view.value = await api.node(currentId.value);
  } catch (e) {
    err.value = e.message;
    view.value = { node: null, children: [], crumbs: [] };
  } finally {
    loading.value = false;
  }
}

async function loadAll() {
  try {
    const d = await api.tree();
    allNodes.value = d.nodes || [];
  } catch (e) {
    /* 小地图挂了不影响主流程 */
  }
}

function pathOf(id) {
  const byId = new Map(allNodes.value.map((n) => [n.id, n]));
  const out = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 200) {
    out.unshift(cur.id);
    cur = byId.get(cur.pid);
  }
  return out;
}

function onEnter(node) {
  if (hits.value) {
    const p = pathOf(node.id);
    pathTo(p.length ? p : [node.id]);
    return;
  }
  pathTo(props.path.concat(node.id));
}

function pickFromGraph(id) {
  kgOpen.value = false;
  const p = pathOf(id);
  pathTo(p.length ? p : [id]);
}

function pickFromMap(id) {
  mapOpen.value = false;
  const p = pathOf(id);
  pathTo(p.length ? p : [id]);
}

watch(currentId, () => {
  q.value = "";
  hits.value = null;
  load();
});

watch(q, (v) => {
  clearTimeout(debounceTimer);
  const kw = v.trim();
  if (!kw) {
    hits.value = null;
    return;
  }
  debounceTimer = setTimeout(async () => {
    try {
      const d = await api.search(kw, currentId.value);
      hits.value = d.hits || [];
    } catch (e) {
      toast(e.message);
    }
  }, 220);
});

/* ------------------------------ 编辑 ------------------------------ */
function openCreate() {
  createPid.value = currentId.value;
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(node) {
  editing.value = { ...node };
  drawerOpen.value = true;
}
/** 族谱里按 Ins：挂到选中那枝下面，而不是当前钻进去的位置 */
function createUnder(pid) {
  mapBack.value = mapOpen.value;
  mapOpen.value = false;
  createPid.value = pid || 0;
  editing.value = null;
  drawerOpen.value = true;
}
/** 族谱里按 F2：先拉这一枝的全文（/api/tree 只带标题），再开抽屉，免得把正文覆盖掉 */
async function editFromMap(id) {
  try {
    const d = await api.node(id);
    if (!d || !d.node) return;
    mapBack.value = mapOpen.value;
    mapOpen.value = false;
    openEdit(d.node);
  } catch (e) {
    toast(e.message);
  }
}
function closeDrawer() {
  drawerOpen.value = false;
  editing.value = null;
  // 从族谱里进来的，关抽屉就把族谱还给用户（此时树已经刷新过）
  if (mapBack.value) {
    mapBack.value = false;
    mapOpen.value = true;
  }
  // 焦点要还回去，否则 Esc / n 这些快捷键会被"正在输入"的逻辑一直挡住
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) active.blur();
}

async function saveNode(payload) {
  busy.value = true;
  try {
    if (editing.value && editing.value.id) {
      await api.update(editing.value.id, payload);
      toast("改好了");
    } else {
      const pid = createPid.value || 0;
      await api.create({ ...payload, pid });
      toast(pid === 0 ? "种下一棵新树" : "新枝长出来了");
    }
    await loadAll();
    await load();
    closeDrawer();
  } catch (e) {
    toast(e.message);
  } finally {
    busy.value = false;
  }
}

async function doRemove(node) {
  const ok = await askConfirm(
    "「" + node.title + "」下面还挂着 " + (node.kids || 0) + " 枝。\n连根删除，删了就找不回来了。"
  );
  if (!ok) return;
  await kill(node);
}

/** 族谱里已经「按两次 Del」确认过了，不再弹框，直接连根删 */
async function removeFromMap(id) {
  const node = allNodes.value.find((n) => n.id === id);
  if (!node) return;
  await kill(node);
}

async function kill(node) {
  try {
    const d = await api.remove(node.id);
    drawerOpen.value = false;
    editing.value = null;
    mapBack.value = false;
    toast("已删掉 " + d.deleted + " 枝");
    // 当前正站在被删节点里面的话，退回上一层
    if (props.path.includes(node.id)) {
      const idx = props.path.indexOf(node.id);
      pathTo(props.path.slice(0, idx));
    }
    await loadAll();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

/* ------------------------------ 移动 ------------------------------ */
function startMove(node) {
  moving.value = { id: node.id, title: node.title };
  toast("钻到目标位置，然后点「移到这里」");
}

async function moveHere() {
  if (!moving.value) return;
  try {
    await api.move(moving.value.id, currentId.value);
    toast("移好了");
    moving.value = null;
    await loadAll();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

/* ------------------------------ 分享 ------------------------------ */
async function doShare(node) {
  try {
    const d = await api.share(node.id);
    shareUrl.value = location.origin + "/s/" + d.token;
  } catch (e) {
    toast(e.message);
  }
}

async function copyShare() {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl.value);
      toast("已复制");
    } else {
      toast("请手动复制上面的链接");
    }
  } catch (e) {
    toast("请手动复制上面的链接");
  }
}

/* ------------------------------ 键盘 ------------------------------ */
function onKey(e) {
  // 族谱面板开着时，选中 / Del / F2 / Ins 这些键都归它管，这里别抢。
  // 唯一的例外：抽屉是从族谱里开的（理论上已经关了地图），Esc 还得能关抽屉。
  // 知识图谱面板自己处理 Esc / 选中，这边别抢
  if (kgOpen.value) return;
  if (mapOpen.value) {
    if (e.key === "Escape" && drawerOpen.value) {
      closeDrawer();
      e.preventDefault(); // 告诉面板「这个 Esc 我处理了」
    }
    return;
  }
  const tag = ((e.target && e.target.tagName) || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea";
  if (e.key === "Escape") {
    if (moving.value) {
      moving.value = null;
      return;
    }
    if (drawerOpen.value) {
      closeDrawer();
      return;
    }
    if (mapOpen.value) {
      mapOpen.value = false;
      return;
    }
    if (q.value) {
      q.value = "";
      return;
    }
    if (props.path.length) goUp();
    return;
  }
  if (typing) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    openCreate();
  } else if (e.key === "/") {
    e.preventDefault();
    if (searchEl.value) searchEl.value.focus();
  }
}

/* 字号变了给一句反馈，不然按 Ctrl +/- 看不出发生了什么 */
watch(uiScale, (s) => {
  toast("文字大小 " + Math.round(s * 100) + "%");
});

function onDocClick(e) {
  if (!scaleOpen.value) return;
  const t = e.target;
  if (t && t.closest && t.closest(".scale-wrap")) return;
  scaleOpen.value = false;
}

onMounted(() => {
  applyTheme();
  loadAll();
  load();
  window.addEventListener("keydown", onKey);
  document.addEventListener("click", onDocClick);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  document.removeEventListener("click", onDocClick);
  clearTimeout(debounceTimer);
});

defineExpose({ load, currentId });
</script>
