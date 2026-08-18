import { test, eq, ok } from './assert.js';
import { loadLang } from '../js/i18n.js';
import { state } from '../js/state.js';
import {
  foldMonthResponse, buildByDate, dropSentEntry, statusBarModel, statusBarHtml,
  getMonth, getCachedMonth, saveDay, clearDay, flush, pendingCount,
  onStoreChange, renderStatusBar, queueKey, mirrorKey, resetStoreForTests,
} from '../js/store.js';

/*
 * 呢份測試絕對唔會打真後端：所有非同步流程都注入假 transport
 * （簽名同 js/api.js 的 call(action, payload, token) 一致），假 transport
 * 只係記低收到乜、回傳／擲出預先定好嘅結果。
 *
 * test() 係同步嘅（見 tests/i18n.test.js 的長註解），所以每個非同步情境
 * 都喺 module 頂層用 top-level await 行完，再用同步 test() 斷言結果。
 *
 * store.js 讀寫真嘅 localStorage，key 以 state.actor.id 命名，所以呢度用
 * 一個專用假學生 id（`__T12__`）同假老師 id（`__T12T__`），跑完清乾淨。
 */

const STUDENT = { id: '__T12__', kind: 'student' };
const TEACHER = { id: '__T12T__', kind: 'teacher' };
const KEYS = [
  'queue:__T12__', 'mirror:__T12__:self',
  'queue:__T12T__', 'mirror:__T12T__:self',
  'mirror:__T12T__:S001', 'mirror:__T12T__:S002',
];

function reset(actor = STUDENT) {
  resetStoreForTests();
  KEYS.forEach(k => localStorage.removeItem(k));
  state.actor = actor;
  state.token = 'tok-test';
}

/** 記錄每次呼叫的假 transport。handler 可回傳資料或擲出錯誤。 */
function recorder(handler) {
  const calls = [];
  const fn = async (action, payload, token) => {
    calls.push({ action, payload, token });
    return handler ? handler(action, payload, calls.length) : { ok: true };
  };
  fn.calls = calls;
  return fn;
}

const offlineErr = () => Object.assign(new Error('目前離線'), { code: 'OFFLINE' });
const authErr = () => Object.assign(new Error('登入已過期'), { code: 'AUTH_EXPIRED' });

const rec = (subject, hours) => ({ subject_code: subject, hours, content: '' });
const day = (date, hours, mood = 'ok') => ({
  date, records: [rec('MATH', hours)], mood, reflection: '',
});

// ═══════════════════════════════════════════════ 純邏輯：foldMonthResponse

test('foldMonthResponse 按日期分組 records', () => {
  const out = foldMonthResponse({
    records: [
      { date: '2026-07-01', subject_code: 'MATH', hours: 2 },
      { date: '2026-07-01', subject_code: 'PHY', hours: 1 },
      { date: '2026-07-02', subject_code: 'MATH', hours: 3 },
    ],
    days: [],
  });
  eq(Object.keys(out).sort(), ['2026-07-01', '2026-07-02']);
  eq(out['2026-07-01'].records.length, 2);
  eq(out['2026-07-02'].records[0].hours, 3);
});

test('foldMonthResponse 由 days 補上 mood／reflection', () => {
  const out = foldMonthResponse({
    records: [{ date: '2026-07-01', subject_code: 'MATH', hours: 2 }],
    days: [{ date: '2026-07-01', mood: 'tired', reflection: '有啲攰' }],
  });
  eq(out['2026-07-01'].mood, 'tired');
  eq(out['2026-07-01'].reflection, '有啲攰');
});

test('foldMonthResponse 只有 days 冇 records 的一日照樣出現（只寫咗反思）', () => {
  const out = foldMonthResponse({ records: [], days: [{ date: '2026-07-05', mood: 'good', reflection: '' }] });
  eq(out['2026-07-05'], { records: [], mood: 'good', reflection: '' });
});

