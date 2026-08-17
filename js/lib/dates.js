const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 把 Date 轉成香港時間的 'YYYY-MM-DD'。 */
export function hkDateString(date) {
  return new Date(date.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

export function hkToday(now = new Date()) {
  return hkDateString(now);
}

/** 把 'YYYY-MM-DD' 當作該日香港時間的正午，避免任何邊界誤差。 */
function toUtcNoon(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

function fromUtcNoon(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  return fromUtcNoon(toUtcNoon(dateStr) + n * DAY_MS);
}

/** 1 = 星期一 … 7 = 星期日 */
export function weekdayIndex(dateStr) {
  const jsDay = new Date(toUtcNoon(dateStr)).getUTCDay(); // 0 = 星期日
  return jsDay === 0 ? 7 : jsDay;
}

export function weekStartOf(dateStr) {
  return addDays(dateStr, -(weekdayIndex(dateStr) - 1));
}

/** 週一起頭的 6×7 月格。month 為 1-based。 */
export function monthGrid(year, month) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = weekStartOf(first);
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: date.startsWith(prefix) };
  });
}

/** ISO 8601 週：'YYYY-Www'。所屬年份取該週星期四所在的年。 */
export function isoWeek(dateStr) {
  const thursday = addDays(weekStartOf(dateStr), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const firstThursday = addDays(weekStartOf(jan1), 3);
  const weeks = Math.round((toUtcNoon(thursday) - toUtcNoon(firstThursday)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(weeks).padStart(2, '0')}`;
}
