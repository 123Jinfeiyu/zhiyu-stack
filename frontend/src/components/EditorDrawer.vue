<template>
  <div class="mask" :class="{ on: open }" @click="$emit('close')"></div>
  <aside class="drawer" :class="{ on: open }" id="drawer">
    <div class="drawer-head">
      <h2>{{ model.id ? "编辑这一枝" : "新长一枝" }}</h2>
      <div class="seg">
        <button :class="{ on: tab === 'write' }" id="tabWrite" @click="tab = 'write'">写</button>
        <button :class="{ on: tab === 'preview' }" id="tabPreview" @click="tab = 'preview'">看</button>
      </div>
    </div>

    <div class="drawer-body">
      <div v-if="!model.id && parentTitle" class="node-meta" style="margin: -4px 0 12px">
        <span>会长在</span>
        <span class="tag">{{ parentTitle }}</span>
        <span>下面</span>
      </div>

      <div class="field">
        <label class="label" for="fTitle">标题</label>
        <input id="fTitle" class="input" v-model="title" placeholder="一句话说清这枝是什么" maxlength="200" />
      </div>

      <div class="field" v-show="tab === 'write'">
        <label class="label" for="fContent">正文（支持 Markdown · 图片可以直接粘贴或拖进来）</label>
        <div class="edtools" id="edTools">
          <button type="button" class="edtool" title="标题" @mousedown.prevent="linePrefix('## ')">H</button>
          <button type="button" class="edtool edtool-b" title="加粗" @mousedown.prevent="wrapSel('**')">B</button>
          <button type="button" class="edtool edtool-i" title="斜体" @mousedown.prevent="wrapSel('*')">I</button>
          <button type="button" class="edtool edtool-s" title="删除线" @mousedown.prevent="wrapSel('~~')">S</button>
          <button type="button" class="edtool" title="行内代码" @mousedown.prevent="wrapSel('`')">&lt;/&gt;</button>
          <span class="edtool-gap"></span>
          <button type="button" class="edtool" title="列表" @mousedown.prevent="linePrefix('- ')">•&nbsp;列</button>
          <button type="button" class="edtool" title="引用" @mousedown.prevent="linePrefix('> ')">❝&nbsp;引</button>
          <button type="button" class="edtool" title="分隔线" @mousedown.prevent="insertAtCursor('\n\n---\n\n')">―&nbsp;隔</button>
          <span class="edtool-gap"></span>
          <button
            type="button"
            class="edtool edtool-img"
            id="edImg"
            title="插入图片（也可以直接粘贴 / 拖进来）"
            :disabled="uploading > 0"
            @mousedown.prevent="pickImage"
          >
            {{ uploading > 0 ? "上传中…" : "◫ 图片" }}
          </button>
        </div>
        <textarea
          id="fContent"
          class="textarea"
          v-model="content"
          ref="ta"
          placeholder="可以只写一句。想到哪写到哪，回头再长下一枝。"
          @paste="onPaste"
          @drop="onDrop"
          @dragover.prevent
        ></textarea>
        <p v-if="uploadErr" class="upload-err" id="uploadErr">{{ uploadErr }}</p>
        <input
          ref="fp"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          @change="onPick"
        />
      </div>

      <div v-show="tab === 'preview'" class="preview">
        <h3 class="ncard-title" style="padding-left: 0">{{ title || "（还没写标题）" }}</h3>
        <div class="md" v-html="html"></div>
      </div>
    </div>

    <div class="drawer-foot">
      <button v-if="model.id" class="btn btn-danger btn-sm" id="fDelete" @click="$emit('remove', model)">
        删除
      </button>
      <span class="spacer"></span>
      <button class="btn" id="fCancel" @click="$emit('close')">取消</button>
      <button class="btn btn-primary" id="fSave" :disabled="busy" @click="save">
        {{ busy ? "保存中…" : "保存" }}
      </button>
    </div>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { api } from "../api";
import { renderMd } from "../md";

