/** 薄薄一层 fetch 封装：统一错误、401 回调、JSON 编解码。 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

async function req(method, url, body) {
  const headers = { "X-Zhiyu": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      // X-Zhiyu 是「自定义头」：跨站页面想带它就必然触发 CORS 预检，而本服务
      // 不回 CORS 头 → 预检失败。所以服务端看到这个头就可以确信不是跨站伪造。
      // 同源请求不会被预检，加这个头零成本。
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError("连不上服务器（" + (e && e.message ? e.message : e) + "）", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (res.status === 401) {
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError((data && data.error) || "未登录", 401);
  }
  if (!res.ok || !data || data.ok === false) {
    throw new ApiError((data && data.error) || "HTTP " + res.status, res.status);
  }
  return data;
}

const q = (s) => encodeURIComponent(s);

export const api = {
  me: () => req("GET", "/api/me"),
  login: (username, password) => req("POST", "/api/login", { username, password }),
  register: (username, password, invite) =>
    req("POST", "/api/register", { username, password, invite: invite || "" }),
  logout: () => req("POST", "/api/logout", {}),
  changePassword: (oldPw, newPw) => req("POST", "/api/password", { old: oldPw, new: newPw }),

  tree: () => req("GET", "/api/tree"),
  node: (id) => req("GET", "/api/nodes/" + (id || 0)),
  search: (kw, root) => req("GET", "/api/search?q=" + q(kw) + "&root=" + (root || 0)),

  create: (payload) => req("POST", "/api/nodes", payload),
  update: (id, payload) => req("POST", "/api/nodes/" + id + "/update", payload),
  move: (id, pid) => req("POST", "/api/nodes/" + id + "/move", { pid: pid || 0 }),
  remove: (id) => req("POST", "/api/nodes/" + id + "/delete", {}),

  share: (id) => req("POST", "/api/nodes/" + id + "/share", {}),
  revoke: (id) => req("POST", "/api/nodes/" + id + "/share/revoke", {}),
  shareView: (token) => req("GET", "/api/share/" + q(token)),

  exportAll: () => req("GET", "/api/export"),
  importAll: (payload) => req("POST", "/api/import", payload),

  // 业务知识图谱：先要本地图（快），再让模型改名（慢，失败也只是名字朴素）
  kg: () => req("GET", "/api/kg"),
  kgAI: (hash, force) => req("POST", "/api/kg/ai", { hash: hash || "", force: !!force }),

  // 图片上传。multipart 不能走 req()（那个只发 JSON），但错误处理保持同一套
  upload: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    let res;
    try {
      res = await fetch("/api/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Zhiyu": "1" },
        body: fd,
      });
    } catch (e) {
      throw new ApiError("连不上服务器（" + (e && e.message ? e.message : e) + "）", 0);
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.status === 401) {
      if (unauthorizedHandler) unauthorizedHandler();
      throw new ApiError((data && data.error) || "未登录", 401);
    }
    if (!res.ok || !data || data.ok === false) {
      throw new ApiError((data && data.error) || "HTTP " + res.status, res.status);
    }
    return data;
  },
};
