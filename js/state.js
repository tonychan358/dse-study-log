/*
 * 全域 app 狀態 + session 的 localStorage 持久化。
 * 注意：localStorage 只存 token / actor / subjects / config —— 絕不存
 * 密碼（密碼在 Google Sheet 明文儲存已是老師的決定，前端不應該再多一
 * 個明文密碼的落地點）。
 */
import { call } from './api.js';

const KEY = 'session';

export const state = {
  token: null, actor: null, subjects: [], config: {},
  view: 'login', params: {}, cursorMonth: null,
};

/** data 形狀跟 login / bootstrap 的回傳一致：{ token?, actor, subjects, config } */
export function saveSession(data) {
  state.token = data.token ?? state.token;
  state.actor = data.actor;
  state.subjects = data.subjects || [];
  state.config = data.config || {};
  localStorage.setItem(KEY, JSON.stringify({
    token: state.token, actor: state.actor,
    subjects: state.subjects, config: state.config,
  }));
}

/** 回傳 true 表示本地有可用的 session（token 存在）。 */
export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    Object.assign(state, JSON.parse(raw));
    return Boolean(state.token);
  } catch { return false; }
}

export function clearSession() {
  state.token = null; state.actor = null;
  localStorage.removeItem(KEY);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

/**
 * T11 fix round 1：登入畫面在使用者輸入帳密之前就要顯示 DSE 倒數／語錄，
 * 但那時完全沒有 token，唯一可打的是後端新增的免認證白名單 action
 * `getPublicConfig`（見 gas/Code.gs `handleGetPublicConfig()`）。成功就把
 * 回傳的 6 個白名單 key 併入 state.config；失敗（離線、或後端仍是舊版
 * 未有這個 action）一律靜默吞掉、回傳 false —— 呼叫方（登入畫面）不需要
 * 也不應該包 try/catch，這個背景讀取失敗絕對不能讓登入畫面壞掉或卡住，
 * 只是「暫時不顯示倒數」而已，帳號密碼登入完全不受影響。
 *
 * transport 參數用來注入假 transport 方便測試（見
 * tests/state.test.js），預設用真正的 call()，唯一額外好處
 * 是本函式本身跟 `js/main.js` 完全沒有 import 關係——測試檔可以單獨
 * import 它，不會觸發 main.js 頂層的 boot()（main.js 會打真後端、找
 * #app 元素，tests.html 沒有這個元素也不該打真後端）。
 */
export async function loadPublicConfig(transport = call) {
  try {
    const cfg = await transport('getPublicConfig', {});
    Object.assign(state.config, cfg);
    return true;
  } catch {
    return false;
  }
}
