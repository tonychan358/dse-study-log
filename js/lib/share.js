import { formatHours } from './format.js';

// 純模組：無 DOM、無 fetch、無 Date.now()、無 t()。星期與月份名稱一律寫死對照表，
// 不引入任何日期程式庫，亦不 import js/lib/dates.js（維持零依賴、可獨立測試）。

export const MOOD_EMOJI = {
  happy: '😊',
  ok: '😐',
  tired: '😫',
  frustrated: '😤',
  fired: '🔥',
};

const WEEKDAY_ZH = ['一', '二', '三', '四', '五', '六', '日']; // index 0 = 星期一 … 6 = 星期日
const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 1 = 星期一 … 7 = 星期日。與 js/lib/dates.js 的 weekdayIndex() 用同一套演算法
 * （UTC 正午起算的 getUTCDay()），但獨立實作、不 import，維持本模組零依賴。
 * 兩者的一致性已用多組日期（含跨月、跨年、閏年）交叉驗證，見 task-21-report.md。
 */
function weekdayIndexOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = 星期日
  return jsDay === 0 ? 7 : jsDay;
}

function formatDate(dateStr, lang) {
  const [, m, d] = dateStr.split('-').map(Number);
  const widx = weekdayIndexOf(dateStr);
  if (lang === 'en') {
    return `${d} ${MONTH_EN[m - 1]} (${WEEKDAY_EN[widx - 1]})`;
  }
  return `${m}月${d}日（${WEEKDAY_ZH[widx - 1]}）`;
}

function subjectNameOf(subjectNames, code) {
  return Object.prototype.hasOwnProperty.call(subjectNames, code) ? subjectNames[code] : code;
}

function buildRecordLine(record, subjectNames) {
  const name = subjectNameOf(subjectNames, record.subject_code);
  const content = String(record.content || '').trim();
  const base = `${name} ${formatHours(record.hours)}h`;
  return content ? `${base} — ${content}` : base;
}

const STRINGS = {
  zh: {
    header: (dateStr, name) => `📚 ${formatDate(dateStr, 'zh')}${name}`,
    total: (hours) => `合計 ${hours} 小時`,
    streak: (n) => `連續打卡 ${n} 日`,
    mood: (emoji) => `今日感受 ${emoji}`,
  },
  en: {
    header: (dateStr, name) => `📚 ${formatDate(dateStr, 'en')} ${name}`,
    total: (hours) => `Total ${hours} hours`,
    streak: (n) => `${n}-day streak`,
    mood: (emoji) => `Today ${emoji}`,
  },
};

export function buildShareText(input) {
  const { date, name, records, subjectNames, mood, reflection, streak, lang } = input;
  const strings = STRINGS[lang] || STRINGS.zh;

  const sections = [];

  // 段落 1：日期 + 姓名
  sections.push(strings.header(date, name));

  // 段落 2：記錄行（原順序，不重新排序）
  if (records.length > 0) {
    sections.push(records.map((r) => buildRecordLine(r, subjectNames)).join('\n'));
  }

  // 段落 3：合計（＋連續打卡，僅 streak >= 2 時附上）
  const sum = records.reduce((t, r) => t + Number(r.hours || 0), 0);
  const totalLines = [strings.total(formatHours(sum))];
  if (streak >= 2) totalLines.push(strings.streak(streak));
  sections.push(totalLines.join('\n'));

  // 段落 4：今日感受（＋反思，各自獨立判斷是否出現）
  const moodReflectionLines = [];
  const emoji = MOOD_EMOJI[mood];
  if (mood && emoji) moodReflectionLines.push(strings.mood(emoji));
  const reflectionTrimmed = String(reflection || '').trim();
  if (reflectionTrimmed) moodReflectionLines.push(reflectionTrimmed);
  if (moodReflectionLines.length > 0) sections.push(moodReflectionLines.join('\n'));

  return sections.join('\n\n');
}
