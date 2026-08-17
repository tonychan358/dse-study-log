/*
 * 登入畫面 —— 未登入時的唯一畫面。
 *
 * 2026-08-17 第二輪改版：對齊 SIR 核准嘅 docs/ui-mockup-login.html
 * （參考佢原本 YY3STEAM_HKDSE app 嘅登入版面）。三項明確指示：
 *   1.「唔想用黑色」   → hero 由 .cell-dark 換成藍色漸變 .cell-brand
 *   2.「距離DSE個度想置中」→ 標籤／數字／「日」全部置中（.cell-brand 內建）
 *   3.「中間每日一句及記錄…改下放既位」→ 兩個色調 cell 由表單上面搬到
 *      登入掣下面
 * 另加品牌區塊（第一行學年、第二行計劃名）同底部 credit 行。
 *
 * 版面仍然全部用 css/app.css 既有嘅通用元件（.container/.field/.btn/
 * .btn-primary）加 .bento/.cell 系統，唔另外發明版面；mockup 係靜態
 * 樣板，只定「樣」，唔定實作（佢啲文案係硬寫嘅假資料）。
 *
 * 行為完全不變：邏輯（ensurePublicConfig／daysUntil／pickQuote／表單提交／
 * 語言主題切換／安裝提示）原封不動。所有依賴後端嘅資料（倒數、學年、
 * 語錄）一律 graceful degrade：攞唔到就唔顯示，表單照用。
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

/** 用最新的 state.config 就地更新倒數 cell／品牌區塊學年／語錄三個節點；
 *  找不到就代表畫面已經導去別處（DOM 已被替換），安靜地什麼都不做——
 *  不是錯誤。 */
function updateCountdownAndQuote(root) {
  const config = state.config || {};
  const countdownEl = root.querySelector('#login-countdown');
  if (config.dse_start_date && countdownEl) {
    countdownEl.innerHTML = countdownMarkup(daysUntil(config.dse_start_date));
    countdownEl.hidden = false;
  }
  // 品牌區塊第一行：學年範圍。冇 config 就一直收埋（見 schoolYearRange()）。
  const yearEl = root.querySelector('#login-school-year');
  const range = schoolYearRange(config.dse_start_date);
  if (range && yearEl) {
    yearEl.textContent = t('login.schoolYear', range);
    yearEl.hidden = false;
  }
  // 語錄係藍色 cell 的內文；連 kicker 一齊由「固定文案」切換成「每日一句」，
  // 否則會出現 kicker 寫住固定標題、內文卻係語錄的錯配。
  const quoteEl = root.querySelector('#login-quote');
  const quote = pickQuote(config);
  if (quote && quoteEl) {
    quoteEl.textContent = quote;
    const kickerEl = quoteEl.parentElement && quoteEl.parentElement.querySelector('.cell-kicker');
    if (kickerEl) kickerEl.textContent = t('login.quoteKicker');
  }
}

/** 倒數 hero 的內文：標籤 → 數字 → 單位，三行；置中由 .cell-brand 負責。 */
function countdownMarkup(days) {
  return `<div class="cell-label">${t('login.countdownLabel')}</div>`
    + `<div class="cell-number">${days}</div>`
    + `<div class="cell-unit">${t('login.days')}</div>`;
}

/** dateStr 的年份（'YYYY-MM-DD' 的前 4 位）；格式不符回傳空字串。 */
function yearFrom(dateStr) {
  const raw = String(dateStr || '').slice(0, 4);
  return /^\d{4}$/.test(raw) ? raw : '';
}

/**
 * 品牌區塊第一行嘅學年範圍，由考試年份推算：DSE 喺學年下學期開考，所以
 * 應考 {year} 屆 DSE 嘅學年就係 {year-1} - {year}（例：dse_start_date
 * 係 2027-04-xx → 「2026 - 2027」，同 mockup 一致）。
 *
 * 學年**一定**由資料推算，唔可以寫死。攞唔到 config（離線、或者後端未
 * 通）就回傳 null，呼叫方收埋整行——寧願品牌區塊淨係得第二行計劃名稱，
 * 都好過印出 'NaN - NaN' 或者一條孤零零嘅「-」。呢個同倒數、語錄用緊
 * 同一套 graceful degrade：冇資料就唔出現，資料到咗先就地補上。
 */
function schoolYearRange(dateStr) {
  const year = yearFrom(dateStr);
  if (!year) return null;
  return { from: Number(year) - 1, to: Number(year) };
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
  const quote = pickQuote(config);
  const range = schoolYearRange(config.dse_start_date);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const notice = state.params && state.params.notice;

  const showInstallHint = shouldShowInstallHint({
    standalone: isStandalone(),
    dismissed: isInstallHintDismissed(),
  });
  const isIos = isIosDevice();

  root.innerHTML = `
    <div class="container">
      <div class="login-shell">
        <div class="login-bar">
          <div class="login-brand">
            <!-- 第一行學年純由 config.dse_start_date 推算，攞唔到就整行收埋，
                 淨低第二行計劃名稱（見 schoolYearRange()）。 -->
            <div class="login-brand-year" id="login-school-year"${range ? '' : ' hidden'}>${range ? t('login.schoolYear', range) : ''}</div>
            <h1 class="login-brand-name">${t('login.title')}</h1>
          </div>
          <div class="login-tools">
            <button type="button" class="btn" id="lang-toggle" aria-label="${t('settings.language')}">${currentLang() === 'zh' ? 'English' : '中文'}</button>
            <button type="button" class="btn" id="theme-toggle" aria-label="${t('settings.theme')}">${theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}</button>
          </div>
        </div>

        <div class="cell cell-brand login-hero" id="login-countdown"${config.dse_start_date ? '' : ' hidden'}>
          ${countdownMarkup(daysUntil(config.dse_start_date))}
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

        <!-- 兩個色調 cell 搬咗落登入掣下面（SIR 指示）。語錄住喺藍色 cell
             入面，唔另外開一行：原本兩者並存會撞到「抽中同一句時睇落似重
             複、抽中另一句時 cell 就變成無意義填充字」。語錄冇資料（未攞到
             config／後端舊版）時，cell 退回固定文案，維持兩格並排的版面，
             唔會留低一個空位。 -->
        <div class="bento login-notes">
          <div class="cell cell-half cell-note cell-accent-blue">
            <div class="cell-kicker">${quote ? t('login.quoteKicker') : t('login.tipLogTitle')}</div>
            <div class="cell-sub" id="login-quote">${quote || t('login.tipLogBody')}</div>
          </div>
          <div class="cell cell-half cell-note cell-accent-orange">
            <div class="cell-kicker">${t('login.tipHoursTitle')}</div>
            <div class="cell-sub">${t('login.tipHoursBody')}</div>
          </div>
        </div>

        ${showInstallHint ? `
          <div class="install-hint">
            <p>${t('install.prompt')}</p>
            ${isIos ? `<p style="color:var(--muted);">${t('install.ios')}</p>` : ''}
            <button type="button" id="install-hint-dismiss" class="btn" style="margin-top:2px;padding:6px 14px;min-height:36px;font-size:0.8125rem;">${t('install.dismiss')}</button>
          </div>
        ` : ''}

        <p class="login-credit">${t('login.credit')}</p>
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
