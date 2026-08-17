export const QUEUE_MAX_DAYS = 60;

export function enqueue(queue, item) {
  return { ...queue, [item.date]: item };
}

export function pendingDates(queue) {
  return Object.keys(queue).sort();
}

// 缺失或非數字嘅 queued_at 一律當成「最舊」（-Infinity）：呢個項目我哋唔知幾時入列，
// 係最唔信得過嘅一個，裁剪時優先犧牲。唔可以直接相減比較，否則兩個都係無效值時
// -Infinity - (-Infinity) 會係 NaN，令 sort 結果變成 unspecified。
function normalizeQueuedAt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;
}

// 裁剪保留「最近入列」（queued_at 最大）的 max 項，而非日期字串最新的 max 項。
// 理由：佇列裝住嘅係未送出嘅寫入，裁剪即係揀邊啲寫入放棄。應該放棄學生最唔在乎嘅
// 嗰啲——60 日前入列、之後再冇郁過嘅一日，而唔係 5 分鐘前先入列嘅（即使佢係補記舊一日）；
// 學生啱啱先郁過嗰日，代表果啲係佢啱啱做緊嘅嘢，理應保留。
export function trimQueue(queue, max = QUEUE_MAX_DAYS) {
  const dates = Object.keys(queue);
  if (dates.length <= max) return { ...queue };
  const sorted = [...dates].sort((a, b) => {
    const qa = normalizeQueuedAt(queue[a].queued_at);
    const qb = normalizeQueuedAt(queue[b].queued_at);
    if (qa !== qb) return qb - qa;
    return b.localeCompare(a);
  });
  const keep = sorted.slice(0, max);
  const out = {};
  for (const d of keep) out[d] = queue[d];
  return out;
}

export function removeFromQueue(queue, date) {
  const out = { ...queue };
  delete out[date];
  return out;
}

const EMPTY = { records: [], mood: '', reflection: '' };

export function mergeDay(mirrorDay, queueItem) {
  if (!queueItem) {
    const m = mirrorDay || EMPTY;
    return {
      records: m.records || [],
      mood: m.mood || '',
      reflection: m.reflection || '',
      pending: false,
    };
  }
  if (queueItem.kind === 'clearDay') return { ...EMPTY, pending: true };
  return {
    records: queueItem.records || [],
    mood: queueItem.mood || '',
    reflection: queueItem.reflection || '',
    pending: true,
  };
}
