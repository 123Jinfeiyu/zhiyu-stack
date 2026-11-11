import { computed, ref } from "vue";

export const MODES = ["auto", "light", "dark"];

function read() {
  try {
    return localStorage.getItem("zhiyu_theme") || "auto";
  } catch (e) {
    return "auto";
  }
}

export const themeMode = ref(read());

export function applyTheme(mode = themeMode.value) {
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const dark = mode === "dark" || (mode === "auto" && prefersDark);
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

export function cycleTheme() {
  const i = MODES.indexOf(themeMode.value);
  const next = MODES[(i + 1) % MODES.length];
  themeMode.value = next;
  try {
    localStorage.setItem("zhiyu_theme", next);
  } catch (e) {
    /* 隐私模式下写不进去，忽略 */
  }
  applyTheme(next);
  return next;
}

export const themeLabel = computed(() => {
  return { auto: "跟随系统", light: "浅色", dark: "深色" }[themeMode.value] || "跟随系统";
});

export const themeIcon = computed(() => {
  return { auto: "◐", light: "☀", dark: "☾" }[themeMode.value] || "◐";
});
