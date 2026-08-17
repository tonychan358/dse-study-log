import { state, loadSession, saveSession, clearSession, applyTheme } from './state.js';
import { loadLang, currentLang } from './i18n.js';
import { call } from './api.js';
import { renderLogin } from './views/login.js';

const views = { login: renderLogin };   // 後續 task 逐一補上

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
