<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">枝</span>
        <span class="brand-text">枝语<small>只读分享</small></span>
      </div>
      <div class="top-actions">
        <button class="iconbtn" id="themeBtn" :title="'主题：' + themeLabel" @click="cycleTheme">{{ themeIcon }}</button>
      </div>
    </header>

    <div v-if="error" class="empty" style="margin-top: 40px">
      <p>{{ error }}</p>
    </div>

    <div v-else-if="!data" class="loading">正在打开…</div>

    <template v-else>
      <div class="sharebar">
        <span>只读分享 · 内容由作者维护，你看到的永远是当前版本</span>
        <span class="spacer"></span>
        <button class="act" @click="goHome">我也要写</button>
      </div>

      <nav class="crumbbar" id="crumb">
        <button class="crumb" :class="{ cur: !stack.length }" @click="stack = []">分享的起点</button>
        <template v-for="(c, i) in stack" :key="c.id">
          <span class="crumb-sep">/</span>
          <button class="crumb" :class="{ cur: i === stack.length - 1 }" @click="stack = stack.slice(0, i + 1)">
            {{ c.title }}
          </button>
        </template>
      </nav>

      <section class="sheet">
        <div class="node-head">
          <h1>{{ current.title }}</h1>
          <div class="node-meta">
            <span v-if="current.kids" class="tag">{{ current.kids }} 根子枝</span>
            <span v-if="current.updated">{{ whenText(current.updated) }}</span>
          </div>
          <div v-if="current.content" class="node-body md" v-html="renderMd(current.content)"></div>
        </div>
      </section>

      <div class="grid" v-if="current.children && current.children.length">
        <article
          v-for="n in current.children"
          :key="n.id"
          class="ncard"
          :data-id="n.id"
          @click="stack = stack.concat([n])"
        >
          <h3 class="ncard-title">{{ n.title }}</h3>
          <p v-if="n.content" class="ncard-body">{{ plain(n.content, 110) }}</p>
          <div class="ncard-foot">
            <span v-if="n.kids" class="ncard-badge">{{ n.kids }} 枝</span>
            <span>{{ whenText(n.updated) }}</span>
          </div>
        </article>
      </div>

      <div v-else class="empty"><p>这枝还没长出下一层。</p></div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api";
import { plain, renderMd } from "../md";
import { navigate } from "../router";
import { applyTheme, cycleTheme, themeIcon, themeLabel } from "../theme";

const props = defineProps({ token: { type: String, required: true } });

const data = ref(null);
const error = ref("");
const stack = ref([]);

const current = computed(() => {
  if (!data.value) return {};
  return stack.value.length ? stack.value[stack.value.length - 1] : data.value.root;
});

function whenText(ts) {
  const d = new Date(Number(ts) * 1000);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function goHome() {
  navigate({ name: "tree", path: [] });
}

async function load() {
  error.value = "";
  data.value = null;
  stack.value = [];
  try {
    data.value = await api.shareView(props.token);
    if (data.value.root && data.value.root.title) {
      document.title = data.value.root.title + " · 枝语";
    }
  } catch (e) {
    error.value = e.message || "分享链接无效";
  }
}

watch(() => props.token, load);
onMounted(() => {
  applyTheme();
  load();
});
</script>
