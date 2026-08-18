/*
 * 月曆畫面 —— 學生登入後的首頁，亦係佢每日都會開嗰一版。
 *
 * 版面對齊 SIR 核准嘅 docs/ui-mockup-calendar.html。個 mockup 係靜態樣板
 * （硬寫假資料 + inline CSS），只定「樣」唔定實作：呢度全部用 css/app.css
 * 既有嘅 .bento/.cell 系統同 .calendar-grid，唔照抄佢啲 inline style。
 *
 * ── 三個要記住嘅設計決定 ──────────────────────────────────────────────
 *
 * 1. **格子用深淺藍色表示當日時數**（tintLevel()）。呢個係成版嘢嘅重點：
 *    學生唔使逐格讀數字，一眼掃落去就見到成個月嘅節奏——邊幾個星期密、
 *    邊幾日空白。所以顏色深淺一定要同時數單調對應，唔可以攞去表示其他
 *    意思（例如「有反思」「待同步」），嗰啲一律用細點做記號。
 *
 * 2. **琥珀色細點 = 嗰日寫咗反思**（核准 mockup）。原計劃書寫「有記錄就
 *    出綠點」，但色調已經表達咗「有幾多記錄」，再加一粒綠點係重複資訊；
 *    細點嘅位置留返俾色調表達唔到嘅嘢。待同步標記因此改用**空心圈**
 *    （唔同色之餘連形狀都唔同，色弱使用者一樣分得出），仍然照計劃書帶
 *    title="待同步"。
 *
 * 3. **底部四個頁籤（日曆／週報／試卷／設定）**：SIR 核准加入，原計劃書
 *    冇。今輪只有「月曆」有得去，另外三個係 aria-disabled + 淡色，撳落去
 *    會喺頁籤上面彈一句「『週報』稍後推出」——刻意唔用 disabled 屬性：
 *    disabled 掣喺手機撳落去完全冇反應，睇落似壞咗；有回應嘅淡色頁籤先
 *    講得清「係未做，唔係壞咗」。之後 T15/T16 只需要喺 TABS 加返 view 名。
 *
 * 資料一律經 js/store.js（唔會直接叫 api.js）：先用 getCachedMonth() 同步
 * 畫一次，getMonth() 返到嚟先再畫第二次；fromCache 為真（離線／伺服器錯）
 * 就唔覆寫已經畫咗嘅內容——嗰陣兩者根本同一份資料，重畫只會白白閃一下。
 */
import { state, applyTheme } from '../state.js';
import { t, currentLang, loadLang } from '../i18n.js';
import { hkToday, monthGrid, shiftMonth, daysUntil } from '../lib/dates.js';
import { formatHours, sumHours } from '../lib/format.js';
import { streakDays } from '../lib/stats.js';
import { getMonth, getCachedMonth } from '../store.js';

/*
 * 路由（navigate／handleAuthError）用**動態** import 而唔係頂層 import。
 * js/main.js 頂層有 boot() 副作用（會打後端、會搵 #app 元素），而 main.js
 * 本身又要 import 呢個檔——靜態互相 import 之下，測試檔一 import 呢個模組
 * 就會連 boot() 一齊跑起，喺 tests.html（冇 #app、亦唔應該打真後端）度爆
 * 錯。改成動態 import 之後，只有真係撳落去嗰刻先會攞 main.js；嗰陣 main.js
 * 一定已經載入咗（佢就係 app 嘅入口），所以攞返嘅係同一個 module 實例，
 * 唔會再跑一次 boot()。
 */
const router = () => import('../main.js');

/** 心情 emoji 只喺顯示層出現；資料由頭到尾存 key（happy／ok／…）。 */
export const MOOD_EMOJI = { happy: '😊', ok: '😐', tired: '😫', frustrated: '😤', fired: '🔥' };

/*
 * 色調分界（小時）。三級，對應中學生一日溫習嘅實際分佈：
 *   0            → 冇色（空白日一眼睇得出）
 *   0 < h < 2    → 淺（放學後坐低做份功課嗰種）
 *   2 ≤ h < 4    → 中（一個紮實嘅晚上）
 *   h ≥ 4        → 深（假日／考試前衝刺）
 * 揀 2 同 4 而唔係平均分割（例如 4/8）：時數分佈本身極度偏向細數值，用
 * 平均分割嘅話九成格都會落喺最淺嗰級，成個月睇落一片白，就冇咗「一眼睇
 * 到節奏」呢個作用。
 */
export const TINT_STEPS = [2, 4];

