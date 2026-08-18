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
 *
 * 2026-08-17 第三輪（SIR 睇完改版後的四項指示，本檔負責其中兩項）：
 *   3. 語言／主題兩個掣改成**淨圖示**（行內 SVG，見下面圖示區）。tap
 *      target 維持 44×44（--tap），aria-label 原封不動（文字冇咗之後，
 *      aria-label 就係螢幕閱讀器使用者唯一攞到嘅說明），另加 title 令
 *      桌面滑鼠停留時有提示。圖示會跟狀態換（月／日、A／文）。
 *   4.「用戶加至主畫面可唔可以用一個 pop up button 連去幫佢做」——原本
 *      淨係一句文字提示，改成一個安裝彈出卡：Chromium 上係真・一撳安裝
 *      （用收起咗嘅 beforeinstallprompt），iOS 上係圖解步驟（Apple 冇提
 *      供任何 API，網頁無論如何觸發唔到「加入主畫面」，所以唔扮）。四種
 *      形態由 js/lib/install.js 的純函式 installUiMode() 決定，呢個檔淨
 *      係負責畫。
 */
import { call } from '../api.js';
import { state, saveSession, applyTheme, loadPublicConfig } from '../state.js';
import { loadLang, currentLang, t } from '../i18n.js';
import { daysUntil } from '../lib/dates.js';
import {
  isStandalone, isIosDevice, isInstallHintDismissed, dismissInstallHint,
  installUiMode, hasInstallPrompt, isInstalledThisSession,
  triggerInstall, subscribeInstallState,
} from '../lib/install.js';
import { navigate } from '../main.js';

/* ------------------------------------------------------------------ 圖示
 *
 * 全部係行內 SVG：冇 icon font、冇 CDN、冇 emoji（emoji 喺唔同平台／唔同
 * 字型會變樣，亦唔跟主題色）。每個都用 currentColor，所以光暗主題自動跟
 * 按鈕的文字色走，唔使各寫一套。
 *
 * 一律加 aria-hidden="true" + focusable="false"：圖示本身唔應該被螢幕
 * 閱讀器讀出（讀「圖形」冇意義），亦唔應該喺 IE/舊 Edge 攞到焦點。文字
 * 說明百分百由外層 <button> 的 aria-label 提供。
 */

/** 語言切換圖示：地球圈 + **目標語言**的字符（同原本文字掣一致——原本
 *  中文介面顯示 "English"，即撳落去會變成的語言）。中文介面顯示 A（拉丁
 *  字母＝英文），英文介面顯示 文。 */
function iconLang(glyph) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" stroke-width="1.6"/>
      <path d="M4.9 6.4h14.2M4.9 17.6h14.2" stroke="currentColor" stroke-width="1.1" opacity="0.45"/>
      <text class="icon-glyph" x="12" y="15.5" text-anchor="middle" font-size="9.5" fill="currentColor">${glyph}</text>
    </svg>`;
}

/** 月亮＝撳落去轉深色（現時淺色）。 */
const ICON_MOON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M20.4 14.7A8.7 8.7 0 0 1 9.3 3.6a8.7 8.7 0 1 0 11.1 11.1z"/>
  </svg>`;

/** 太陽＝撳落去轉淺色（現時深色）。 */
const ICON_SUN = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="4.1"/>
    <path d="M12 2.6v2.5M12 18.9v2.5M4.36 4.36l1.77 1.77M17.87 17.87l1.77 1.77M2.6 12h2.5M18.9 12h2.5M4.36 19.64l1.77-1.77M17.87 6.13l1.77-1.77"/>
  </svg>`;

/** 「加至主畫面」＝圓角方框加十字（安裝提示的標題圖示）。 */
const ICON_ADD_HOME = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.6"/>
    <path d="M12 8.4v7.2M8.4 12h7.2"/>
  </svg>`;

/** iOS「分享」符號（方框 + 向上箭嘴）——iOS 步驟一要撳嘅就係佢，畫出嚟
 *  比寫「按分享」清楚得多。 */
