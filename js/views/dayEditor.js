/*
 * 單日編輯 —— 學生每日都會開嘅一版，成個 app 嘅心臟。
 *
 * 版面對齊 SIR 核准嘅 docs/ui-mockup-day.html。個 mockup 係靜態樣板（硬寫
 * 假資料 + inline CSS），只定「樣」唔定實作：呢度全部用 css/app.css 既有嘅
 * 元件同 tokens，唔照抄佢啲 inline style。
 *
 * ── 五個要記住嘅設計決定 ────────────────────────────────────────────────
 *
 * 1. **時數用 ＋／− 掣一級 0.25，唔用打字。** 呢個係核准版面嘅核心：手機
 *    唔會彈鍵盤、冇格式要打錯、單手企喺車上都撳得。**唔可以「改良」成
 *    text input 或者 slider。** 上下限（0 至 12）喺 stepHours() 夾死，撳到
 *    盡頭會出一句提示而唔係靜靜哋冇反應。
 *
 * 2. **只列學生自己揀嘅科**（actor.my_subjects），加一個「＋ 加其他科目」
 *    臨時加。列表次序跟 subjects 表嘅 sort；當日已經有記錄但唔喺自選入面
 *    嗰啲科一定要照出（嗰啲係學生真係記錄過嘅時數，唔可以靜靜哋唔見咗）。
 *
 * 3. **心情存 key（happy／ok／…），emoji 只喺顯示層出現**，同月曆、
 *    buildShareText() 用同一套 MOOD_EMOJI（由 lib/share.js 提供，避免第三份
 *    複本）。tile 上面嘅短標籤（好／普通／攰／灰／爆發）同螢幕閱讀器讀嘅
 *    全稱（開心／普通／疲累／沮喪／衝勁十足）分開兩組 key：短標籤係核准
 *    版面要求，全稱係月曆同無障礙一直用緊嗰套。
 *
 * 4. **「報給老師」用返 lib/share.js 嘅 buildShareText()**，呢度唔會再寫多
 *    一個格式化器。分享階梯（navigator.share → clipboard → execCommand →
 *    可全選 textarea）獨立成純函式 shareText()，注入得 API 所以測得到。
 *    **失敗一定要睇得見同救得返**：任何一級都唔可以靜靜哋乜都唔發生。
 *
 * 5. **儲存之後留喺原地**（唔照計劃書 Step 1 嘅 navigate('calendar')）：
 *    計劃書後來追加嘅需求係「儲存成功後須顯示『報給老師』按鈕」，即刻彈返
 *    月曆嘅話學生根本撳唔到嗰粒掣。改為出一個「已儲存」toast，返月曆交返
 *    俾左上角嘅返回掣。
 *
 * 資料一律經 js/store.js（唔會直接叫 api.js）：先用 getCachedMonth() 同步畫
 * 一次，getMonth() 返到嚟先再畫第二次。saveDay 係**整日覆寫**（送兩次同送
 * 一次結果一樣），呢度照跟——收集成日嘅 rows 再一次過送，唔會變成「追加
 * 一筆」（嗰樣會令離線補傳重播時默默變成雙倍時數，見 store.js 頭註）。
 */
import { state } from '../state.js';
import { t, currentLang } from '../i18n.js';
import { hkToday, weekdayIndex, shiftMonth } from '../lib/dates.js';
import { formatHours, sumHours, HOURS_MAX, HOURS_STEP } from '../lib/format.js';
import { buildShareText, MOOD_EMOJI } from '../lib/share.js';
import { streakDays } from '../lib/stats.js';
import { getMonth, getCachedMonth, saveDay, clearDay, pendingCount } from '../store.js';

/*
 * 路由用**動態** import（同 js/views/calendar.js 一樣嘅理由）：main.js 頂層
 * 有 boot() 副作用，靜態互相 import 會令測試檔一 import 呢個模組就跑起
 * boot()，喺 tests.html 度爆錯。
 */
const router = () => import('../main.js');

/** 心情次序＝核准版面由左到右。資料由頭到尾存 key，emoji 只係顯示。 */
export const MOOD_KEYS = ['happy', 'ok', 'tired', 'frustrated', 'fired'];

const round2 = (n) => Math.round(n * 100) / 100;

// ═══════════════════════════════════════════════════════════════ 純邏輯

/**
 * 把任意輸入夾成一個合法嘅「某科當日時數」：0（即係未記錄）至 12，
 * 0.25 嘅倍數。負數／NaN／空值一律當 0。
 *
 * 注意 lib/format.js 嘅 HOURS_MIN 係 0.25 —— 嗰個係**一筆記錄**嘅下限；
 * 呢度嘅 0 唔係一筆時數為零嘅記錄，而係「呢科今日冇記錄」，儲存時會被
 * rowsToRecords() 濾走，根本唔會寫入後端。
 */