test('foldMonthResponse 遇空回應／缺欄位唔會擲例外', () => {
  eq(foldMonthResponse({ records: [], days: [] }), {});
  eq(foldMonthResponse({}), {});
  eq(foldMonthResponse(undefined), {});
});

// ═══════════════════════════════════════════════════ 純邏輯：buildByDate

const MIRROR_MONTH = {
  '2026-07-01': { records: [rec('MATH', 2)], mood: 'ok', reflection: '' },
  '2026-07-02': { records: [rec('PHY', 1)], mood: '', reflection: '' },
};

test('buildByDate 冇佇列時全部 pending: false', () => {
  const out = buildByDate(MIRROR_MONTH, {}, '2026-07');
  eq(out['2026-07-01'].pending, false);
  eq(out['2026-07-01'].records[0].hours, 2);
});

test('buildByDate 佇列蓋過鏡像並標記 pending', () => {
  const queue = { '2026-07-01': { kind: 'saveDay', ...day('2026-07-01', 9), queued_at: 1 } };
  const out = buildByDate(MIRROR_MONTH, queue, '2026-07');
  eq(out['2026-07-01'].records[0].hours, 9);
  eq(out['2026-07-01'].pending, true);
  eq(out['2026-07-02'].pending, false);
});

test('buildByDate 佇列有、鏡像未有嘅一日都要出現（離線新增嗰日）', () => {
  const queue = { '2026-07-20': { kind: 'saveDay', ...day('2026-07-20', 4), queued_at: 1 } };
  const out = buildByDate(MIRROR_MONTH, queue, '2026-07');
  eq(out['2026-07-20'].records[0].hours, 4);
  eq(out['2026-07-20'].pending, true);
});

test('buildByDate 唔會撈入其他月份嘅佇列項目', () => {
  const queue = { '2026-08-03': { kind: 'saveDay', ...day('2026-08-03', 4), queued_at: 1 } };
  eq(Object.keys(buildByDate(MIRROR_MONTH, queue, '2026-07')).sort(), ['2026-07-01', '2026-07-02']);
});

test('buildByDate 佇列係 clearDay 時顯示為空內容 + pending', () => {
  const queue = { '2026-07-01': { kind: 'clearDay', date: '2026-07-01', queued_at: 1 } };
  eq(buildByDate(MIRROR_MONTH, queue, '2026-07')['2026-07-01'],
     { records: [], mood: '', reflection: '', pending: true });
});

test('buildByDate 鏡像未有該月時回傳空物件', () => {
  eq(buildByDate(undefined, {}, '2026-07'), {});
});

// ══════════════════════════════════════════════════ 純邏輯：dropSentEntry

const sent1 = { kind: 'saveDay', ...day('2026-07-01', 2), queued_at: 100 };

test('dropSentEntry 佇列未變 → 剔走該日', () => {
  eq(dropSentEntry({ '2026-07-01': sent1 }, '2026-07-01', sent1), {});
});

// 呢個係「訊號慢 + 手快」嗰個靜默資料遺失：await call() 期間學生又改咗
// 同一日，佇列已經換咗新版本。若果照剔，新版本永遠唔會送出，Sheet 停留
// 喺舊內容而畫面顯示已同步。
test('dropSentEntry 送出期間學生再改過同一日 → 保留新版本', () => {
  const newer = { kind: 'saveDay', ...day('2026-07-01', 8), queued_at: 200 };
  const out = dropSentEntry({ '2026-07-01': newer }, '2026-07-01', sent1);
  eq(out['2026-07-01'].queued_at, 200);
  eq(out['2026-07-01'].records[0].hours, 8);
});

test('dropSentEntry 送出期間改成清空該日 → 保留 clearDay', () => {
  const cleared = { kind: 'clearDay', date: '2026-07-01', queued_at: 100 };
  eq(dropSentEntry({ '2026-07-01': cleared }, '2026-07-01', sent1)['2026-07-01'].kind, 'clearDay');
});