export function tintLevel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (h < TINT_STEPS[0]) return 1;
  if (h < TINT_STEPS[1]) return 2;
  return 3;
}

/**
 * config.exam_dates 係老師喺 Google Sheet 手打嘅 JSON 字串
 * （`{"2026-04-09":"中文",…}`）。打錯（漏引號、用全形引號）唔應該炸咗成
 * 個月曆——一律當「今個月冇考試日」處理。
 */
export function parseExamDates(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [date, subject] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && String(subject).trim()) out[date] = String(subject);
    }
    return out;
  } catch { return {}; }
}

/** byDate 攤平成 stats.js 食得嘅 records（record 本身唔一定帶 date，
 *  離線佇列嗰啲就係由單日編輯畫面直接入嚟，只有 subject_code/hours）。 */
export function flattenRecords(byDate = {}) {
  return Object.entries(byDate).flatMap(([date, day]) =>
    ((day && day.records) || []).map(r => ({ ...r, date })));
}

export function monthTotalHours(byDate = {}) {
  return sumHours(flattenRecords(byDate));
}

/**
 * 連續日數係「由今日數返轉頭」嘅事實，所以只可以喺載入咗嘅月份範圍內數。
 * 若果一路數到今個月一號都仲未斷，就代表個數可能俾窗口切斷咗，要多攞上
 * 個月先數得準（見 renderCalendar 內嘅補讀）。
 */
export function mayExtendStreak(streak, today) {
  return streak > 0 && streak >= Number(String(today).slice(8, 10));
}

/** 42 格嘅資料模型（純資料，唔掂 DOM 亦唔掂 i18n）。 */
export function buildCells(yearMonth, byDate = {}, { today = '', examDates = {} } = {}) {
  const [year, month] = String(yearMonth).split('-').map(Number);
  return monthGrid(year, month).map(({ date, inMonth }) => {
    const day = byDate[date];
    const hours = day ? sumHours(day.records || []) : 0;
    return {
      date,
      dayNumber: Number(date.slice(8, 10)),
      inMonth,
      isToday: date === today,
      hours,
      level: tintLevel(hours),
      mood: (day && day.mood) || '',
      hasReflection: Boolean(day && String(day.reflection || '').trim()),
      pending: Boolean(day && day.pending),
      exam: examDates[date] || '',
    };
  });
}

// ────────────────────────────────────────────────────────────── 顯示層

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const monthName = (month) => t(`calendar.monthNames.${Number(month)}`);

export function monthTitleText(yearMonth) {
  const [year, month] = String(yearMonth).split('-');
  return t('calendar.monthTitle', { year: Number(year), month: monthName(month) });
}

/**
 * 格仔嘅無障礙名稱／滑鼠提示。計劃書要求嘅 `calendar.totalHours`
 *（「2 小時」）喺 47px 闊嘅格入面塞唔落（會斬字或者迫到成行溢出），所以
 * 格內只印數字（核准 mockup 亦係咁），完整字串放喺呢度——螢幕閱讀器同
 * 桌面滑鼠停留都攞得到，資訊冇少。
 */
export function dayLabel(cell) {
  const sep = currentLang() === 'en' ? ', ' : '，';
  const parts = [t('calendar.dayLabel', {
    month: monthName(cell.date.slice(5, 7)), day: cell.dayNumber,
  })];
  if (cell.isToday) parts.push(t('calendar.today'));
  if (cell.hours) parts.push(t('calendar.totalHours', { hours: formatHours(cell.hours) }));
  if (cell.mood && MOOD_EMOJI[cell.mood]) parts.push(t(`mood.${cell.mood}`));
  if (cell.hasReflection) parts.push(t('calendar.hasReflection'));
  if (cell.pending) parts.push(t('calendar.pending'));
  if (cell.exam) parts.push(t('calendar.examDay', { subject: cell.exam }));
  return parts.join(sep);
}