export function clampHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return round2(Math.min(HOURS_MAX, n));
}

/**
 * 撳一下 ＋／− 之後嘅新時數。direction > 0 加一級，< 0 減一級。
 *
 * 先 Math.round(current / HOURS_STEP) 再加減，係為咗把唔喺格上嘅舊資料
 * （例如後端手改過嘅 0.3）順手拉返落 0.25 嘅格；夾到盡頭時回傳值會等於
 * 原值，呼叫方就係靠「冇變」判斷撳到咗上／下限（見 onStep()）。
 */
export function stepHours(current, direction) {
  const base = clampHours(current);
  const steps = Math.round(base / HOURS_STEP) + Math.sign(direction);
  return clampHours(round2(steps * HOURS_STEP));
}

/** 依語言取科目名；科目表冇呢個 code 就照印 code（唔可以顯示成空白）。 */
export function subjectNameOf(subject, code, lang = 'zh') {
  if (!subject) return String(code);
  const zh = String(subject.name_zh || '').trim();
  const en = String(subject.name_en || '').trim();
  return (lang === 'en' ? (en || zh) : (zh || en)) || String(code);
}

/**
 * 砌出畫面上嘅科目列。
 *
 * 次序（同一科唔會出現兩次）：
 *   1. 自選科目，依 subjects 表嘅 sort（呼叫方已排好）
 *   2. 自選咗但科目表已經冇／已停用嗰啲（仍然要俾學生改）
 *   3. 當日已有記錄、但唔喺自選入面嗰啲（例如以前臨時加過）
 *   4. 今次 session 臨時加咗嘅（extra）
 *
 * 同一科當日有幾筆記錄（舊版本可以一日入幾筆同科）會合併成一列：時數相加、
 * content 用「、」串埋——合併係「一科一列」呢個版面嘅必然結果，但唔可以順手
 * 掉咗學生打過嘅字。
 */
export function buildSubjectRows({
  subjects = [], mySubjects = [], records = [], extra = [], lang = 'zh',
} = {}) {
  const byCode = new Map(subjects.map((s) => [String(s.code), s]));
  const mine = new Set(mySubjects.map(String));

  const hours = new Map();
  const contents = new Map();
  for (const r of records) {
    const code = String(r.subject_code);
    hours.set(code, clampHours((hours.get(code) || 0) + Number(r.hours || 0)));
    const text = String(r.content || '').trim();
    if (text) contents.set(code, [...(contents.get(code) || []), text]);
  }

  const order = [];
  const seen = new Set();
  const push = (code) => {
    const c = String(code || '').trim();
    if (c && !seen.has(c)) { seen.add(c); order.push(c); }
  };

  for (const s of subjects) if (mine.has(String(s.code))) push(s.code);
  for (const code of mySubjects) push(code);
  for (const r of records) push(r.subject_code);
  for (const code of extra) push(code);

  return order.map((code) => ({
    code,
    name: subjectNameOf(byCode.get(code), code, lang),
    hours: hours.get(code) || 0,
    content: (contents.get(code) || []).join('、'),
  }));
}

/** 仲有邊啲科可以臨時加（科目表有、但畫面上未有嗰啲）。 */
export function remainingSubjects(subjects = [], rows = [], lang = 'zh') {
  const shown = new Set(rows.map((r) => String(r.code)));
  return subjects
    .filter((s) => !shown.has(String(s.code)))
    .map((s) => ({ code: String(s.code), name: subjectNameOf(s, s.code, lang) }));
}

/** 0 小時嘅科唔會寫入後端（「今日冇溫呢科」唔係一筆記錄）。 */
export function rowsToRecords(rows = []) {
  return rows
    .filter((r) => Number(r.hours) > 0)
    .map((r) => ({ subject_code: r.code, hours: Number(r.hours), content: String(r.content || '') }));
}

export function totalHoursOf(rows = []) {
  return sumHours(rowsToRecords(rows));
}

/**
 * 寫咗註解、但時數係 0 嘅科目。
 *
 * 呢個組合冇地方可以落：`rowsToRecords()` 濾走 0 小時嘅列，後端
 * `classifyHours_()` 亦一樣當 hours 0 係 'omit'（靜默略過，唔算錯），
 * 所以嗰段註解一儲存就會人間蒸發。**呢個係靜默資料遺失，唔可以就咁算**
 * ——畫面靠呢個函式即場出警告，儲存前再 confirm 一次（見 renderDayEditor）。
 */
export function orphanNoteSubjects(rows = []) {
  return rows
    .filter((r) => !(Number(r.hours) > 0) && String(r.content || '').trim())
    .map((r) => ({ code: r.code, name: r.name }));
}

