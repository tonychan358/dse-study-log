/*
 * 登入畫面 —— 未登入時的唯一畫面。
 * Bento Grid 改版（2026-08-17，見 ../../DESIGN.md）：用 css/app.css 的
 * .bento/.cell 系統砌出 docs/ui-mockup-login.html 核准的版面（logo
 * mark + 標題列、深色倒數 hero cell、兩個色調小 cell、表單），markup
 * 對齊 mockup，但只用既有通用元件（.container/.field/.btn/.btn-primary）
 * 加新的 bento 系統類別，不另外發明版面。
 *
 * 行為完全不變：只係換皮，邏輯（ensurePublicConfig／daysUntil／
 * pickQuote／表單提交）原封不動。#login-quote 喺 mockup 冇畫出嚟（mockup
 * 用兩個固定文案 tip cell 取代咗個位），但語錄係已有嘅真實後端功能
 * （config.quotes_zh/quotes_en），「no behaviour changes」係硬性要求，
 * 所以保留呢個元素：預設 hidden、有資料先出現，跟倒數果吓一樣嘅
 * graceful degrade 手法，唔會喺冇資料時佔位或者令表單走樣。
 */
import { call } from '../api.js';
import { state, saveSession, applyTheme, loadPublicConfig } from '../state.js';
import { loadLang, currentLang, t } from '../i18n.js';
import { hkToday } from '../lib/dates.js';
import {
  isStandalone, shouldShowInstallHint, isIosDevice,
  isInstallHintDismissed, dismissInstallHint,
} from '../lib/install.js';
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

/** 用最新的 state.config 就地更新倒數 cell／副標題年份／語錄三個節點；
 *  找不到就代表畫面已經導去別處（DOM 已被替換），安靜地什麼都不做——
 *  不是錯誤。 */
function updateCountdownAndQuote(root) {
  const config = state.config || {};
  const countdownEl = root.querySelector('#login-countdown');
  if (config.dse_start_date && countdownEl) {
    const days = daysUntil(config.dse_start_date);
    countdownEl.innerHTML = `<div class="cell-number">${days}</div><div class="cell-label">${t('login.countdownLabel')}</div>`;
    countdownEl.hidden = false;
  }
  const subtitleEl = root.querySelector('#login-subtitle');
  const year = yearFrom(config.dse_start_date);
  if (year && subtitleEl) {
    subtitleEl.textContent = t('login.subtitle', { year });
  }
  // 語錄係綠色 cell 的內文；連 kicker 一齊由「固定文案」切換成「每日一句」，
  // 否則會出現 kicker 寫住固定標題、內文卻係語錄的錯配。
  const quoteEl = root.querySelector('#login-quote');
  const quote = pickQuote(config);
  if (quote && quoteEl) {
    quoteEl.textContent = quote;
    const kickerEl = quoteEl.parentElement && quoteEl.parentElement.querySelector('.cell-kicker');
    if (kickerEl) kickerEl.textContent = t('login.quoteKicker');
  }
}

/** dateStr 的年份（'YYYY-MM-DD' 的前 4 位）；格式不符回傳空字串。 */
function yearFrom(dateStr) {
  const raw = String(dateStr || '').slice(0, 4);
  return /^\d{4}$/.test(raw) ? raw : '';
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
  const year = yearFrom(config.dse_start_date);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const notice = state.params && state.params.notice;
  const markLetter = t('app.name').charAt(0);

  const showInstallHint = shouldShowInstallHint({
    standalone: isStandalone(),
    dismissed: isInstallHintDismissed(),
  });
  const isIos = isIosDevice();

  root.innerHTML = `
    <div class="container">
      <div class="login-shell">
        <div class="login-top">
          <button type="button" class="btn" id="lang-toggle" aria-label="${t('settings.language')}">${currentLang() === 'zh' ? 'English' : '中文'}</button>
          <button type="button" class="btn" id="theme-toggle" aria-label="${t('settings.theme')}">${theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}</button>
        </div>

        <div class="login-head">
          <div class="login-mark" aria-hidden="true">${markLetter}</div>
          <div>
            <h1>${t('login.title')}</h1>
            <p class="login-subtitle" id="login-subtitle">${year ? t('login.subtitle', { year }) : t('login.brandTeam')}</p>
          </div>
        </div>

        <div class="bento" style="margin-bottom:var(--gap);">
          <div class="cell cell-full cell-dark" id="login-countdown"${config.dse_start_date ? '' : ' hidden'}>
            <div class="cell-number">${days}</div>
            <div class="cell-label">${t('login.countdownLabel')}</div>
          </div>
          <!-- 語錄住喺綠色 cell 入面，唔另外開一行。原本兩者並存：cell 用
               固定文案、下面再有一句動態語錄，撞到「淺色主題啱好抽中同一句
               時睇落似重複、抽中另一句時 cell 就變成無意義填充字」。語錄冇
               資料（未攞到 config／後端舊版）時，cell 退回固定文案，維持兩
               格並排的版面，唔會留低一個空位。 -->
          <div class="cell cell-half cell-accent-green">
            <div class="cell-kicker">${quote ? t('login.quoteKicker') : t('login.tipLogTitle')}</div>
            <div class="cell-sub" id="login-quote">${quote || t('login.tipLogBody')}</div>
          </div>
          <div class="cell cell-half cell-accent-orange">
            <div class="cell-kicker">${t('login.tipHoursTitle')}</div>
            <div class="cell-sub">${t('login.tipHoursBody')}</div>
          </div>
        </div>

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
          <button type="submit" class="btn btn-primary" style="width:100%;">${t('login.submit')}</button>
        </form>

        ${showInstallHint ? `
          <div class="install-hint" style="margin-top:var(--gap);padding:8px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius);background:var(--surface);">
            <p style="margin:0 0 4px;font-size:0.8125rem;color:var(--text-secondary);">${t('install.prompt')}</p>
            ${isIos ? `<p style="margin:0 0 6px;font-size:0.8125rem;color:var(--muted);">${t('install.ios')}</p>` : ''}
            <button type="button" id="install-hint-dismiss" class="btn" style="padding:6px 14px;min-height:36px;font-size:0.8125rem;">${t('install.dismiss')}</button>
          </div>
        ` : ''}
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

  const installDismissBtn = root.querySelector('#install-hint-dismiss');
  if (installDismissBtn) {
    installDismissBtn.addEventListener('click', () => {
      dismissInstallHint();
      renderLogin(root);
    });
  }

  ensurePublicConfig(root);
}