test('dropSentEntry 佇列已經冇咗該日 → 原樣回傳，唔擲例外', () => {
  eq(dropSentEntry({}, '2026-07-01', sent1), {});
});

test('dropSentEntry 不變更輸入', () => {
  const q = { '2026-07-01': sent1 };
  dropSentEntry(q, '2026-07-01', sent1);
  eq(Object.keys(q), ['2026-07-01']);
});

// ══════════════════════════════════════════════════ 純邏輯：狀態列模型

test('statusBarModel 線上且冇待傳 → 收起（唔佔位）', () => {
  eq(statusBarModel(0, false).hidden, true);
});

test('statusBarModel 線上但有待傳 → 顯示待傳 + 重試掣', () => {
  const m = statusBarModel(2, false);
  eq(m.hidden, false);
  eq(m.keys, ['offline.pending']);
  eq(m.pending, 2);
  eq(m.retry, true);
  eq(m.offline, false);
});

test('statusBarModel 離線但冇待傳 → 只顯示離線，冇重試掣', () => {
  const m = statusBarModel(0, true);
  eq(m.keys, ['offline.offline']);
  eq(m.retry, false);
  eq(m.offline, true);
});

test('statusBarModel 離線又有待傳 → 兩樣都顯示', () => {
  eq(statusBarModel(3, true).keys, ['offline.offline', 'offline.pending']);
});

await loadLang('zh');

test('statusBarHtml 用到嘅 i18n key 真係存在（唔會漏 key 出返個 key 名）', () => {
  const html = statusBarHtml(statusBarModel(2, true));
  ok(html.includes('離線中'), '應有「離線中」');
  ok(html.includes('待同步 2 日'), '應有「待同步 2 日」');
  ok(html.includes('id="retry-sync"'), '應有重試掣');
  ok(!html.includes('offline.'), '唔應該漏出 i18n key 名');
});

test('statusBarHtml 冇待傳時唔會出重試掣', () => {
  ok(!statusBarHtml(statusBarModel(0, true)).includes('retry-sync'));
});

test('renderStatusBar 喺冇 #status-bar 元素嘅頁面唔會擲例外', () => {
  renderStatusBar();   // tests.html 冇呢個元素
  ok(true);
});

// ═══════════════════════════════════════════════════ 儲存：線上一次成功

reset();
const okTransport = recorder(() => ({ ok: true }));
const savedOnline = await saveDay(day('2026-07-10', 2.5), { transport: okTransport });
const cachedAfterOnline = getCachedMonth('2026-07');

test('saveDay 線上：以整日內容呼叫後端 saveDay', () => {
  eq(okTransport.calls.length, 1);
  eq(okTransport.calls[0].action, 'saveDay');
  eq(okTransport.calls[0].payload, {
    date: '2026-07-10', records: [rec('MATH', 2.5)], mood: 'ok', reflection: '',
  });
  eq(okTransport.calls[0].token, 'tok-test');
});

test('saveDay 線上：佇列清空、回報 pending: false', () => {
  eq(savedOnline, { pending: false });
  eq(pendingCount(), 0);
});

test('saveDay 線上：鏡像即刻有嘢，唔使等下次 getMonth', () => {
  eq(cachedAfterOnline['2026-07-10'].records[0].hours, 2.5);
  eq(cachedAfterOnline['2026-07-10'].pending, false);
});

// ═══════════════════════════════════════════════════════ 儲存：離線

reset();
const deadTransport = recorder(() => { throw offlineErr(); });
const savedOffline = await saveDay(day('2026-07-11', 3), { transport: deadTransport });
const cachedOffline = getCachedMonth('2026-07');

test('saveDay 離線：回報 pending: true，資料入咗佇列', () => {
  eq(savedOffline, { pending: true });
  eq(pendingCount(), 1);
});

