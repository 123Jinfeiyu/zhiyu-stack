import { ref } from "vue";

export const toastMsg = ref("");
/** 当前登录的用户名，顶栏用它做退出提示（多用户之后得能看出自己是谁） */
export const currentUser = ref("");
export const toastOn = ref(false);
let timer = null;

export function toast(msg) {
  toastMsg.value = msg;
  toastOn.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    toastOn.value = false;
  }, 2200);
}

/** 确认框：不依赖 window.confirm（jsdom/沙箱里常常没有实现），自己画一个。 */
export const confirmState = ref({ open: false, text: "", resolve: null });

export function askConfirm(text) {
  return new Promise((resolve) => {
    confirmState.value = { open: true, text, resolve };
  });
}

export function answerConfirm(ok) {
  const st = confirmState.value;
  st.open = false;
  if (st.resolve) st.resolve(ok);
}
