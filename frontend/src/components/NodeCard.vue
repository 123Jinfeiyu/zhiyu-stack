<template>
  <article
    class="ncard"
    :class="{ 'moving-src': moving }"
    :data-id="node.id"
    @click="$emit('enter', node)"
  >
    <h3 class="ncard-title">{{ node.title }}</h3>
    <p v-if="bodyText" class="ncard-body">{{ bodyText }}</p>
    <div class="ncard-foot">
      <span v-if="node.kids" class="ncard-badge">{{ node.kids }} 枝</span>
      <span>{{ when }}</span>
      <div class="ncard-acts" @click.stop>
        <button class="act" title="编辑" @click="$emit('edit', node)">编辑</button>
        <button class="act" title="移动" @click="$emit('move', node)">移动</button>
        <button class="act" title="生成只读链接" @click="$emit('share', node)">分享</button>
        <button class="act del" title="连根删除" @click="$emit('remove', node)">删除</button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from "vue";
import { plain } from "../md";

const props = defineProps({
  node: { type: Object, required: true },
  moving: { type: Boolean, default: false },
});
defineEmits(["enter", "edit", "move", "share", "remove"]);

const bodyText = computed(() => plain(props.node.content || props.node.snippet || "", 110));

const when = computed(() => {
  const t = Number(props.node.updated || 0);
  if (!t) return "";
  const d = new Date(t * 1000);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getMonth() + 1 + "月" + d.getDate() + "日 " + p(d.getHours()) + ":" + p(d.getMinutes());
});
</script>