test('saveDay 離線：畫面即刻見到（樂觀更新鏡像）並標 pending', () => {
  eq(cachedOffline['2026-07-11'].records[0].hours, 3);
  eq(cachedOffline['2026-07-11'].pending, true);
});

// 整日覆寫 ⇒ 同一日改幾多次，佇列都只係一項；呢個性質令補傳可以重播。
await saveDay(day('2026-07-11', 5), { transport: deadTransport });
await saveDay(day('2026-07-11', 7), { transport: deadTransport });

test('離線時同一日改幾次，佇列仍然只有 1 日（整日覆寫）', () => {
  eq(pendingCount(), 1);
});

const backOnline = recorder(() => ({ ok: true }));
const flushed = await flush({ transport: backOnline });

test('回復連線後補傳：送出 1 日、佇列清空', () => {
  eq(flushed, { sent: 1, remaining: 0 });
  eq(pendingCount(), 0);
});

test('補傳送出嘅係最後一次嘅內容（唔係第一次，亦唔係疊加）', () => {
  eq(backOnline.calls.length, 1);
  eq(backOnline.calls[0].payload.records, [rec('MATH', 7)]);
});

// ═════════════════════════════════════════ 補傳重播係冪等（最要緊嗰個性質）

reset();
// 模擬「伺服器已經寫咗入去，但回應喺途中不見咗」：transport 記低 payload
// 之後先擲錯，佇列因此保留，下次再送一次。整日覆寫令送兩次同送一次結果
// 完全一樣，所以兩次 payload 必須一模一樣。
const lossy = recorder((action, payload, n) => { if (n === 1) throw offlineErr(); return { ok: true }; });
await saveDay(day('2026-07-12', 4), { transport: lossy });
const replayed = await flush({ transport: lossy });

test('補傳重播：回應遺失後再送一次，佇列先至清走', () => {
  eq(lossy.calls.length, 2);
  eq(replayed, { sent: 1, remaining: 0 });
});

test('補傳重播冪等：兩次送出嘅 payload 完全一樣（整日覆寫，唔係追加）', () => {
  eq(lossy.calls[0].payload, lossy.calls[1].payload);
  eq(lossy.calls[1].payload.records, [rec('MATH', 4)]);
});

// ═══════════════════════════════════════ 補傳期間學生再改同一日（唔可以唔見）

reset();
let reentered = false;
const slowTransport = recorder(async () => {
  if (!reentered) {                       // 只喺第一次呼叫途中「插隊」一次
    reentered = true;
    await saveDay(day('2026-07-13', 9), { transport: slowTransport });
  }
  return { ok: true };
});
await saveDay(day('2026-07-13', 1), { transport: slowTransport });
const queueAfterRace = JSON.parse(localStorage.getItem(queueKey()) || '{}');

test('補傳途中學生再改同一日：新版本仍然留喺佇列，唔會靜靜哋唔見咗', () => {
  eq(pendingCount(), 1);
  eq(queueAfterRace['2026-07-13'].records, [rec('MATH', 9)]);
});

// ═══════════════════════════════════════════════════════ clearDay

reset();
const clearOnline = recorder(() => ({ ok: true }));
await saveDay(day('2026-07-14', 2), { transport: clearOnline });
await clearDay('2026-07-14', { transport: clearOnline });
const cachedAfterClear = getCachedMonth('2026-07');

test('clearDay 以 action=clearDay、只帶 date 呼叫後端', () => {
  eq(clearOnline.calls.length, 2);
  eq(clearOnline.calls[1].action, 'clearDay');
  eq(clearOnline.calls[1].payload, { date: '2026-07-14' });
});

test('clearDay 之後鏡像唔再有嗰日', () => {
  eq(cachedAfterClear['2026-07-14'], undefined);
});

reset();
const clearOffline = recorder(() => { throw offlineErr(); });
const clearedOffline = await clearDay('2026-07-15', { transport: clearOffline });
const queueAfterClear = JSON.parse(localStorage.getItem(queueKey()) || '{}');