const ICON_IOS_SHARE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 3.2v11.3"/>
    <path d="M8.3 6.9 12 3.2l3.7 3.7"/>
    <path d="M7.2 9.9H5.6A1.9 1.9 0 0 0 3.7 11.8v7.1a1.9 1.9 0 0 0 1.9 1.9h12.8a1.9 1.9 0 0 0 1.9-1.9v-7.1a1.9 1.9 0 0 0-1.9-1.9h-1.6"/>
  </svg>`;

const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
    <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4"/>
  </svg>`;

// T11 fix round 1：全新瀏覽器（未曾登入過、state.config 是空物件）沒有任
// 何管道知道 dse_start_date／語錄——一律經 ensurePublicConfig() 背景讀取
// 一次（見 js/state.js 的 loadPublicConfig()）。用簡單的旗標（不是
// per-root 快取）避免使用者連續切換語言／主題、renderLogin() 被連續呼叫
// 多次時重複發同一個請求；同一個 module 生命週期內只嘗試一次，成功與否
// 都不重試——重試不是這輪要處理的需求，見 loadPublicConfig() 的文件註解。
let publicConfigAttempted = false;

// 安裝狀態訂閱的退訂函式（每次 renderLogin() 開頭先退舊嘅，見下面）。
let unsubscribeInstall = null;

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

/* daysUntil() 本來喺呢度自己實作一次；T13 月曆頂欄都要同一個倒數，所以
 * 搬咗去 js/lib/dates.js（純日期邏輯的正屋），行為完全不變：已過期／
 * 格式不符一律 0。 */

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

/**
 * 安裝彈出卡的 HTML。mode 由 installUiMode() 決定（'hidden'／'button'／
 * 'ios'／'hint'），呢度只負責畫，唔再自己判斷平台。
 *
 * 刻意**唔用** position:fixed 的浮層／bottom sheet：需求明寫「must not
 * trap focus or block the login form」，而固定定位嘅卡喺矮螢幕（橫向、
 * 細機）會蓋住登入掣。改為留喺文件流入面、用陰影同動畫做出「彈出嚟」嘅
 * 感覺，永遠唔可能遮住表單，亦唔需要 focus trap（撳 Tab 順住次序走出去
 * 就得，唔會被困）。
 *
 * @param {string} note 撳完安裝掣之後嘅回饋句（取消／不可用），冇就傳空字串。
 */
function installPopMarkup(mode, note) {
  if (mode === 'hidden') return '';

  const head = `
    <button type="button" class="install-pop-close" id="install-close"
            aria-label="${t('install.close')}" title="${t('install.close')}">${ICON_CLOSE}</button>
    <div class="install-pop-head">
      <span class="install-pop-icon">${ICON_ADD_HOME}</span>
      <div class="install-pop-headtext">
        <div class="install-pop-title">${t('install.title')}</div>
        <p class="install-pop-body">${t('install.prompt')}</p>
      </div>
    </div>`;

  // Chromium：真・一撳安裝。撳落去會彈系統原生安裝對話框。
  const button = `
    <div class="install-pop-actions">
      <button type="button" class="btn btn-primary" id="install-go">${t('install.android')}</button>
      <button type="button" class="btn" id="install-later">${t('install.dismiss')}</button>
    </div>`;

  // iOS Safari：冇任何 API 可以代撳，唯有畫清楚兩步。步驟圖示同 iOS 上
  // 真正見到嘅符號一致（分享符號、加號方框），唔止一行乾文字。
  const ios = `
    <div class="install-steps-title">${t('install.iosTitle')}</div>
    <ol class="install-steps">
      <li class="install-step">
        <span class="install-step-num">1</span>
        <span class="install-step-glyph">${ICON_IOS_SHARE}</span>
        <span class="install-step-text">${t('install.iosStep1')}</span>
      </li>
      <li class="install-step">
        <span class="install-step-num">2</span>
        <span class="install-step-glyph">${ICON_ADD_HOME}</span>
        <span class="install-step-text">${t('install.iosStep2')}</span>
      </li>
    </ol>
    <div class="install-pop-actions">
      <button type="button" class="btn" id="install-later">${t('install.dismiss')}</button>
    </div>`;

  // 其餘瀏覽器（桌面 Safari／Firefox…）：冇 beforeinstallprompt 又唔係
  // iOS，只可以老實講一句「去瀏覽器選單揀安裝」。
  const hint = `
    <p class="install-pop-hint">${t('install.hint')}</p>
    <div class="install-pop-actions">
      <button type="button" class="btn" id="install-later">${t('install.dismiss')}</button>
    </div>`;

  const bodyByMode = { button, ios, hint };
  const noteHtml = note ? `<p class="install-pop-note" role="status">${note}</p>` : '';

  return `<section class="install-pop" aria-label="${t('install.title')}">`
    + head + (bodyByMode[mode] || hint) + noteHtml + '</section>';
}

