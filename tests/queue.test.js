import { test, eq } from './assert.js';
import { enqueue, pendingDates, trimQueue, removeFromQueue, mergeDay, QUEUE_MAX_DAYS }
  from '../js/lib/queue.js';

const save = (date, hours, at = 1) => ({
  kind: 'saveDay', date,
  records: [{ subject_code: 'MATH', hours, content: '' }],
  mood: 'ok', reflection: '', queued_at: at,
});

test('enqueue 加入一日', () => {
  const q = enqueue({}, save('2026-07-29', 2));
  eq(Object.keys(q), ['2026-07-29']);
  eq(q['2026-07-29'].records[0].hours, 2);
});

test('enqueue 同一日只保留最後一次', () => {
  let q = enqueue({}, save('2026-07-29', 2, 1));
  q = enqueue(q, save('2026-07-29', 5, 2));
  eq(Object.keys(q).length, 1);
  eq(q['2026-07-29'].records[0].hours, 5);
});

test('enqueue 不變更輸入', () => {
  const original = {};
  enqueue(original, save('2026-07-29', 2));
  eq(Object.keys(original).length, 0);
});

test('clearDay 覆寫同日的 saveDay', () => {
  let q = enqueue({}, save('2026-07-29', 2));
  q = enqueue(q, { kind: 'clearDay', date: '2026-07-29', queued_at: 3 });
  eq(q['2026-07-29'].kind, 'clearDay');
  eq(Object.keys(q).length, 1);
});

test('saveDay 覆寫同日的 clearDay', () => {
  let q = enqueue({}, { kind: 'clearDay', date: '2026-07-29', queued_at: 1 });
  q = enqueue(q, save('2026-07-29', 3, 2));
  eq(q['2026-07-29'].kind, 'saveDay');
});

test('pendingDates 由舊到新', () => {
  let q = enqueue({}, save('2026-07-29', 1));
  q = enqueue(q, save('2026-07-01', 1));
  q = enqueue(q, save('2026-07-15', 1));
  eq(pendingDates(q), ['2026-07-01', '2026-07-15', '2026-07-29']);
});

// 佇列上限存在的理由是「唔好唔見咗學生嘅嘢」，所以裁剪要留低「最近入列」
// （queued_at 最新）嘅項目，而唔係「日期字串最新」——兩者喺補記舊一日時會分歧：
// 學生剛剛（queued_at 最大）先補記 07-01，但 07-01 個日期字串仍然係全部人入面最舊。
// 若按日期裁剪，呢個佇列最新嘅動作反而會第一個被裁走，正正違反「唔好唔見咗學生嘅嘢」。
test('trimQueue 保留最近入列的 N 日（依 queued_at，非日期字串）', () => {
  let q = {};
  q = enqueue(q, save('2026-07-01', 1, 5)); // 日期最舊，但最後先入列
  q = enqueue(q, save('2026-07-02', 1, 1));
  q = enqueue(q, save('2026-07-03', 1, 2));
  q = enqueue(q, save('2026-07-04', 1, 3));
  q = enqueue(q, save('2026-07-05', 1, 4));
  eq(pendingDates(trimQueue(q, 3)), ['2026-07-01', '2026-07-04', '2026-07-05']);
});

test('trimQueue 未超額時原樣回傳', () => {
  const q = enqueue({}, save('2026-07-29', 1));
  eq(pendingDates(trimQueue(q, 3)), ['2026-07-29']);
});

// queued_at 由裝置時鐘寫入（Task 12），離線裝置的時鐘或寫入時機都可能出問題。
// 缺失或非數字嘅 queued_at 必須有可預測嘅退化行為：當成「我哋唔知幾時做過」，
// 即是最唔信得過、優先裁走，而唔係俾 NaN 令 sort 結果無定義（scramble 成點都得）。
test('trimQueue queued_at 缺失時，該日視為最舊優先裁走', () => {
  let q = {};
  q = enqueue(q, {
    kind: 'saveDay', date: '2026-07-01',
    records: [{ subject_code: 'MATH', hours: 1, content: '' }],
    mood: 'ok', reflection: '',
    // 刻意無 queued_at
  });
  q = enqueue(q, save('2026-07-02', 1, 1));
  q = enqueue(q, save('2026-07-03', 1, 2));
  q = enqueue(q, save('2026-07-04', 1, 3));
  eq(pendingDates(trimQueue(q, 3)), ['2026-07-02', '2026-07-03', '2026-07-04']);
});

test('trimQueue queued_at 非數字時，該日視為最舊優先裁走', () => {
  let q = {};
  q = enqueue(q, save('2026-07-01', 1, 'oops'));
  q = enqueue(q, save('2026-07-02', 1, 1));
  q = enqueue(q, save('2026-07-03', 1, 2));
  q = enqueue(q, save('2026-07-04', 1, 3));
  eq(pendingDates(trimQueue(q, 3)), ['2026-07-02', '2026-07-03', '2026-07-04']);
});

test('trimQueue queued_at 相同時，以日期字串新舊為 tiebreak', () => {
  let q = {};
  q = enqueue(q, save('2026-07-01', 1, 5));
  q = enqueue(q, save('2026-07-02', 1, 5));
  q = enqueue(q, save('2026-07-03', 1, 5));
  q = enqueue(q, save('2026-07-04', 1, 5));
  eq(pendingDates(trimQueue(q, 3)), ['2026-07-02', '2026-07-03', '2026-07-04']);
});

test('trimQueue 不變更輸入', () => {
  let q = {};
  for (let d = 1; d <= 5; d++) q = enqueue(q, save(`2026-07-0${d}`, 1, d));
  const snapshot = { ...q };
  trimQueue(q, 3);
  eq(q, snapshot);
});

test('佇列上限為 60', () => {
  eq(QUEUE_MAX_DAYS, 60);
});

test('removeFromQueue', () => {
  let q = enqueue({}, save('2026-07-29', 1));
  q = enqueue(q, save('2026-07-28', 1));
  eq(pendingDates(removeFromQueue(q, '2026-07-29')), ['2026-07-28']);
});

test('removeFromQueue 不變更輸入', () => {
  let q = enqueue({}, save('2026-07-29', 1));
  q = enqueue(q, save('2026-07-28', 1));
  const snapshot = { ...q };
  removeFromQueue(q, '2026-07-29');
  eq(q, snapshot);
});

test('mergeDay 無佇列時用鏡像', () => {
  const mirror = { records: [{ subject_code: 'PHY', hours: 1 }], mood: 'tired', reflection: '累' };
  eq(mergeDay(mirror, undefined),
     { records: [{ subject_code: 'PHY', hours: 1 }], mood: 'tired', reflection: '累', pending: false });
});

test('mergeDay 有佇列時以佇列為準且標記 pending', () => {
  const mirror = { records: [{ subject_code: 'PHY', hours: 1 }], mood: 'tired', reflection: '累' };
  const r = mergeDay(mirror, save('2026-07-29', 4));
  eq(r.records[0].hours, 4);
  eq(r.mood, 'ok');
  eq(r.pending, true);
});

test('mergeDay 遇 clearDay 回傳空內容', () => {
  const mirror = { records: [{ subject_code: 'PHY', hours: 1 }], mood: 'tired', reflection: '累' };
  eq(mergeDay(mirror, { kind: 'clearDay', date: '2026-07-29', queued_at: 1 }),
     { records: [], mood: '', reflection: '', pending: true });
});

test('mergeDay 鏡像與佇列皆無', () => {
  eq(mergeDay(undefined, undefined), { records: [], mood: '', reflection: '', pending: false });
});
