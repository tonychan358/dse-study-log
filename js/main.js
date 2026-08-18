import { state, loadSession, saveSession, clearSession, applyTheme } from './state.js';
import { loadLang, currentLang } from './i18n.js';
import { call } from './api.js';
import { renderLogin } from './views/login.js';
import { renderCalendar } from './views/calendar.js';
import { renderDayEditor } from './views/dayEditor.js';
import { captureInstallPrompt, markInstalled, registerServiceWorker } from './lib/install.js';
import { initStore, flushQuietly } from './store.js';

const views = {                                   // 後續 task 逐一補上
  login: renderLogin,
  calendar: renderCalendar,
  dayEditor: renderDayEditor,
};

/*
 * 安裝相關的兩個 window 事件要喺 module 頂層即刻掛（唔可以等 boot() 入面
 * 的 await 做完）：Chromium 喺頁面載入後好快就發 `beforeinstallprompt`，
 * 遲一個 tick 掛 listener 就會走漏，之後永遠等唔到，「安裝」掣亦永遠出唔
 * 到。收起事件之後由 js/lib/install.js 通知登入畫面，畫面只重畫安裝提示
 * 那一小塊，唔會重畫成個表單（使用者可能已經打緊帳密）。
 */
window.addEventListener('beforeinstallprompt', captureInstallPrompt);
window.addEventListener('appinstalled', markInstalled);

// SW 係 beforeinstallprompt 的先決條件（亦提供離線 fallback）。註冊失敗
// 一律安靜略過，app 照用——見 registerServiceWorker() 的註解。
registerServiceWorker();

export function navigate(view, params = {}) {
  state.view = view; state.params = params;
  render();
  /*
   * 補傳時機之一：每次進入非登入畫面（開機載入 session 之後、或者過期後
   * 重新登入成功）都試一次。放喺呢度而唔係淨係放喺 boot()，係因為「token
   * 過期 → 導回登入頁 → 重新登入」呢條路唔會再行一次 boot()（login 畫面
   * 只係 saveSession + navigate），冇呢個 hook 的話，學生離線打嗰啲嘢就要
   * 等到下次 online 事件先補傳。佇列空嘅時候 flush() 一個請求都唔會發，
   * 所以逐次 navigate 都叫係好平嘅。
   */
  if (view !== 'login' && state.token) flushQuietly();
}

export function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  const view = views[state.view];
  if (view) { view(root); return; }
  /*
   * 未知／今輪未實作嘅畫面（T14 之後仲欠週報、設定、老師全班總覽）。
   * 以前一律退回登入畫面，但學生根本冇登出——喺佢眼中就係「撳一撳
   * 個格就被踢返登入頁」，睇落似壞咗，仲會令人以為要再登入一次。有 token
   * 就退回月曆（佢自己嘅首頁），冇 token 先至係真係要登入。
   */
  console.warn('[route] 未知畫面，已退回預設：', state.view);
  (state.token && views.calendar ? views.calendar : views.login)(root);
}

export async function handleAuthError(err) {
  if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_BACKEND') {
    /*
     * clearSession() 只移除 localStorage 的 `session` 一個 key，**刻意
     * 唔掂 `queue:*`／`mirror:*`**：佇列入面係學生親手打入去、但未落到
     * Google Sheet 的資料，登入過期唔係「唔要嗰啲資料」的理由。佇列 key
     * 用 actor.id 命名（見 js/store.js `queueKey()`），同一個學生重新
     * 登入之後 key 一樣，navigate() 會即刻叫 flushQuietly() 自動補傳。
     */
    clearSession();
    navigate('login', { notice: 'login.expired' });
    return true;
  }
  return false;
}

async function boot() {
  const savedLang = localStorage.getItem('lang') || 'zh';
  await loadLang(savedLang);
  applyTheme(localStorage.getItem('theme') || 'light');

  /*
   * 喺 navigate() 之前先 initStore()：狀態列同 online/offline 監聽都唔
   * 需要 token（未登入時離線一樣要見到「離線中」），而且要喺第一次
   * navigate() 觸發背景補傳之前已經有訂閱者，狀態列先會即刻更新。
   */
  initStore({ onAuthError: handleAuthError });

  if (loadSession()) {
    applyTheme(state.actor.theme);
    if (state.actor.lang !== currentLang()) await loadLang(state.actor.lang);
    navigate(state.actor.kind === 'teacher' ? 'classOverview' : 'calendar');
    try {
      saveSession({ ...(await call('bootstrap', {}, state.token)), token: state.token });
    } catch (err) { await handleAuthError(err); }   // 離線則沿用本地 session
  } else {
    navigate('login');
  }
}

boot();