const props = defineProps({
  open: { type: Boolean, default: false },
  model: { type: Object, default: () => ({}) },
  parentTitle: { type: String, default: "" },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["save", "close", "remove"]);

const title = ref("");
const content = ref("");
const tab = ref("write");
const ta = ref(null);
const fp = ref(null);
const uploading = ref(0);
const uploadErr = ref("");

watch(
  () => [props.open, props.model && props.model.id, props.model && props.model.title, props.model && props.model.content],
  () => {
    if (!props.open) return;
    title.value = (props.model && props.model.title) || "";
    content.value = (props.model && props.model.content) || "";
    tab.value = "write";
    uploadErr.value = "";
  },
  { immediate: true }
);

const html = computed(() => renderMd(content.value));

function save() {
  emit("save", { title: title.value.trim() || "未命名", content: content.value });
}

/* ---------------- 编辑工具：只碰 textarea 的选区，不动光标以外的世界 ---------------- */

function setContent(next, selStart, selEnd) {
  const before = ta.value && ta.value.selectionStart;
  content.value = next;
  // jsdom / 测试环境没有完整选区 API 时静默跳过，不挡功能
  nextTick(() => {
    const el = ta.value;
    if (!el || !el.focus) return;
    el.focus();
    if (el.setSelectionRange) {
      try {
        el.setSelectionRange(selStart, selEnd);
      } catch (e) {
        /* ignore */
      }
    }
  });
  return before;
}

/** 给选中文字包标记；再次执行同一切换则解开 */
function wrapSel(mark) {
  const el = ta.value;
  if (!el) return;
  const v = el.value || "";
  const a = el.selectionStart == null ? v.length : el.selectionStart;
  const b = el.selectionEnd == null ? v.length : el.selectionEnd;
  if (a >= mark.length && v.slice(a - mark.length, a) === mark && v.slice(b, b + mark.length) === mark) {
    setContent(v.slice(0, a - mark.length) + v.slice(a, b) + v.slice(b + mark.length), a - mark.length, b - mark.length);
    return;
  }
  setContent(v.slice(0, a) + mark + v.slice(a, b) + mark + v.slice(b), a + mark.length, b + mark.length);
}

const LINE_MARK = /^(#{1,6} |> |- |\* |\+ |\d+[.、] )/;

/** 行首标记：同标记再点一次是取消，不同标记是替换 */
function linePrefix(prefix) {
  const el = ta.value;
  if (!el) return;
  const v = el.value || "";
  const a = el.selectionStart == null ? v.length : el.selectionStart;
  const ls = v.lastIndexOf("\n", a - 1) + 1;
  let le = v.indexOf("\n", a);
  if (le === -1) le = v.length;
  const line = v.slice(ls, le);
  const m = line.match(LINE_MARK);
  const stripped = m ? line.slice(m[0].length) : line;
  if (m && m[0] === prefix) {
    setContent(v.slice(0, ls) + stripped + v.slice(le), ls, ls + stripped.length);
  } else {
    setContent(v.slice(0, ls) + prefix + stripped + v.slice(le), ls + prefix.length, ls + prefix.length + stripped.length);
  }
}

function insertAtCursor(text) {
  const el = ta.value;
  const v = content.value || "";
  const a = !el || el.selectionStart == null ? v.length : el.selectionStart;
  const b = !el || el.selectionEnd == null ? v.length : el.selectionEnd;
  setContent(v.slice(0, a) + text + v.slice(b), a + text.length, a + text.length);
}

/* ---------------- 图片：按钮选文件、粘贴、拖拽，三条路都通向同一个上传 ---------------- */

const UP_TOKEN = "![图片上传中…]()";

function pickImage() {
  if (fp.value) fp.value.click();
}

function onPick(e) {
  const el = e.target;
  uploadFiles(el.files);
  el.value = ""; // 同一张图想再传第二次也得响应
}

function onPaste(e) {
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length && Array.from(files).some((f) => (f.type || "").startsWith("image/"))) {
    e.preventDefault();
    uploadFiles(files);
  }
}

function onDrop(e) {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return;
  const imgs = Array.from(dt.files).filter((f) => (f.type || "").startsWith("image/"));
  if (imgs.length) {
    e.preventDefault();
    uploadFiles(imgs);
  }
}

function altOf(name) {
  const n = String(name || "").replace(/\.[^.]+$/, "").replace(/[[\]]/g, "").trim();
  return n ? n.slice(0, 30) : "图片";
}

async function uploadFiles(list) {
  const files = Array.from(list || []).filter((f) => f && (f.type || "").startsWith("image/"));
  if (!files.length) return;
  uploadErr.value = "";
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) {
      uploadErr.value = "「" + f.name + "」超过 5MB，这张没传";
      continue;
    }
    uploading.value++;
    insertAtCursor("\n" + UP_TOKEN + "\n");
    try {
      const r = await api.upload(f);
      // 一次只有一张在传，直接替换第一个占位
      content.value = content.value.replace(UP_TOKEN, "![" + altOf(f.name) + "](" + r.url + ")");
    } catch (e) {
      content.value = content.value.replace("\n" + UP_TOKEN + "\n", "\n");
      content.value = content.value.replace(UP_TOKEN + "\n", "").replace("\n" + UP_TOKEN, "");
      uploadErr.value = "「" + f.name + "」上传失败：" + (e && e.message ? e.message : e);
    } finally {
      uploading.value--;
    }
  }
}
</script>