export function dayCellMarkup(cell) {
  const cls = ['cal-day'];
  if (!cell.inMonth) cls.push('is-out');
  if (cell.isToday) cls.push('is-today');
  // 考試日嘅底色蓋過時數色調（考試日係固定、要一眼認得嘅標記），時數
  // 數字照樣印出嚟，資訊唔會少。
  if (cell.exam) cls.push('is-exam');
  else if (cell.level) cls.push(`lv${cell.level}`);

  const label = dayLabel(cell);
  const marks = (cell.hasReflection ? `<span class="cal-dot cal-dot-reflection"></span>` : '')
    + (cell.pending ? `<span class="cal-dot cal-dot-pending" title="${esc(t('calendar.pending'))}"></span>` : '');

  return `<button type="button" class="${cls.join(' ')}" data-date="${cell.date}"`
    + ` aria-label="${esc(label)}" title="${esc(label)}"${cell.isToday ? ' aria-current="date"' : ''}>`
    + `<span class="cal-day-num">${cell.dayNumber}</span>`
    + (cell.hours ? `<span class="cal-day-h">${formatHours(cell.hours)}</span>` : '')
    + (cell.exam ? `<span class="cal-day-exam">${esc(cell.exam)}</span>` : '')
    + (cell.mood && MOOD_EMOJI[cell.mood]
      ? `<span class="cal-day-mood" aria-hidden="true">${MOOD_EMOJI[cell.mood]}</span>` : '')
    + (marks ? `<span class="cal-day-marks" aria-hidden="true">${marks}</span>` : '')
    + '</button>';
}

export function gridMarkup(cells) {
  return cells.map(dayCellMarkup).join('');
}

export function weekdayHeadMarkup() {
  return [1, 2, 3, 4, 5, 6, 7].map(n => `<span>${t(`calendar.weekdays.${n}`)}</span>`).join('');
}

export function legendMarkup(cells) {
  const swatch = lv => `<span class="cal-swatch lv${lv}"></span>`;
  const anyPending = cells.some(c => c.pending);
  return `<span>${t('calendar.legendLess')}${swatch(1)}${swatch(2)}${swatch(3)}${t('calendar.legendMore')}</span>`
    + `<span><span class="cal-dot cal-dot-reflection"></span>${t('calendar.legendReflection')}</span>`
    + (anyPending ? `<span><span class="cal-dot cal-dot-pending"></span>${t('calendar.pending')}</span>` : '');
}

/* 頁籤：view 為 null 即係「今輪未有得去」。之後 T15／T16 補返 view 名就
 * 自動變成可用，唔使再改版面。 */
export const TABS = [
  { key: 'calendar', labelKey: 'nav.calendar', view: 'calendar' },
  { key: 'report', labelKey: 'nav.reportShort', view: null },
  { key: 'papers', labelKey: 'nav.papers', view: null },
  { key: 'settings', labelKey: 'nav.settings', view: null },
];