test('clearDay 離線：入佇列（kind=clearDay）並回報 pending', () => {
  eq(clearedOffline, { pending: true });
  eq(queueAfterClear['2026-07-15'].kind, 'clearDay');
});

// ═══════════════════════════════════════════════════════ getMonth

reset();
const monthTransport = recorder(() => ({
  records: [{ date: '2026-07-01', subject_code: 'MATH', hours: 2 }],
  days: [{ date: '2026-07-01', mood: 'ok', reflection: '順利' }],
}));
const fresh = await getMonth('2026-07', null, { transport: monthTransport });
const afterFreshCache = getCachedMonth('2026-07');

test('getMonth 線上：fromCache: false，payload 只帶 yearMonth（學生唔送 studentId）', () => {
  eq(fresh.fromCache, false);
  eq(monthTransport.calls[0].payload, { yearMonth: '2026-07' });
  eq(fresh.byDate['2026-07-01'].reflection, '順利');
});

test('getMonth 線上：順手更新鏡像，之後離線都讀得返', () => {
  eq(afterFreshCache['2026-07-01'].records[0].hours, 2);
});

const offlineMonth = await getMonth('2026-07', null, { transport: recorder(() => { throw offlineErr(); }) });

test('getMonth 離線：fromCache: true，回傳鏡像版本', () => {
  eq(offlineMonth.fromCache, true);
  eq(offlineMonth.byDate['2026-07-01'].records[0].hours, 2);
  eq(offlineMonth.byDate['2026-07-01'].pending, false);
});

await saveDay(day('2026-07-01', 6), { transport: recorder(() => { throw offlineErr(); }) });
const offlineMonth2 = await getMonth('2026-07', null, { transport: recorder(() => { throw offlineErr(); }) });

test('getMonth 離線：未補傳嘅改動蓋過鏡像並標 pending', () => {
  eq(offlineMonth2.byDate['2026-07-01'].records[0].hours, 6);
  eq(offlineMonth2.byDate['2026-07-01'].pending, true);
});

let getMonthAuthThrown = null;
try {
  await getMonth('2026-07', null, { transport: recorder(() => { throw authErr(); }) });
} catch (err) { getMonthAuthThrown = err.code; }

test('getMonth 遇 AUTH_EXPIRED 向上擲（唔可以扮成離線靜靜哋顯示舊資料）', () => {
  eq(getMonthAuthThrown, 'AUTH_EXPIRED');
});

// ═══════════════════════════════ token 過期：佇列一定要留低（學生打嘅嘢）

reset();
await saveDay(day('2026-07-16', 3), { transport: recorder(() => { throw offlineErr(); }) });
let flushAuthThrown = null;
try {
  await flush({ transport: recorder(() => { throw authErr(); }) });
} catch (err) { flushAuthThrown = err.code; }

test('flush 遇 AUTH_EXPIRED：向上擲俾路由層導回登入頁', () => {
  eq(flushAuthThrown, 'AUTH_EXPIRED');
});

test('flush 遇 AUTH_EXPIRED：佇列一定要保留，唔可以掉咗學生打嘅嘢', () => {
  eq(pendingCount(), 1);
});

// clearSession() 只會清 `session`；模擬登出後 state.actor 變 null。
state.actor = null;
const countLoggedOut = pendingCount();
const flushLoggedOut = await flush({ transport: recorder(() => { throw new Error('唔應該叫到'); }) });
state.actor = STUDENT;

test('未登入時 pendingCount() 回傳 0、flush() 唔會叫後端（唔會擲例外）', () => {
  eq(countLoggedOut, 0);
  eq(flushLoggedOut, { sent: 0, remaining: 0 });
});

test('重新登入後（同一個 actor.id）佇列仲喺度，資料冇遺失', () => {
  eq(pendingCount(), 1);
});

const afterRelogin = recorder(() => ({ ok: true }));
const reloginFlush = await flush({ transport: afterRelogin });

