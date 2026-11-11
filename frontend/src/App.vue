<template>
  <div v-if="!ready" class="loading">正在打开…</div>

  <ShareView v-else-if="route.name === 'share'" :token="route.token" />

  <LoginView v-else-if="!authed" @ok="onLoggedIn" />

  <TreeView v-else :path="route.path" @navigate="onNavigate" @logout="logout" />

  <div class="toast" :class="{ on: toastOn }" id="toast">{{ toastMsg }}</div>

  <div v-if="confirmState.open" class="modal" id="confirm">
    <div class="modal-card">
      <p>{{ confirmState.text }}</p>
      <div class="modal-acts">
        <button class="btn" id="confirmNo" @click="answerConfirm(false)">取消</button>
        <button class="btn btn-danger" id="confirmYes" @click="answerConfirm(true)">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { api, onUnauthorized } from "./api";
import { navigate, route, startRouter } from "./router";
import { applyTheme } from "./theme";
import { answerConfirm, confirmState, currentUser, toastOn, toastMsg } from "./ui";
import { bindUiScale } from "./uiscale";
import LoginView from "./components/LoginView.vue";
import ShareView from "./components/ShareView.vue";
import TreeView from "./components/TreeView.vue";

const ready = ref(false);
const authed = ref(false);

function onLoggedIn() {
  authed.value = true;
  // 登录成功后再问一次「我是谁」，顶栏要显示用户名
  api.me().then((me) => {
    currentUser.value = me.username || "";
  }).catch(() => {});
}

async function logout() {
  try {
    await api.logout();
  } catch (e) {
    /* 本地状态照样清掉 */
  }
  authed.value = false;
  currentUser.value = "";
  navigate({ name: "tree", path: [] }, true);
}

function onNavigate(to) {
  navigate(to);
}

onMounted(async () => {
  startRouter();
  applyTheme();
  bindUiScale();

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").addEventListener) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ((localStorage.getItem("zhiyu_theme") || "auto") === "auto") applyTheme("auto");
    });
  }

  onUnauthorized(() => {
    authed.value = false;
  });

  try {
    const me = await api.me();
    authed.value = !!me.authed;
    currentUser.value = me.username || "";
  } catch (e) {
    authed.value = false;
  }
  ready.value = true;

  window.addEventListener("keydown", (e) => {
    if (confirmState.value.open && e.key === "Escape") answerConfirm(false);
  });
});
</script>