export function renderLogin(root) {
  const config = state.config || {};
  const quote = pickQuote(config);
  const range = schoolYearRange(config.dse_start_date);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const notice = state.params && state.params.notice;
  const lang = currentLang();

  // 上一次 render 留低嘅訂閱要先退掉，否則每切換一次語言／主題就會多一
  // 個指住已被替換 DOM 的 callback。
  if (unsubscribeInstall) { unsubscribeInstall(); unsubscribeInstall = null; }

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
          <!-- 淨圖示掣（SIR 指示）。aria-label 保留原本 i18n 字串——文字
               冇咗之後佢就係螢幕閱讀器使用者唯一嘅說明；title 另外講埋
               「撳落去會變成點」，桌面滑鼠停留就見到。 -->
          <div class="login-tools">
            <button type="button" class="btn btn-icon" id="lang-toggle"
                    aria-label="${t('settings.language')}" title="${t('settings.langSwitchTo')}"
                    >${iconLang(lang === 'zh' ? 'A' : '文')}</button>
            <button type="button" class="btn btn-icon" id="theme-toggle"
                    aria-label="${t('settings.theme')}"
                    title="${theme === 'dark' ? t('settings.themeToLight') : t('settings.themeToDark')}"
                    >${theme === 'dark' ? ICON_SUN : ICON_MOON}</button>
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

        <!-- 安裝彈出卡只重畫呢一格（見下面 paintInstall()）：
             beforeinstallprompt 隨時會喺使用者打緊帳密時到達，整份重畫
             會抹走佢啱啱打嘅嘢。 -->
        <div id="install-slot"></div>

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

  // ---------------------------------------------------------- 安裝彈出卡
  const slot = root.querySelector('#install-slot');

  /** 只重畫 #install-slot 一格。note 係撳完安裝掣之後嘅回饋句（可空）。 */
  function paintInstall(note = '') {
    const mode = installUiMode({
      standalone: isStandalone(),
      dismissed: isInstallHintDismissed(),
      canPrompt: hasInstallPrompt(),
      ios: isIosDevice(),
      installed: isInstalledThisSession(),
    });
    slot.innerHTML = installPopMarkup(mode, note);

    const closeBtn = slot.querySelector('#install-close');
    const laterBtn = slot.querySelector('#install-later');
    // 「×」同「稍後再說」做同一件事：記住使用者唔想再見到（同原本嘅提示
    // 一樣寫入 localStorage），下次開都唔會再彈。
    [closeBtn, laterBtn].forEach((btn) => btn && btn.addEventListener('click', () => {
      dismissInstallHint();
      paintInstall();
    }));

    const goBtn = slot.querySelector('#install-go');
    if (goBtn) {
      goBtn.addEventListener('click', async () => {
        goBtn.disabled = true;
        const result = await triggerInstall();
        if (!root.isConnected) return;          // 期間已經導去別處
        if (result === 'accepted') {
          slot.innerHTML = `<p class="install-done" role="status">${t('install.installed')}</p>`;
          return;
        }
        // 使用者撳咗取消（或事件已失效）。beforeinstallprompt 用完即棄，
        // 所以呢刻會退回 'hint' 形態；Chromium 之後符合條件時會再發一次
        // 事件，訂閱收到就會自動變返「安裝」掣。
        paintInstall(result === 'dismissed' ? t('install.cancelled') : t('install.hint'));
      });
    }
  }

  paintInstall();
  // beforeinstallprompt／appinstalled 到達時只更新呢一格。畫面已經被
  // 換走（導去其他 view）就自己退訂，唔好向已 detach 嘅節點寫嘢。
  unsubscribeInstall = subscribeInstallState(() => {
    if (!root.isConnected) {
      if (unsubscribeInstall) { unsubscribeInstall(); unsubscribeInstall = null; }
      return;
    }
    paintInstall();
  });

  ensurePublicConfig(root);
}