test('重新登入後補傳成功，內容同離線嗰陣打嘅一樣', () => {
  eq(reloginFlush, { sent: 1, remaining: 0 });
  eq(afterRelogin.calls[0].payload.records, [rec('MATH', 3)]);
});

// ═══════════════════════════════════════════════ flush 單筆失敗即停

reset();
const dead = recorder(() => { throw offlineErr(); });
await saveDay(day('2026-07-17', 1), { transport: dead });
await saveDay(day('2026-07-18', 2), { transport: dead });
const partial = recorder((action, payload) => {
  if (payload.date === '2026-07-17') throw offlineErr();
  return { ok: true };
});
const partialResult = await flush({ transport: partial });

test('flush 單筆失敗即停：唔會跳過失敗嗰日去送後面嗰日', () => {
  eq(partialResult, { sent: 0, remaining: 2 });
  eq(partial.calls.length, 1);
  eq(partial.calls[0].payload.date, '2026-07-17');
});

// ═══════════════════════════════════════════════════ 變更通知

reset();
let notified = 0;
const off = onStoreChange(() => { notified += 1; });
await saveDay(day('2026-07-19', 1), { transport: recorder(() => { throw offlineErr(); }) });
const notifiedAfterSave = notified;
off();
await saveDay(day('2026-07-19', 2), { transport: recorder(() => { throw offlineErr(); }) });
const notifiedAfterUnsub = notified;

test('onStoreChange 喺佇列變動時通知訂閱者', () => {
  ok(notifiedAfterSave > 0, `預期收到通知，實際 ${notifiedAfterSave}`);
});

test('onStoreChange 回傳嘅退訂函式有效', () => {
  eq(notifiedAfterUnsub, notifiedAfterSave);
});

// ═══════════════════════════════════════════════════ 老師睇學生

reset(TEACHER);
const teacherA = recorder(() => ({
  records: [{ date: '2026-07-01', subject_code: 'MATH', hours: 8 }], days: [],
}));
await getMonth('2026-07', 'S001', { transport: teacherA });
const teacherSeesB = await getMonth('2026-07', 'S002', { transport: recorder(() => { throw offlineErr(); }) });

test('老師 getMonth 會把 studentId 傳落 payload', () => {
  eq(teacherA.calls[0].payload, { yearMonth: '2026-07', studentId: 'S001' });
});

// 若果全部學生共用一個鏡像 key，老師睇完 A 再離線㩒 B，就會見到 A 嘅時數
// 掛住 B 個名——比「乜都唔顯示」錯得嚴重好多。
test('老師嘅鏡像逐個學生分開存：睇完 A 再離線睇 B，唔會攞到 A 嘅資料', () => {
  eq(teacherSeesB.fromCache, true);
  eq(teacherSeesB.byDate, {});
  eq(mirrorKey('S001') === mirrorKey('S002'), false);
});

// 老師自己嘅佇列（理論上唔應該有，但唔可以靠「理論上」）唔可以疊落學生
// 嘅月曆度。
localStorage.setItem('queue:__T12T__', JSON.stringify({
  '2026-07-09': { kind: 'saveDay', ...day('2026-07-09', 12), queued_at: 1 },
}));
const teacherSeesA = await getMonth('2026-07', 'S001', { transport: teacherA });

test('老師睇學生時唔會疊上自己嘅待傳佇列', () => {
  eq(teacherSeesA.byDate['2026-07-09'], undefined);
  eq(teacherSeesA.byDate['2026-07-01'].records[0].hours, 8);
});

// ── 收尾：清走測試用嘅 localStorage key 同模組內部狀態 ──────────────
resetStoreForTests();
KEYS.forEach(k => localStorage.removeItem(k));
state.actor = null;
state.token = null;

test('測試收尾：唔會留低測試用嘅 localStorage key', () => {
  eq(KEYS.filter(k => localStorage.getItem(k) !== null), []);
});