/**
 * 畫面現況嘅快照。`records`／`mood`／`reflection` 就係 saveDay 嘅 payload；
 * `orphanNotes` **唔會**送去後端，只係用嚟計指紋——若果唔計，學生喺一個
 * 0 小時嘅科寫咗註解，畫面會當佢「乜都冇改過」，撳返回時唔會問就直接走，
 * 嗰段字連問都冇問過就冇咗。
 */
export function editorSnapshot(rows = [], mood = '', reflection = '') {
  return {
    records: rowsToRecords(rows),
    mood: mood || '',
    reflection: String(reflection || '').trim(),
    orphanNotes: rows
      .filter((r) => !(Number(r.hours) > 0) && String(r.content || '').trim())
      .map((r) => `${r.code}:${String(r.content).trim()}`)
      .sort(),
  };
}

/**
 * 一日內容嘅指紋，用嚟判斷「改咗未」。科目次序唔算改動（排序後比較），
 * 反思頭尾空白亦唔算——否則學生撳多兩下空白掣，離開時就會無端端被問
 * 「未儲存，確定離開？」。
 */
export function dayFingerprint({
  records = [], mood = '', reflection = '', orphanNotes = [],
} = {}) {
  const recs = records
    .map((r) => `${r.subject_code}:${formatHours(Number(r.hours) || 0)}:${String(r.content || '')}`)
    .sort()
    .join('|');
  return `${recs}||${mood || ''}||${String(reflection || '').trim()}||${[...orphanNotes].sort().join('|')}`;
}

export function isDirty(current, initial) {
  return dayFingerprint(current) !== dayFingerprint(initial);
}

// ───────────────────────────────────────────────────────────── 分享階梯

export const SHARE_RESULT = {
  shared: 'shared', cancelled: 'cancelled', copied: 'copied', manual: 'manual',
};

/**
 * 「報給老師」嘅四級階梯。**每一級失敗都要跌落下一級，最尾一定有嘢可以做**
 * ——學生撳咗掣乜都冇發生係最差嘅結果。
 *
 *   1. navigator.share()：手機開系統分享面板，揀 WhatsApp 就送到。
 *      使用者自己取消（AbortError）當正常，唔出錯誤訊息。
 *   2. navigator.clipboard.writeText()：要安全來源 + 使用者手勢；
 *      http:// 或者權限被拒就會擲例外。
 *   3. document.execCommand('copy')：舊 iOS Safari 唯一得嘅方法。
 *   4. 'manual'：呼叫方要顯示一個可全選嘅唯讀 textarea 俾人手動複製。
 *
 * 三個 API 全部由 deps 注入（預設 defaultShareDeps()），所以整條階梯測得到，
 * 亦唔會喺測試度掂真嘅剪貼簿。
 */
export async function shareText(text, deps = {}) {
  const { share, copy, legacyCopy } = deps;

  if (share) {
    try {
      await share({ text });
      return SHARE_RESULT.shared;
    } catch (err) {
      // 使用者喺系統面板撳「取消」＝正常操作，唔應該再退去複製。
      if (err && (err.name === 'AbortError' || err.code === 20)) return SHARE_RESULT.cancelled;
    }
  }

  if (copy) {
    try { await copy(text); return SHARE_RESULT.copied; } catch { /* 跌落下一級 */ }
  }

  if (legacyCopy) {
    try { if (legacyCopy(text)) return SHARE_RESULT.copied; } catch { /* 跌落下一級 */ }
  }

  return SHARE_RESULT.manual;
}

/**
 * 舊 iOS Safari 嘅複製法。iOS 唔會理 <textarea>.select()（唯讀嘅更加唔會），
 * 一定要用 Range + setSelectionRange 先揀得到字，所以呢度唔可以簡化成
 * el.select()。回傳 true 代表 execCommand 報成功。
 */
export function legacyCopyText(text, doc = typeof document === 'undefined' ? null : document) {
  if (!doc || typeof doc.execCommand !== 'function') return false;
  const el = doc.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.contentEditable = 'true';
  // 唔可以用 display:none／visibility:hidden —— 睇唔到嘅元素揀唔到字。
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  doc.body.appendChild(el);
  try {
    selectAllIn(el, doc);
    return Boolean(doc.execCommand('copy'));
  } finally {
    el.remove();
  }
}

/** 全選一個 textarea 嘅內容（iOS Safari 要 Range，唔可以淨係 select()）。 */
export function selectAllIn(el, doc = document) {
  try {
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = doc.defaultView ? doc.defaultView.getSelection() : null;
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  } catch { /* 揀唔到就算，下面仲有 setSelectionRange */ }
  try { el.setSelectionRange(0, 999999); } catch { /* 有啲元素唔支援 */ }
  try { el.focus({ preventScroll: true }); } catch { /* 忽略 */ }
}

