/*
 * 離線層 —— 本地鏡像（讀）、待傳佇列（寫）、自動補傳、狀態列。
 * 之後所有畫面（日曆、單日編輯）都經呢一層讀寫，唔會直接叫 api.js。
 *
 * ── 為何可以咁樣排隊重播 ────────────────────────────────────────────
 * 整個設計倚賴後端一個性質：`saveDay` 係「整日覆寫」——寫入某(學生, 日期)
 * 會用新一批列取代該日全部列（見 gas/Code.gs `handleSaveDay` →
 * `writeRowsFor_`），`clearDay` 則係「整日清空」。所以：
 *   1. 佇列每一日只需要保留「最後一次的整日狀態」（queue.js `enqueue` 以
 *      日期做 key 覆寫），同一日改十次都只會補傳一次；
 *   2. 重播一個佇列項目係**冪等**的：送兩次同送一次結果完全一樣。網絡喺
 *      「伺服器已寫入」同「回應返到嚟」之間斷咗，我哋唔知有冇成功，下次
 *      照送一次就係——最壞情況只係多寫一次同樣的內容。
 *
 * ⚠️ 唔可以把佇列項目改成「追加一筆」或者「差異（delta）」。嗰樣會令重播
 * 變成非冪等：同一筆喺訊號差時被送兩次，時數就會默默變成雙倍。呢種 bug
 * 喺 Wi-Fi 下面點測都測唔到，只會喺學生搭車、地鐵訊號斷斷續續時發生。
 *
 * ── 佇列項目失敗時的去向 ────────────────────────────────────────────
 * 佇列裝住的係學生親手打入去、但未落到 Google Sheet 的資料，所以除咗
 * 「後端確認寫入成功」之外，**冇任何情況會刪走佇列項目**：
 *   - 離線／伺服器錯：留喺佇列，下次再試（`flush` 遇錯即停，唔會跳過）。
 *   - token 過期（AUTH_EXPIRED）：留喺佇列，並把錯誤向上擲，交由路由層
 *     （main.js `handleAuthError`）導回登入頁。`clearSession()` 只清
 *     `session` 一個 key，唔會掂 `queue:*`；佇列 key 以 actor.id 命名，
 *     同一個學生重新登入之後 key 一樣，仍然搵得返，跟住自動補傳。
 *   - 唯一的例外係 `trimQueue` 的 60 日上限（見 queue.js 的說明）：滿咗
 *     先會犧牲最耐冇郁過嗰啲。
 */
import { enqueue, pendingDates, trimQueue, removeFromQueue, mergeDay } from './lib/queue.js';
import { call } from './api.js';
import { state } from './state.js';
import { t } from './i18n.js';

// ─────────────────────────────────────────────────────────── 變更通知

const listeners = new Set();

/** 佇列或連線狀態改變時通知（狀態列用）。回傳退訂函式。 */
export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 逐個包 try/catch：一個監聽器擲例外唔應該連累其他監聽器收唔到通知，
// 更加唔應該由 writeQueue() 一路擲返去呼叫方，令「其實已經寫低咗」的
// 儲存睇落好似失敗咗。
function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.warn('[store] 監聽器擲出例外（已忽略）', err); }
  }
}

// ─────────────────────────────────────────────────── localStorage 存取

const actorId = () => (state.actor && state.actor.id ? String(state.actor.id) : null);

/** 未登入時回傳 null —— 呼叫方一律當「冇佇列」處理，唔可以擲例外。 */
export function queueKey() {
  const id = actorId();
  return id ? `queue:${id}` : null;
}

/*
 * 鏡像 key 除咗 actor.id 之外仲要帶「睇緊邊個學生」：老師可以逐個學生睇
 * 月曆（getMonth 帶 studentId），若果全部學生共用 `mirror:<teacherId>`
 * 一個位，老師睇完學生 A 再離線睇學生 B，就會見到 A 嘅資料掛住 B 個名——
 * 呢個比「乜都唔顯示」錯得嚴重。學生自己嘅資料用 'self'。
 */
