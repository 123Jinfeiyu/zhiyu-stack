<template>
  <div class="auth-page">
    <main class="auth-card">
      <div class="auth-brand">
        <span class="auth-mark">枝</span>
        <span class="auth-name">枝语</span>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab" :class="{ on: mode === 'login' }" id="tabLogin" @click="switchMode('login')">
          登录
        </button>
        <button class="auth-tab" :class="{ on: mode === 'register' }" id="tabRegister" @click="switchMode('register')">
          注册
        </button>
      </div>

      <template v-if="mode === 'login'">
        <h2 class="auth-title">进入你的树林</h2>
        <p class="auth-sub">想法先写下来，再从上面长出下一枝。</p>

        <div class="auth-form">
          <label class="auth-label" for="username">用户名</label>
          <input
            id="username"
            class="auth-input"
            v-model="username"
            type="text"
            autocomplete="username"
            placeholder="输入用户名"
          />

          <label class="auth-label" for="pw">密码</label>
          <input
            id="pw"
            class="auth-input"
            type="password"
            v-model="pw"
            placeholder="输入密码"
            autocomplete="current-password"
            @keyup.enter="submit"
          />

          <div class="err" id="loginErr">{{ error }}</div>

          <div class="auth-acts">
            <button class="btn btn-line" id="loginReset" type="button" @click="reset">清空</button>
            <button class="btn btn-primary" id="loginBtn" type="button" :disabled="busy" @click="submit">
              {{ busy ? "验证中…" : "进入" }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <h2 class="auth-title">种下第一棵树</h2>
        <p class="auth-sub">注册后这棵树林就归你，只有你能看见。</p>

        <div class="auth-form">
          <label class="auth-label" for="regUser">用户名</label>
          <input
            id="regUser"
            class="auth-input"
            v-model="regUser"
            type="text"
            autocomplete="username"
            placeholder="2–20 个字，中文也行"
          />

          <label class="auth-label" for="regPw">密码</label>
          <input
            id="regPw"
            class="auth-input"
            type="password"
            v-model="regPw"
            autocomplete="new-password"
            placeholder="至少 6 位"
          />

          <label class="auth-label" for="regInvite">
            邀请码 <span class="auth-opt">选填</span>
          </label>
          <input
            id="regInvite"
            class="auth-input"
            v-model="regInvite"
            type="text"
            placeholder="有就填，没有留空"
            @keyup.enter="submitRegister"
          />

          <div class="err" id="regErr">{{ regError }}</div>

          <div class="auth-acts">
            <button class="btn btn-line" id="regBack" type="button" @click="switchMode('login')">返回登录</button>
            <button class="btn btn-primary" id="regBtn" type="button" :disabled="busy" @click="submitRegister">
              {{ busy ? "创建中…" : "注册并进入" }}
            </button>
          </div>
        </div>
      </template>

      <p class="auth-note">账号只存在这台服务器上 · 密码只存哈希</p>
    </main>

    <footer class="auth-foot">
      <span>枝语 · 长出来的笔记</span>
      <span class="auth-dot">·</span>
      <span>Ctrl +/− 调字号</span>
    </footer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api";

const emit = defineEmits(["ok"]);

const mode = ref("login");
const busy = ref(false);

const username = ref("");
const pw = ref("");
const error = ref("");

const regUser = ref("");
const regPw = ref("");
const regInvite = ref("");
const regError = ref("");

function switchMode(next) {
  if (mode.value === next) return;
  mode.value = next;
  error.value = "";
  regError.value = "";
}

function reset() {
  username.value = "";
  pw.value = "";
  error.value = "";
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!username.value.trim()) {
    error.value = "用户名不能为空";
    return;
  }
  if (!pw.value) {
    error.value = "密码不能为空";
    return;
  }
  busy.value = true;
  try {
    await api.login(username.value.trim(), pw.value);
    emit("ok");
  } catch (e) {
    error.value = e.status === 401 ? "用户名或密码不对" : e.message || "登录失败";
  } finally {
    busy.value = false;
  }
}

async function submitRegister() {
  if (busy.value) return;
  regError.value = "";
  const name = regUser.value.trim();
  if (name.length < 2) {
    regError.value = "用户名至少 2 个字";
    return;
  }
  if (regPw.value.length < 6) {
    regError.value = "密码至少 6 位";
    return;
  }
  busy.value = true;
  try {
    await api.register(name, regPw.value, regInvite.value.trim());
    emit("ok");
  } catch (e) {
    regError.value = e.message || "注册失败";
  } finally {
    busy.value = false;
  }
}
</script>