/** 執行期先讀 navigator／document，方便測試注入假 API。 */
export function defaultShareDeps() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return {
    share: nav && typeof nav.share === 'function' ? (data) => nav.share(data) : null,
    copy: nav && nav.clipboard && typeof nav.clipboard.writeText === 'function'
      ? (text) => nav.clipboard.writeText(text) : null,
    legacyCopy: (text) => legacyCopyText(text),
  };
}

// ═════════════════════════════════════════════════════════════ 顯示層

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 「8 月 17 日」＋「星期一」（英文：「August 17」＋「Mon」）。 */
export function dateHeadText(date) {
  const month = t(`calendar.monthNames.${Number(String(date).slice(5, 7))}`);
  return {
    main: t('calendar.dayLabel', { month, day: Number(String(date).slice(8, 10)) }),
    sub: t('day.weekday', { d: t(`calendar.weekdays.${weekdayIndex(date)}`) }),
  };
}

function stepperMarkup(row) {
  const value = formatHours(row.hours);
  return `<div class="day-step">`
    + `<button type="button" class="day-step-btn" data-step="-1" data-code="${esc(row.code)}"`
    + ` aria-label="${esc(t('day.minus', { subject: row.name }))}">−</button>`
    + `<span class="day-step-v${row.hours ? '' : ' is-zero'}" data-value="${esc(row.code)}"`
    + ` aria-live="polite" aria-label="${esc(t('day.hoursOf', { subject: row.name, hours: value }))}"`
    + `>${value}</span>`
    + `<button type="button" class="day-step-btn" data-step="1" data-code="${esc(row.code)}"`
    + ` aria-label="${esc(t('day.plus', { subject: row.name }))}">＋</button>`
    + `</div>`;
}

/*
 * 鉛筆圖示（行內 SVG，同 login.js 一樣唔用 emoji／icon font／CDN：emoji 喺
 * 唔同平台會變樣，亦唔跟主題色）。用 currentColor，所以「有冇註解」淨係
 * 靠 CSS 換色就得。
 */
const ICON_PENCIL = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 19.5h3.2l9.1-9.1a2.26 2.26 0 0 0-3.2-3.2l-9.1 9.1z"/><path d="M13.4 8.3l2.3 2.3"/></svg>`;

/**
 * 逐科註解（寫入 records[].content）。**預設收埋**：步進掣先係第一眼見到、
 * 日日撳嗰樣嘢，註解只係可選加碼，唔可以佔位變成「多咗一步」。
 *
 * 收埋狀態下都要一眼睇得出邊科寫過嘢（`has-note` 換色 + 一粒實心點），
 * 否則學生自己都唔記得寫過乜，要逐個展開查係倒退。
 */
function noteMarkup(row) {
  const hasNote = Boolean(String(row.content || '').trim());
  const id = `day-note-${row.code}`;
  const label = t(hasNote ? 'day.noteEditOf' : 'day.noteAddOf', { subject: row.name });
  return `<button type="button" class="day-note-btn${hasNote ? ' has-note' : ''}"`
    + ` data-note-toggle="${esc(row.code)}" aria-expanded="false" aria-controls="${esc(id)}"`
    + ` aria-label="${esc(label)}" title="${esc(label)}">${ICON_PENCIL}`
    + `<span class="day-note-dot" aria-hidden="true"></span></button>`;
}

function noteFieldMarkup(row) {
  const id = `day-note-${row.code}`;
  const orphan = !(Number(row.hours) > 0) && Boolean(String(row.content || '').trim());
  return `<div class="day-note-wrap" id="${esc(id)}" hidden>`
    + `<input type="text" class="day-note" data-note="${esc(row.code)}"`
    + ` value="${esc(row.content || '')}" maxlength="120"`
    + ` aria-label="${esc(t('day.noteAddOf', { subject: row.name }))}"`
    + ` placeholder="${esc(t('day.notePlaceholder'))}">`
    + `<p class="day-note-warn" data-warn="${esc(row.code)}" role="status"${orphan ? '' : ' hidden'}`
    + `>${t('day.noteNoHours')}</p>`
    + `</div>`;
}

export function subjectRowMarkup(row, readOnly = false) {
  const note = String(row.content || '').trim();
  if (readOnly) {
    return `<div class="day-row is-ro" data-row="${esc(row.code)}">`
      + `<div class="day-row-main">`
      + `<span class="day-row-name">${esc(row.name)}</span>`
      + `<span class="day-row-h">${formatHours(row.hours)}</span>`
      + `</div>`
      // 老師唔使撳開先睇得到——唯讀模式直接把註解攤出嚟。
      + (note ? `<p class="day-note-ro">${esc(note)}</p>` : '')
      + `</div>`;
  }
  return `<div class="day-row" data-row="${esc(row.code)}">`
    + `<div class="day-row-main">`
    + `<span class="day-row-name">${esc(row.name)}</span>`
    + stepperMarkup(row)
    + noteMarkup(row)
    + `</div>`
    + noteFieldMarkup(row)
    + `</div>`;
}