export function mirrorKey(studentId = null) {
  const id = actorId();
  return id ? `mirror:${id}:${studentId == null ? 'self' : String(studentId)}` : null;
}

function read(key, fallback) {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch { return fallback; }
}

const write = (key, value) => { if (key) localStorage.setItem(key, JSON.stringify(value)); };

const readMirror = (studentId = null) => read(mirrorKey(studentId), {});

/*
 * 鏡像純粹係快取，寫唔入（配額爆咗、私隱模式）只係「離線時睇唔返」，
 * 唔應該令儲存本身失敗，所以吞咗佢。佇列相反：佇列寫唔入代表學生打嘅
 * 嘢冇落地，一定要擲出去俾呼叫方知，唔可以靜靜哋當成功。
 */
function writeMirror(studentId, mirror) {
  try { write(mirrorKey(studentId), mirror); }
  catch (err) { console.warn('[store] 鏡像寫入失敗（只影響離線快取）', err); }
}

const readQueue = () => read(queueKey(), {});
const writeQueue = (q) => { write(queueKey(), q); emit(); };

export function pendingCount() { return Object.keys(readQueue()).length; }

/*
 * queued_at 有兩個用途：trimQueue 排先後，同埋 dropSentEntry 認得返
 * 「我送出去嗰個項目」。第二個用途要求同一部機器入面唔可以撞值，但
 * Date.now() 喺同一毫秒內連續入列兩次係會撞的，所以強制遞增。仍然係
 * 一個真實時間戳（只會等於或大過真實時間幾毫秒）。
 */
let lastStamp = 0;
function nextStamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

// ────────────────────────────────────────────────────────── 純邏輯

const EMPTY_DAY = () => ({ records: [], mood: '', reflection: '' });

/** 把後端 getMonth 的 { records, days } 攤平成 { [date]: {records, mood, reflection} }。 */
export function foldMonthResponse(data) {
  const out = {};
  for (const r of (data && data.records) || []) {
    (out[r.date] ??= EMPTY_DAY()).records.push(r);
  }
  for (const d of (data && data.days) || []) {
    const day = (out[d.date] ??= EMPTY_DAY());
    day.mood = d.mood || '';
    day.reflection = d.reflection || '';
  }
  return out;
}

/**
 * 疊合「一個月的鏡像」同「待傳佇列」成畫面用的 byDate。
 * 佇列永遠蓋過鏡像（佇列先係學生最新意圖），並標記 pending: true。
 */
export function buildByDate(monthData, queue = {}, yearMonth = '') {
  const base = monthData || {};
  const byDate = {};
  const dates = new Set([
    ...Object.keys(base),
    ...Object.keys(queue).filter(d => d.startsWith(yearMonth)),
  ]);
  for (const d of dates) byDate[d] = mergeDay(base[d], queue[d]);
  return byDate;
}

/**
 * 補傳成功之後由佇列剔走該日 —— 但只限「剔走我啱啱送出嗰一個版本」。
 * 補傳係 async 的：`await call(...)` 期間學生完全可以再改同一日，
 * 令佇列入面嗰個項目已經換成新版本。若果照剔，嗰個新版本就永遠唔會送
 * 出去，Sheet 停留喺舊內容——一個只會喺「網絡慢 + 手快」時出現的靜默
 * 資料遺失。認唔返就保留，留番落次補傳。
 */
export function dropSentEntry(queue, date, sentItem) {
  const current = queue[date];
  if (!current) return { ...queue };
  const same = current.kind === sentItem.kind && current.queued_at === sentItem.queued_at;
  return same ? removeFromQueue(queue, date) : { ...queue };
}

