/** 极简路由：/ 、/n/3/7 、/s/<token>。
 *
 * 不用 vue-router 是因为只需要三种形态 —— 一个正则 + popstate 就够了。
 * 刷新不丢位置靠的是 pushState 而不是 hash，分享出去的链接也干净。
 */
import { ref } from "vue";

export function parse(pathname) {
  const share = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (share) return { name: "share", token: share[1], path: [] };
  const tree = /^\/n\/([\d/]+)\/?$/.exec(pathname);
  if (tree) {
    const ids = tree[1]
      .split("/")
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    return { name: "tree", path: ids };
  }
  return { name: "tree", path: [] };
}

export const route = ref(parse(typeof location === "undefined" ? "/" : location.pathname));

export function urlOf(to) {
  if (to.name === "share") return "/s/" + to.token;
  return to.path && to.path.length ? "/n/" + to.path.join("/") : "/";
}

export function navigate(to, replace = false) {
  const url = urlOf(to);
  if (!replace && url !== location.pathname) {
    history.pushState({}, "", url);
  } else if (replace) {
    history.replaceState({}, "", url);
  }
  route.value = { ...to };
  if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
    try {
      window.scrollTo(0, 0);
    } catch (e) {
      /* jsdom 里没实现，忽略 */
    }
  }
}

export function startRouter() {
  if (typeof window === "undefined") return;
  window.addEventListener("popstate", () => {
    route.value = parse(location.pathname);
  });
}