const TAB_ICON = {
  calendar: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="3.2" y="5" width="17.6" height="15.8" rx="3.4"/><path d="M3.2 9.8h17.6M8.2 3.2v3.4M15.8 3.2v3.4"/></svg>`,
  report: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 20h16"/><path d="M7 20v-6.4M12 20V7.2M17 20v-9.6"/></svg>`,
  papers: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13.6 3.4H7a2.4 2.4 0 0 0-2.4 2.4v12.4A2.4 2.4 0 0 0 7 20.6h10a2.4 2.4 0 0 0 2.4-2.4V9.2z"/><path d="M13.6 3.4v5.8h5.8M8.6 13.4h6.8M8.6 16.8h4.4"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 8h16M4 16h16"/><circle cx="10" cy="8" r="2.3" fill="var(--bg)"/><circle cx="15" cy="16" r="2.3" fill="var(--bg)"/></svg>`,
};

export function tabBarMarkup(activeKey) {
  return TABS.map(tab => {
    const active = tab.key === activeKey;
    const label = t(tab.labelKey);
    const soon = tab.view === null;
    return `<button type="button" class="cal-tab${active ? ' is-active' : ''}${soon ? ' is-soon' : ''}"`
      + ` data-tab="${tab.key}"${active ? ' aria-current="page"' : ''}`
      + (soon ? ` aria-disabled="true" title="${esc(t('nav.comingSoon'))}"` : '')
      + ` aria-label="${esc(soon ? `${label}（${t('nav.comingSoon')}）` : label)}">`
      + `<span class="cal-tab-icon">${TAB_ICON[tab.key] || ''}</span>`
      + `<span class="cal-tab-label">${esc(label)}</span></button>`;
  }).join('');
}

/** 頂欄第二行：屆別 + DSE 倒數（攞唔到 dse_start_date 就淨係屆別）。 */
export function headSubText(actor = {}, config = {}, today = hkToday()) {
  const cohort = actor.cohort || '';
  const days = daysUntil(config.dse_start_date, today);
  if (!cohort && !days) return '';
  if (!days) return t('calendar.headSubNoCountdown', { cohort });
  return t('calendar.headSub', { cohort, days });
}

const ICON_MOON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.4 14.7A8.7 8.7 0 0 1 9.3 3.6a8.7 8.7 0 1 0 11.1 11.1z"/></svg>`;
const ICON_SUN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.5M12 18.9v2.5M4.36 4.36l1.77 1.77M17.87 17.87l1.77 1.77M2.6 12h2.5M18.9 12h2.5M4.36 19.64l1.77-1.77M17.87 6.13l1.77-1.77"/></svg>`;
const iconLang = (glyph) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.1" stroke="currentColor" stroke-width="1.6"/><path d="M4.9 6.4h14.2M4.9 17.6h14.2" stroke="currentColor" stroke-width="1.1" opacity="0.45"/><text class="icon-glyph" x="12" y="15.5" text-anchor="middle" font-size="9.5" fill="currentColor">${glyph}</text></svg>`;

/** 成版嘅 HTML（純字串，方便唔起瀏覽器都測到）。 */
export function calendarMarkup(model) {
  const { yearMonth, cells, name, sub, totalHours, streak, theme, lang } = model;
  return `
    <div class="container cal-shell">
      <header class="cal-bar">
        <div class="cal-who">
          <div class="cal-name">${esc(name)}</div>
          ${sub ? `<div class="cal-sub">${esc(sub)}</div>` : ''}
        </div>
        <div class="cal-tools">
          <button type="button" class="btn btn-icon" id="cal-lang"
                  aria-label="${esc(t('settings.language'))}" title="${esc(t('settings.langSwitchTo'))}"
                  >${iconLang(lang === 'zh' ? 'A' : '文')}</button>
          <button type="button" class="btn btn-icon" id="cal-theme"
                  aria-label="${esc(t('settings.theme'))}"
                  title="${esc(theme === 'dark' ? t('settings.themeToLight') : t('settings.themeToDark'))}"
                  >${theme === 'dark' ? ICON_SUN : ICON_MOON}</button>
        </div>
      </header>

      <div class="bento cal-stats">
        <div class="cell cell-half cell-brand cal-stat">
          <div class="cal-stat-n">${formatHours(totalHours)}</div>
          <div class="cal-stat-l">${t('calendar.monthHours')}</div>
        </div>
        <div class="cell cell-half cal-stat">
          <div class="cal-stat-n">${streak}</div>
          <div class="cal-stat-l">${t('calendar.streak')}</div>
        </div>
      </div>

      <div class="cal-nav">
        <button type="button" class="btn btn-icon cal-navbtn" id="cal-prev"
                aria-label="${esc(t('calendar.prev'))}" title="${esc(t('calendar.prev'))}">‹</button>
        <h2 class="cal-month" id="cal-month" aria-live="polite">${esc(monthTitleText(yearMonth))}</h2>
        <button type="button" class="btn btn-icon cal-navbtn" id="cal-next"
                aria-label="${esc(t('calendar.next'))}" title="${esc(t('calendar.next'))}">›</button>
      </div>

      <div class="cal-dow" aria-hidden="true">${weekdayHeadMarkup()}</div>
      <div class="calendar-grid cal-grid" id="cal-grid">${gridMarkup(cells)}</div>
      <div class="cal-legend">${legendMarkup(cells)}</div>

      <p class="cal-toast" id="cal-toast" role="status" hidden></p>
      <nav class="cal-tabbar" aria-label="${esc(t('nav.calendar'))}">${tabBarMarkup('calendar')}</nav>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────── 畫面

/*
 * 每次 renderCalendar() 開頭遞增。await 返嚟之後對唔上（使用者已經撳咗
 * 上／下個月、或者去咗第二版）就唔好再畫——遲到嘅回應覆寫新畫面係
 * 「撳快兩下就見到上個月資料」嗰類 bug 嘅源頭。
 */
let seq = 0;

// 為咗數連續日數而額外攞過嘅月份，一個 session 內每個月只攞一次。
const streakFetched = new Set();

let toastTimer = null;

function showToast(root, message) {
  const el = root.querySelector('#cal-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el.isConnected) el.hidden = true; }, 2200);
}

/** 連續日數：由今日數返轉頭，資料窗口＝今個月 + 上個月（同步讀鏡像）。 */
function computeStreak(byDate, yearMonth, studentId, today) {
  const todayMonth = today.slice(0, 7);
  const maps = [
    yearMonth === todayMonth ? byDate : getCachedMonth(todayMonth, studentId),
    getCachedMonth(shiftMonth(todayMonth, -1), studentId),
  ];
  return streakDays(maps.flatMap(flattenRecords), today);
}

export async function renderCalendar(root, opts = {}) {
  const my = ++seq;
  const params = { ...(state.params || {}), ...opts };
  const actor = state.actor || {};
  const isTeacher = actor.kind === 'teacher';
  // 學生永遠唔會送 studentId（後端亦一律無視），只有老師睇學生先會帶。
  const studentId = isTeacher && params.studentId ? String(params.studentId) : null;

  if (!state.cursorMonth) state.cursorMonth = hkToday().slice(0, 7);
  const yearMonth = state.cursorMonth;
  const today = hkToday();
  const examDates = parseExamDates((state.config || {}).exam_dates);

  const paint = (byDate) => {
    const cells = buildCells(yearMonth, byDate, { today, examDates });
    root.innerHTML = calendarMarkup({
      yearMonth,
      cells,
      name: (currentLang() === 'en' ? actor.name_en : actor.name_zh) || actor.name_zh || actor.id || '',
      sub: studentId
        ? `${t('teacher.student')} ${studentId}`
        : headSubText(actor, state.config || {}, today),
      totalHours: monthTotalHours(byDate),
      streak: computeStreak(byDate, yearMonth, studentId, today),
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      lang: currentLang(),
    });
    bind(byDate);
  };

  const bind = (byDate) => {
    const go = (delta) => {
      state.cursorMonth = shiftMonth(state.cursorMonth, delta);
      renderCalendar(root, opts);
    };
    root.querySelector('#cal-prev').addEventListener('click', () => go(-1));
    root.querySelector('#cal-next').addEventListener('click', () => go(1));

    root.querySelector('#cal-grid').addEventListener('click', async (e) => {
      const btn = e.target.closest('.cal-day');
      if (!btn) return;
      const { navigate } = await router();
      navigate('dayEditor', {
        date: btn.dataset.date,
        // 老師身分一律唯讀開啟（後端亦唔會接受老師代學生寫入）。
        ...(studentId ? { studentId } : {}),
        ...(isTeacher ? { readOnly: true } : {}),
      });
    });

    root.querySelector('#cal-lang').addEventListener('click', async () => {
      const next = currentLang() === 'zh' ? 'en' : 'zh';
      await loadLang(next);
      localStorage.setItem('lang', next);
      if (my === seq) paint(byDate);
    });

    root.querySelector('#cal-theme').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('theme', next);
      paint(byDate);
    });

    root.querySelectorAll('.cal-tab').forEach((btn) => btn.addEventListener('click', async () => {
      const tab = TABS.find(x => x.key === btn.dataset.tab);
      if (!tab) return;
      if (tab.view === 'calendar') return;                 // 已經喺呢版
      if (!tab.view) { showToast(root, t('nav.comingSoonToast', { name: t(tab.labelKey) })); return; }
      (await router()).navigate(tab.view);
    }));
  };

  // 1) 先用本地鏡像（同佇列）即刻畫一次，唔使等網絡。
  paint(getCachedMonth(yearMonth, studentId));

  // 2) 攞新資料。getMonth() 內部已經吞晒離線／伺服器錯（回 fromCache），
  //    只有 AUTH_EXPIRED 會擲出，交返俾路由層導去登入頁。
  let fresh;
  try {
    fresh = await getMonth(yearMonth, studentId);
  } catch (err) {
    await (await router()).handleAuthError(err);
    return;
  }
  if (my !== seq || !root.isConnected) return;
  if (fresh.fromCache) return;                              // 同已顯示嘅係同一份，唔重畫
  paint(fresh.byDate);

  // 3) 若果連續日數一路數到今個月一號都未斷，即係可能俾「只載入咗今個
  //    月」呢個窗口切斷咗，補讀上個月再數一次（每個月每個 session 一次）。
  const todayMonth = today.slice(0, 7);
  const prevMonth = shiftMonth(todayMonth, -1);
  const key = `${studentId || 'self'}:${prevMonth}`;
  if (!streakFetched.has(key)
      && mayExtendStreak(computeStreak(fresh.byDate, yearMonth, studentId, today), today)) {
    streakFetched.add(key);
    try { await getMonth(prevMonth, studentId); } catch { return; }
    if (my !== seq || !root.isConnected) return;
    paint(yearMonth === todayMonth ? fresh.byDate : getCachedMonth(yearMonth, studentId));
  }
}

/** 測試專用：清走模組內部狀態。 */
export function resetCalendarForTests() {
  seq = 0;
  streakFetched.clear();
  clearTimeout(toastTimer);
}
