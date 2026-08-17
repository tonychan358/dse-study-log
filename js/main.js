import { state, loadSession, saveSession, clearSession, applyTheme } from './state.js';
import { loadLang, currentLang } from './i18n.js';
import { call } from './api.js';
import { renderLogin } from './views/login.js';
import { captureInstallPrompt, markInstalled, registerServiceWorker } from './lib/install.js';

const views = { login: renderLogin };   // 後續 task 逐一補上

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
}

export function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  (views[state.view] || views.login)(root);
}

export async function handleAuthError(err) {
  if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_BACKEND') {
    clearSession();                       // 注意：不清離線佇列（見 T12）
    navigate('login', { notice: 'login.expired' });
    return true;
  }
  return false;
}

async function boot() {
  const savedLang = localStorage.getItem('lang') || 'zh';
  await loadLang(savedLang);
  applyTheme(localStorage.getItem('theme') || 'light');

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