/**
 * 狀態列要顯示乜（純資料，唔掂 DOM 亦唔掂 i18n dict）。
 * keys 依次係要顯示的 i18n key；pending 供 `offline.pending` 的 {n} 用。
 */
export function statusBarModel(pending = 0, offline = false) {
  if (!offline && pending === 0) return { hidden: true, offline: false, pending: 0, keys: [], retry: false };
  const keys = [];
  if (offline) keys.push('offline.offline');
  if (pending > 0) keys.push('offline.pending');
  return { hidden: false, offline, pending, keys, retry: pending > 0 };
}

// ──────────────────────────────────────────────────────────── 讀取

/**
 * 同步讀本地鏡像（疊上佇列），畀呼叫方即刻畫一次先，唔使等網絡。
 * getMonth() 內部用嘅係同一份資料。
 */
export function getCachedMonth(yearMonth, studentId = null) {
  const mine = studentId == null;
  return buildByDate(readMirror(studentId)[yearMonth], mine ? readQueue() : {}, yearMonth);
}

/**
 * 讀某月資料。成功就順手更新鏡像；失敗（離線／伺服器錯）回傳鏡像版本並
 * 標 fromCache: true。AUTH_EXPIRED 例外——嗰個唔係「暫時讀唔到」，要向上
 * 擲俾路由層導回登入頁。
 *
 * 佇列只會疊喺「自己嘅資料」上面（studentId == null）：老師睇學生時佇列
 * 屬於老師自己，疊落去會污染學生嘅畫面。
 */
export async function getMonth(yearMonth, studentId = null, { transport = call } = {}) {
  const mine = studentId == null;
  const mirror = readMirror(studentId);
  const queue = mine ? readQueue() : {};
  const cached = buildByDate(mirror[yearMonth], queue, yearMonth);

  try {
    const payload = mine ? { yearMonth } : { yearMonth, studentId };
    const fresh = foldMonthResponse(await transport('getMonth', payload, state.token));
    mirror[yearMonth] = fresh;
    writeMirror(studentId, mirror);
    return { byDate: buildByDate(fresh, queue, yearMonth), fromCache: false };
  } catch (err) {
    if (err && err.code === 'AUTH_EXPIRED') throw err;
    return { byDate: cached, fromCache: true };
  }
}

// ──────────────────────────────────────────────────────────── 寫入

/*
 * 寫入一律「先寫鏡像（樂觀更新）→ 再入佇列 → 即刻試補傳」。
 * 鏡像先寫，係為咗即使 flush() 擲例外（token 過期）畫面同下次開 app
 * 都仍然見到學生啱啱打嘅嘢；佇列保證佢最終會落到 Sheet。
 * 學生寫入只會寫自己（'self'）—— saveDay/clearDay 冇 studentId 參數，
 * 對應後端 `targetStudent_` 對學生無視 payload.studentId 的規則。
 */
function mirrorWriteDay(date, value) {
  const ym = date.slice(0, 7);
  const mirror = readMirror(null);
  mirror[ym] ??= {};
  if (value === null) delete mirror[ym][date];
  else mirror[ym][date] = value;
  writeMirror(null, mirror);
}

export async function saveDay({ date, records, mood, reflection }, { transport = call } = {}) {
  mirrorWriteDay(date, { records, mood: mood || '', reflection: reflection || '' });
  writeQueue(trimQueue(enqueue(readQueue(), {
    kind: 'saveDay', date, records, mood, reflection, queued_at: nextStamp(),
  })));
  await flush({ transport });
  // 只答「呢一日」有冇未送出，而唔係「佇列仲有冇嘢」——單日畫面問嘅係
  // 佢自己嗰日，唔應該因為另一日卡住咗而顯示成未同步。
  return { pending: Boolean(readQueue()[date]) };
}

export async function clearDay(date, { transport = call } = {}) {
  mirrorWriteDay(date, null);
  writeQueue(trimQueue(enqueue(readQueue(), {
    kind: 'clearDay', date, queued_at: nextStamp(),
  })));
  await flush({ transport });
  return { pending: Boolean(readQueue()[date]) };
}