export function moodsMarkup(mood, readOnly = false) {
  return MOOD_KEYS.map((key) => {
    const on = key === mood;
    if (readOnly && !on) return '';
    const label = t(`mood.${key}`);
    return `<button type="button" class="day-mood" data-mood="${key}"`
      + ` aria-pressed="${on}" aria-label="${esc(label)}"${readOnly ? ' aria-disabled="true"' : ''}>`
      + `<span class="day-mood-emoji" aria-hidden="true">${MOOD_EMOJI[key]}</span>`
      + `<span class="day-mood-label" aria-hidden="true">${esc(t(`day.moodShort.${key}`))}</span>`
      + `</button>`;
  }).join('');
}

/** 成版嘅 HTML（純字串，方便唔起瀏覽器都測到）。 */
export function dayEditorMarkup(model) {
  const {
    date, rows, mood, reflection, readOnly = false, canAdd = true, name = '',
  } = model;
  const head = dateHeadText(date);
  const total = totalHoursOf(rows);
  const hasRecords = total > 0;

  const subjects = rows.length
    ? rows.map((r) => subjectRowMarkup(r, readOnly)).join('')
    : (readOnly ? `<p class="day-empty">${t('day.empty')}</p>` : '');

  const moodBlock = readOnly && !mood ? '' : `
      <h3 class="day-sec">${t('day.mood')}</h3>
      <div class="day-moods" id="day-moods">${moodsMarkup(mood, readOnly)}</div>`;

  const reflectionBlock = readOnly
    ? (String(reflection || '').trim()
      ? `<h3 class="day-sec">${t('day.sectionReflection')}</h3>`
        + `<p class="day-reflect-ro">${esc(reflection)}</p>` : '')
    : `<h3 class="day-sec">${t('day.sectionReflection')}</h3>`
      + `<textarea class="day-reflect" id="day-reflection" rows="4"`
      + ` placeholder="${esc(t('day.reflection'))}">${esc(reflection)}</textarea>`;

  return `
    <div class="container day-shell${readOnly ? ' is-readonly' : ''}">
      <header class="day-top">
        <button type="button" class="btn btn-icon day-back" id="day-back"
                aria-label="${esc(t('day.back'))}" title="${esc(t('day.back'))}">‹</button>
        <div class="day-dt">
          <div class="day-dt-main">${esc(head.main)}</div>
          <div class="day-dt-sub">${esc(head.sub)}${readOnly && name ? `　${esc(name)}` : ''}</div>
        </div>
        <div class="day-tot">
          <div class="day-tot-n" id="day-total">${formatHours(total)}</div>
          <div class="day-tot-l">${t('day.totalToday')}</div>
        </div>
      </header>

      <h3 class="day-sec">${t('day.sectionHours')}</h3>
      <div class="day-subjects" id="day-subjects">${subjects}</div>
      ${readOnly || !canAdd ? '' : `
      <button type="button" class="day-add" id="day-add">${t('day.addSubject')}</button>
      <div class="day-picker" id="day-picker" hidden></div>`}
      ${moodBlock}
      ${reflectionBlock}
      ${readOnly ? '' : `
      <button type="button" class="day-clear" id="day-clear">${t('day.clear')}</button>`}

      <p class="day-toast" id="day-toast" role="status" hidden></p>

      <section class="day-manual" id="day-manual" hidden aria-label="${esc(t('share.manual'))}">
        <p class="day-manual-note">${t('share.manual')}</p>
        <textarea class="day-manual-text" id="day-manual-text" readonly rows="6"></textarea>
        <button type="button" class="btn day-manual-close" id="day-manual-close">${t('day.close')}</button>
      </section>

      ${readOnly ? '' : `
      <div class="day-actions">
        <button type="button" class="btn btn-primary day-save" id="day-save">${t('day.save')}</button>
        <button type="button" class="btn day-share" id="day-share"${hasRecords ? '' : ' hidden'}
                >${t('share.button')}</button>
      </div>`}
    </div>
  `;
}

// ═════════════════════════════════════════════════════════════ 畫面

/*
 * 每次 renderDayEditor() 開頭遞增：await 返嚟之後對唔上（使用者已經去咗
 * 第二日／第二版）就唔好再畫，免得遲到嘅回應覆寫新畫面。
 */
let seq = 0;
let toastTimer = null;

