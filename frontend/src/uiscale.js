import { ref } from "vue";

/**
 * 界面缩放：整体放大/缩小（文字、间距、树图一起变），用 CSS zoom 实现布局缩放。
 * 快捷键 Ctrl/Cmd + '=' / '-'，Ctrl/Cmd + 0 复位，Ctrl + 滚轮也行。
 * （注意：Ctrl +/- 本身是浏览器缩放快捷键，页面只能尽量拦；拦不住时浏览器还会自己缩放一次。）
 */
const KEY = "zhiyu_ui_scale";

export const MIN = 0.8;
export const MAX = 2;
export const STEP = 0.1;
export const DEFAULT = 1;

function clamp(v) {
  if (!isFinite(v)) return DEFAULT;
  return Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100));
}

function read() {
  try {
    const n = parseFloat(localStorage.getItem(KEY) || "");
    if (isFinite(n)) return clamp(n);
  } catch (e) {
    /* 隐私模式下读不到，用默认值 */
  }
  return DEFAULT;
}

export const uiScale = ref(read());

function persist(s) {
  try {
    localStorage.setItem(KEY, String(s));
  } catch (e) {
    /* 写不进去也不影响本次会话 */
  }
}

export function applyScale(next = uiScale.value) {
  const s = clamp(next);
  uiScale.value = s;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.setProperty("--ui-scale", String(s));
    document.documentElement.setAttribute("data-zoom", String(Math.round(s * 100)));
  }
  return s;
}

export function setScale(next) {
  const s = applyScale(next);
  persist(s);
  return s;
}

export function scaleUp() {
  return setScale(uiScale.value + STEP);
}

export function scaleDown() {
  return setScale(uiScale.value - STEP);
}

export function scaleReset() {
  return setScale(DEFAULT);
}

export const percentText = () => Math.round(uiScale.value * 100) + "%";

let wheelLock = 0;

function onKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key;
  if (k === "=" || k === "+" || k === "Add") {
    e.preventDefault();
    scaleUp();
  } else if (k === "-" || k === "_" || k === "Subtract") {
    e.preventDefault();
    scaleDown();
  } else if (k === "0") {
    e.preventDefault();
    scaleReset();
  }
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const now = Date.now();
  if (now - wheelLock < 180) return;
  wheelLock = now;
  if (e.deltaY < 0) scaleUp();
  else if (e.deltaY > 0) scaleDown();
}

/** 绑定一次即可；重复调用不会重复绑定。 */
let bound = false;
export function bindUiScale() {
  applyScale();
  if (bound || typeof window === "undefined") return;
  bound = true;
  // capture 阶段先拿到，尽量抢在页面其它快捷键之前
  window.addEventListener("keydown", onKey, true);
  // passive:false 才能在 Ctrl+滚轮时阻止浏览器缩放
  window.addEventListener("wheel", onWheel, { passive: false });
}
