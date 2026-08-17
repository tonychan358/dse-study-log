/*
 * 登入畫面 —— 未登入時的唯一畫面。
 * 只用 css/app.css 已有的通用元件（.container/.card/.field/.btn/
 * .btn-primary），不新增樣式規則：app.css 屬於「consume, do not
 * rewrite」範圍，T11 的視覺需求全部可以用既有元件組出來。
 */
import { call } from '../api.js';
import { state, saveSession, applyTheme, loadPublicConfig } from '../state.js';
import { loadLang, currentLang, t } from '../i18n.js';
import { hkToday } from '../lib/dates.js';
import { navigate } from '../main.js';

// T11 fix round 1：全新瀏覽器（未曾登入過、state.config 是空物件）沒有任
// 何管道知道 dse_start_date／語錄——一律經 ensurePublicConfig() 背景讀取
// 一次（見 js/state.js 的 loadPublicConfig()）。用簡單的旗標（不是
// per-root 快取）避免使用者連續切換語言／主題、renderLogin() 被連續呼叫
// 多次時重複發同一個請求；同一個 module 生命週期內只嘗試一次，成功與否
// 都不重試——重試不是這輪要處理的需求，見 loadPublicConfig() 的文件註解。
let publicConfigAttempted = false;

function ensurePublicConfig(root) {
  if (state.config && state.config.dse_start_date) return; // 已有快取（登入過／已抓過），不用再攞
  if (publicConfigAttempted) return;
  publicConfigAttempted = true;
  loadPublicConfig().then(() => updateCountdownAndQuote(root));
}

/** 用最新的 state.config 就地更新倒數／語錄兩個節點；找不到就代表畫面已
 *  經導去別處（DOM 已被替換），安靜地什麼都不做——不是錯誤。 */
function updateCountdownAndQuote(root) {
  const config = state.config || {};
  const countdownEl = root.querySelector('#login-countdown');
  if (config.dse_start_date && countdownEl) {
    const days = daysUntil(config.dse_start_date);
    countdownEl.innerHTML = `${t('login.countdown')}<strong>${days}</strong>${t('login.days')}`;
    countdownEl.hidden = false;
  }
  const quoteEl = root.querySelector('#login-quote');
  const quote = pickQuote(config);
  if (quote && quoteEl) {
    quoteEl.textContent = quote;
    quoteEl.hidden = false;
  }
}

/**
 * dateStr 與今天（hkToday()）相差的日數，四捨五入至整日。已過期
 * （dateStr <= 今天）回傳 0。兩者皆為 'YYYY-MM-DD'，用 Date.UTC 比較
 * 純日曆日數差，不涉時分秒，香港沒有 DST 所以無邊界誤差之虞。
 */
function daysUntil(dateStr) {
  const raw = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
  const today = hkToday();
  if (raw <= today) return 0;
  const [ty, tm, td] = today.split('-').map(Number);
  const [ey, em, ed] = raw.split('-').map(Number);
  const diffMs = Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td);
  return Math.round(diffMs / 86400000);
}

/** 依目前語言，從 config.quotes_zh / quotes_en（JSON 字串）隨機揀一句。 */
function pickQuote(config) {
  const raw = currentLang() === 'en' ? config.quotes_en : config.quotes_zh;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return '';
    return String(list[Math.floor(Math.random() * list.length)]);
  } catch {
    return '';
  }
}

export function renderLogin(root) {
  const config = state.config || {};
  const days = daysUntil(config.dse_start_date);
  const quote = pickQuote(config);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const notice = state.params && state.params.notice;

  root.innerHTML = `
    <div class="container">
      <div>
        <button type="button" class="btn" id="lang-toggle" aria-label="${t('settings.language')}">${currentLang() === 'zh' ? 'English' : '中文'}</button>
        <button type="button" class="btn" id="theme-toggle" aria-label="${t('settings.theme')}">${theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}</button>
      </div>

      <div class="card">
        <h1>${t('login.title')}</h1>

        <p id="login-countdown"${config.dse_start_date ? '' : ' hidden'}>${t('login.countdown')}<strong>${days}</strong>${t('login.days')}</p>

        <p id="login-quote" style="font-style:italic;color:var(--text-secondary);"${quote ? '' : ' hidden'}>${quote}</p>

        ${notice ? `<p role="status" style="color:var(--muted);">${t(notice)}</p>` : ''}

        <form id="login-form" novalidate>
          <div class="field">
            <label for="login-id">${t('login.id')}</label>
            <input id="login-id" name="id" type="text" autocomplete="username">
          </div>
          <div class="field">
            <label for="login-password">${t('login.password')}</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password">
          </div>
          <p id="login-error" role="alert" style="color:var(--danger);" hidden></p>
          <button type="submit" class="btn btn-primary">${t('login.submit')}</button>
        </form>
      </div>
    </div>
  `;

  root.querySelector('#lang-toggle').addEventListener('click', async () => {
    const next = currentLang() === 'zh' ? 'en' : 'zh';
    await loadLang(next);
    localStorage.setItem('lang', next);
    renderLogin(root);
  });

  root.querySelector('#theme-toggle').addEventListener('click', () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('theme', next);
    renderLogin(root);
  });

  const form = root.querySelector('#login-form');
  const errorEl = root.querySelector('#login-error');
  const submitBtn = form.querySelector('button[type="submit"]');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const id = form.elements.id.value.trim();
    const password = form.elements.password.value;
    if (!id || !password) {
      showError(t('login.errorEmpty'));
      return;
    }

    submitBtn.disabled = true;
    try {
      const data = await call('login', { id, password });
      saveSession(data);
      applyTheme(data.actor.theme);
      localStorage.setItem('theme', data.actor.theme);
      if (data.actor.lang !== currentLang()) await loadLang(data.actor.lang);
      localStorage.setItem('lang', data.actor.lang);
      navigate(data.actor.kind === 'teacher' ? 'classOverview' : 'calendar');
    } catch (err) {
      if (err.code === 'BAD_CREDENTIALS') showError(t('login.errorWrong'));
      else if (err.code === 'OFFLINE') showError(t('offline.offline'));
      else showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  ensurePublicConfig(root);
}