export async function renderDayEditor(root, opts = {}) {
  const my = ++seq;
  const params = { ...(state.params || {}), ...opts };
  const actor = state.actor || {};
  const isTeacher = actor.kind === 'teacher';
  const date = String(params.date || hkToday()).slice(0, 10);
  const yearMonth = date.slice(0, 7);
  // 學生永遠唔會送 studentId（後端亦一律無視），只有老師睇學生先會帶。
  const studentId = isTeacher && params.studentId ? String(params.studentId) : null;
  // 老師一律唯讀（後端亦唔接受老師代學生寫入）。
  const readOnly = Boolean(params.readOnly) || isTeacher;
  // 測試／截圖注入用；平時係 undefined，store 會用返真嘅 call()。
  const transport = params.transport;

  const lang = currentLang();
  const allSubjects = state.subjects || [];
  const mySubjects = actor.my_subjects || [];
  const subjectNames = Object.fromEntries(
    allSubjects.map((s) => [String(s.code), subjectNameOf(s, s.code, lang)]),
  );
  const displayName = (lang === 'en' ? actor.name_en : actor.name_zh)
    || actor.name_zh || actor.id || '';

  // ── 畫面狀態（唯一真身，全部 paint 都由呢幾個變數推出嚟）──────────
  let rows = [];
  let extra = [];
  let mood = '';
  let reflection = '';
  let initial = { records: [], mood: '', reflection: '' };
  let pickerOpen = false;

  const currentState = () => editorSnapshot(rows, mood, reflection);
  const dirty = () => isDirty(currentState(), initial);

  /** 由 store 攞到嘅一日資料 → 畫面狀態。 */
  function adopt(day) {
    const records = (day && day.records) || [];
    rows = buildSubjectRows({ subjects: allSubjects, mySubjects, records, extra, lang });
    /*
     * 唯讀（老師睇學生）只列真係有時數嗰幾科：學生自選咗但當日冇溫嘅科
     * 喺編輯畫面係「可以撳嘅目標」，但喺老師眼中只係一堆 0，會冚住真正
     * 想知嘅嘢。當日完全冇記錄時會落到「當日沒有記錄」嗰個空狀態。
     */
    if (readOnly) rows = rows.filter((r) => r.hours > 0);
    mood = (day && day.mood) || '';
    reflection = (day && day.reflection) || '';
    initial = editorSnapshot(rows, mood, reflection);
  }

  // ── 局部更新（撳 ＋／− 同心情時唔好成版重畫：會抹走 textarea 嘅焦點）──

  function syncRow(code) {
    const row = rows.find((r) => r.code === code);
    const el = root.querySelector(`[data-value="${CSS.escape(code)}"]`);
    if (!row || !el) return;
    const value = formatHours(row.hours);
    el.textContent = value;
    el.classList.toggle('is-zero', !row.hours);
    el.setAttribute('aria-label', t('day.hoursOf', { subject: row.name, hours: value }));
  }

  function syncTotals() {
    const total = totalHoursOf(rows);
    const totalEl = root.querySelector('#day-total');
    if (totalEl) totalEl.textContent = formatHours(total);
    // 當日毫無記錄時唔顯示「報給老師」（計劃書 §6.4）。
    const shareBtn = root.querySelector('#day-share');
    if (shareBtn) shareBtn.hidden = total <= 0;
  }

  /** 註解掣嘅「有嘢寫過」提示，同 0 小時嗰個警告。 */
  function syncNote(code) {
    const row = rows.find((r) => r.code === code);
    if (!row) return;
    const note = String(row.content || '').trim();
    const btn = root.querySelector(`[data-note-toggle="${CSS.escape(code)}"]`);
    if (btn) {
      btn.classList.toggle('has-note', Boolean(note));
      const label = t(note ? 'day.noteEditOf' : 'day.noteAddOf', { subject: row.name });
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    const warn = root.querySelector(`[data-warn="${CSS.escape(code)}"]`);
    if (warn) warn.hidden = !(note && !(Number(row.hours) > 0));
  }

  function syncMoods() {
    root.querySelectorAll('[data-mood]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mood === mood));
    });
  }

  function showToast(message) {
    const el = root.querySelector('#day-toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (el.isConnected) el.hidden = true; }, 2400);
  }

  /** 三級複製全部唔得時嘅最後一著：可全選嘅唯讀 textarea。 */
  function showManual(text) {
    const box = root.querySelector('#day-manual');
    const area = root.querySelector('#day-manual-text');
    if (!box || !area) return;
    area.value = text;
    box.hidden = false;
    selectAllIn(area, root.ownerDocument || document);
  }

  // ── 動作 ──────────────────────────────────────────────────────────

  function onStep(code, direction) {
    const row = rows.find((r) => r.code === code);
    if (!row) return;
    const next = stepHours(row.hours, direction);
    if (next === row.hours) {
      // 夾到盡頭。唔可以靜靜哋冇反應——講明點解撳唔郁。
      if (direction > 0) showToast(t('day.hoursLimit', { max: formatHours(HOURS_MAX) }));
      return;
    }
    row.hours = next;
    syncRow(code);
    syncTotals();
    syncNote(code);        // 由 0 加到 0.25（或者相反）會令註解警告出／收
  }

  /** 展開／收埋一科嘅註解欄。展開就順手把游標放入去，慳返學生一下撳。 */
  function onToggleNote(btn) {
    const code = btn.dataset.noteToggle;
    const wrap = root.querySelector(`#day-note-${CSS.escape(code)}`);
    if (!wrap) return;
    const open = wrap.hidden;
    wrap.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      const field = wrap.querySelector('[data-note]');
      if (field) field.focus({ preventScroll: true });
    }
  }

  function onMood(key) {
    mood = mood === key ? '' : key;   // 再撳一次＝取消（計劃書要求）
    syncMoods();
  }

  function addSubject(code) {
    if (rows.some((r) => r.code === code)) return;
    extra = [...extra, code];
    rows = [...rows, {
      code,
      name: subjectNameOf(allSubjects.find((s) => String(s.code) === code), code, lang),
      hours: 0,
      content: '',
    }];
    pickerOpen = false;
    paint();
  }

  function paintPicker() {
    const picker = root.querySelector('#day-picker');
    const addBtn = root.querySelector('#day-add');
    if (!picker || !addBtn) return;
    const left = remainingSubjects(allSubjects, rows, lang);
    addBtn.hidden = left.length === 0;
    picker.hidden = !pickerOpen || left.length === 0;
    picker.innerHTML = pickerOpen
      ? left.map((s) => `<button type="button" class="chip day-pick" data-pick="${esc(s.code)}"`
        + `>${esc(s.name)}</button>`).join('')
      : '';
    picker.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => addSubject(btn.dataset.pick));
    });
  }

  async function persist({ silent = false } = {}) {
    const payload = { date, ...currentState() };
    try {
      // 整日覆寫：收集晒成日先送一次，唔會變成「追加一筆」。
      const { pending } = await saveDay(payload, { transport });
      initial = { ...payload };
      if (!silent) {
        showToast(pending ? t('offline.pending', { n: pendingCount() }) : t('day.saved'));
      }
      return true;
    } catch (err) {
      // AUTH_EXPIRED：資料已經入咗鏡像同佇列（唔會唔見），交返俾路由層
      // 導去登入頁，重新登入後會自動補傳。
      const handled = await (await router()).handleAuthError(err);
      if (!handled && !silent) showToast(err && err.message ? err.message : t('offline.offline'));
      return false;
    }
  }

  /**
   * 儲存前最後一道防線：有註解但冇時數嘅科，儲存之後嗰段字就會冇咗
   * （前端濾走、後端 classifyHours_ 亦當 'omit'）。**唔可以靜靜哋掉**，
   * 所以逐科點名問一次，學生答「確定」先算數。
   *
   * 刻意唔自動幫佢加 0.25 小時補鑊：嗰個數字係老師睇嘅「佢實際溫咗幾耐」，
   * 為咗留住一段註解而擅自加 15 分鐘，等於偽造咗成份報告最核心嘅資料。
   */
  function confirmOrphanNotes() {
    const orphans = orphanNoteSubjects(rows);
    if (orphans.length === 0) return true;
    return window.confirm(t('day.confirmDropNotes', {
      subjects: orphans.map((o) => o.name).join('、'),
    }));
  }

  async function onSave(btn) {
    if (!confirmOrphanNotes()) return;
    if (btn) btn.disabled = true;
    try { await persist(); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  }

  async function onClear() {
    if (!window.confirm(t('day.confirmClear'))) return;
    try {
      const { pending } = await clearDay(date, { transport });
      extra = [];
      adopt(null);
      paint();
      showToast(pending ? t('offline.pending', { n: pendingCount() }) : t('day.cleared'));
    } catch (err) {
      await (await router()).handleAuthError(err);
    }
  }

  /**
   * 連續打卡日數：只用本地鏡像（今個月、前兩個月，加埋所編輯嗰個月），
   * 唔會為咗一句分享文再打後端。編輯緊嗰日用**畫面上**嘅版本而唔係鏡像
   * 版本，咁「今日啱啱入完就分享」都數得中。跨出呢個窗口嘅連續日數會被
   * 切短，屬計劃書 §6.4 末段講明嘅已知近似。
   */
  function computeStreak(records) {
    const todayMonth = hkToday().slice(0, 7);
    const months = new Set([
      todayMonth, shiftMonth(todayMonth, -1), shiftMonth(todayMonth, -2), yearMonth,
    ]);
    const flat = [];
    for (const ym of months) {
      for (const [d, day] of Object.entries(getCachedMonth(ym, studentId))) {
        if (d === date) continue;
        for (const r of (day.records || [])) flat.push({ ...r, date: d });
      }
    }
    for (const r of records) flat.push({ ...r, date });
    return streakDays(flat, hkToday());
  }

  async function onShare() {
    const cur = currentState();
    if (cur.records.length === 0) return;
    const text = buildShareText({
      date,
      name: displayName,
      records: cur.records,
      subjectNames,
      mood: cur.mood,
      reflection: cur.reflection,
      streak: computeStreak(cur.records),
      lang: currentLang(),
    });

    /*
     * navigator.share()／clipboard 兩者都要求「使用者手勢仍然生效」
     * （transient activation）。所以呢度**唔可以**喺分享之前 await 儲存：
     * Safari 會當手勢已經用完而拒絕，成條階梯即刻跌到最尾一級。改為分享
     * 完先補一次儲存，令老師收到嗰份同 Sheet 入面嗰份一致。
     */
    const result = await shareText(text, defaultShareDeps());
    if (result === SHARE_RESULT.copied) showToast(t('share.copied'));
    else if (result === SHARE_RESULT.manual) showManual(text);

    if (dirty()) await persist({ silent: true });
  }

  // ── 畫 ────────────────────────────────────────────────────────────

  function paint() {
    root.innerHTML = dayEditorMarkup({
      date, rows, mood, reflection, readOnly, name: displayName,
      canAdd: remainingSubjects(allSubjects, rows, lang).length > 0,
    });

    root.querySelector('#day-back').addEventListener('click', async () => {
      if (dirty() && !window.confirm(t('day.confirmDiscard'))) return;
      (await router()).navigate('calendar', studentId ? { studentId } : {});
    });

    if (readOnly) return;

    const subjectsEl = root.querySelector('#day-subjects');
    if (subjectsEl) {
      subjectsEl.addEventListener('click', (e) => {
        const step = e.target.closest('[data-step]');
        if (step) { onStep(step.dataset.code, Number(step.dataset.step)); return; }

        const toggle = e.target.closest('[data-note-toggle]');
        if (toggle) onToggleNote(toggle);
      });
      // 用 input 事件即時收字：唔可以等 change／blur，學生打完字直接撳
      // 「儲存」嘅話 change 未必嚟得切。
      subjectsEl.addEventListener('input', (e) => {
        const field = e.target.closest('[data-note]');
        if (!field) return;
        const row = rows.find((r) => r.code === field.dataset.note);
        if (!row) return;
        row.content = field.value;
        syncNote(row.code);
      });
    }

    const moodsEl = root.querySelector('#day-moods');
    if (moodsEl) {
      moodsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mood]');
        if (btn) onMood(btn.dataset.mood);
      });
    }

    const addBtn = root.querySelector('#day-add');
    if (addBtn) {
      addBtn.addEventListener('click', () => { pickerOpen = !pickerOpen; paintPicker(); });
      paintPicker();
    }

    const reflectionEl = root.querySelector('#day-reflection');
    if (reflectionEl) {
      reflectionEl.addEventListener('input', () => { reflection = reflectionEl.value; });
    }

    const clearBtn = root.querySelector('#day-clear');
    if (clearBtn) clearBtn.addEventListener('click', onClear);

    const saveBtn = root.querySelector('#day-save');
    if (saveBtn) saveBtn.addEventListener('click', () => onSave(saveBtn));

    const shareBtn = root.querySelector('#day-share');
    if (shareBtn) shareBtn.addEventListener('click', onShare);

    const manualClose = root.querySelector('#day-manual-close');
    if (manualClose) {
      manualClose.addEventListener('click', () => {
        const box = root.querySelector('#day-manual');
        if (box) box.hidden = true;
      });
    }
  }

  // 1) 先用本地鏡像（同佇列）即刻畫一次，唔使等網絡。
  adopt(getCachedMonth(yearMonth, studentId)[date]);
  paint();

  // 2) 攞新資料。getMonth() 已經吞晒離線／伺服器錯（回 fromCache），
  //    只有 AUTH_EXPIRED 會擲出，交返俾路由層。
  let fresh;
  try {
    fresh = await getMonth(yearMonth, studentId, { transport });
  } catch (err) {
    await (await router()).handleAuthError(err);
    return;
  }
  if (my !== seq || !root.isConnected) return;
  if (fresh.fromCache) return;              // 同已顯示嘅係同一份，唔重畫
  /*
   * 學生喺等回應期間已經開始改嘢就唔好覆寫佢——後端嗰份必然比佢啱啱撳嗰
   * 幾下舊，重畫等於靜靜哋抹走佢做過嘅嘢。
   */
  if (dirty()) return;
  adopt(fresh.byDate[date]);
  paint();
}

/** 測試專用：清走模組內部狀態。 */
export function resetDayEditorForTests() {
  seq = 0;
  clearTimeout(toastTimer);
}