// ──────────────────────────────────────────────────────────── 補傳

let flushing = false;

/**
 * 由舊到新逐日補傳。單筆失敗即停（唔跳過），保住「日與日之間的先後」，
 * 亦避免離線時對住 60 日佇列連發 60 個必然失敗的請求。
 */
export async function flush({ transport = call } = {}) {
  if (flushing || !queueKey()) return { sent: 0, remaining: pendingCount() };
  flushing = true;
  let sent = 0;
  try {
    for (const date of pendingDates(readQueue())) {
      const item = readQueue()[date];
      if (!item) continue;
      try {
        if (item.kind === 'clearDay') {
          await transport('clearDay', { date }, state.token);
        } else {
          await transport('saveDay', {
            date, records: item.records, mood: item.mood, reflection: item.reflection,
          }, state.token);
        }
      } catch (err) {
        // AUTH_EXPIRED：保留佇列並向上擲，交由路由層導回登入頁（重新登入
        // 後 key 一樣，會再補傳）。其餘（離線／伺服器錯）亦保留，下次再試。
        if (err && err.code === 'AUTH_EXPIRED') throw err;
        break;
      }
      writeQueue(dropSentEntry(readQueue(), date, item));
      sent++;
    }
  } finally {
    flushing = false;
    emit();
  }
  return { sent, remaining: pendingCount() };
}

let authErrorHandler = null;
let inited = false;

/** 背景補傳：唔會擲例外。AUTH_EXPIRED 交畀 initStore() 收到嘅處理器。 */
export function flushQuietly() {
  return flush().catch(err => {
    if (err && err.code === 'AUTH_EXPIRED' && authErrorHandler) return authErrorHandler(err);
    console.warn('[store] 背景補傳失敗，佇列保留，下次再試', err);
  });
}

// ────────────────────────────────────────────────────────── 狀態列

/** 把 statusBarModel 譯成 HTML（分開一個函式，方便唔靠 DOM 都測到）。 */
export function statusBarHtml(model) {
  const text = model.keys.map(k => t(k, { n: model.pending })).join('　');
  return `<span>${text}</span>` +
    (model.retry ? `<button class="btn" type="button" id="retry-sync">${t('offline.retry')}</button>` : '');
}

export function renderStatusBar() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;                       // tests.html 等冇狀態列的頁面
  const model = statusBarModel(pendingCount(), !navigator.onLine);
  if (model.hidden) { bar.hidden = true; bar.textContent = ''; bar.dataset.offline = 'false'; return; }
  bar.hidden = false;
  // CSS 用嘅係 .status-bar[data-offline="true"]（見 css/app.css），
  // 唔係 class modifier。
  bar.dataset.offline = String(model.offline);
  bar.innerHTML = statusBarHtml(model);
  const btn = bar.querySelector('#retry-sync');
  if (btn) btn.onclick = () => flushQuietly();
}

/**
 * 掛狀態列同連線事件。可重覆呼叫（只會掛一次 listener）。
 * onAuthError 由 main.js 傳入 handleAuthError —— 用注入而唔係 import，
 * 係為咗避免 store ⇄ main 循環 import（main.js 頂層有 boot() 副作用）。
 */
export function initStore({ onAuthError } = {}) {
  if (onAuthError) authErrorHandler = onAuthError;
  if (!inited) {
    inited = true;
    onStoreChange(renderStatusBar);
    window.addEventListener('online', () => { renderStatusBar(); flushQuietly(); });
    window.addEventListener('offline', renderStatusBar);
  }
  renderStatusBar();
}

/** 測試專用：還原模組內部狀態，避免測試之間互相污染。 */
export function resetStoreForTests() {
  listeners.clear();
  flushing = false;
  authErrorHandler = null;
  inited = false;
}
