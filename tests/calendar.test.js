import { test, eq, ok } from './assert.js';
import { loadLang } from '../js/i18n.js';
import {
  MOOD_EMOJI, TINT_STEPS, tintLevel, parseExamDates, flattenRecords, monthTotalHours,
  mayExtendStreak, buildCells, dayLabel, dayCellMarkup, gridMarkup, weekdayHeadMarkup,
  legendMarkup, tabBarMarkup, monthTitleText, headSubText, TABS,
} from '../js/views/calendar.js';
import { streakDays } from '../js/lib/stats.js';

/*
 * 全部係純函數／純字串測試：唔起真瀏覽器畫面、唔掂 localStorage、唔打後端。
 * calendar.js 刻意用動態 import 攞路由（見該檔頂部註解），所以喺呢度 import
 * 佢唔會連 js/main.js 嘅 boot() 一齊跑起。
 */

const rec = (subject, hours) => ({ subject_code: subject, hours, content: '' });
const day = (hours, extra = {}) => ({
  records: hours == null ? [] : [rec('MATH', hours)],
  mood: '', reflection: '', pending: false, ...extra,
});

// ═══════════════════════════════════════════════════════ 色調分級

test('tintLevel：0 小時冇色（空白日一眼睇得出）', () => {
  eq(tintLevel(0), 0);
  eq(tintLevel(undefined), 0);
  eq(tintLevel(-3), 0);
  eq(tintLevel('唔係數字'), 0);
});

test('tintLevel：分界為 2 同 4 小時', () => {
  eq(TINT_STEPS, [2, 4]);
  eq(tintLevel(0.25), 1);
  eq(tintLevel(1.75), 1);
  eq(tintLevel(2), 2);         // 分界值屬上一級
  eq(tintLevel(3.75), 2);
  eq(tintLevel(4), 3);
  eq(tintLevel(12), 3);
});

test('tintLevel 單調不減（色調深淺同時數必須同向）', () => {
  let last = 0;
  for (let h = 0; h <= 12; h += 0.25) {
    const lv = tintLevel(h);
    ok(lv >= last, `${h} 小時嘅級數 ${lv} 細過前一個 ${last}`);
    last = lv;
  }
});

// ═══════════════════════════════════════════════════════ 考試日設定

test('parseExamDates 解析老師手打嘅 JSON 字串', () => {
  eq(parseExamDates('{"2026-04-09":"中文","2026-04-11":"英文"}'),
     { '2026-04-09': '中文', '2026-04-11': '英文' });
});

test('parseExamDates 對打錯嘅 JSON 一律當「冇考試日」，唔會炸咗個月曆', () => {
  eq(parseExamDates('{2026-04-09:中文}'), {});
  eq(parseExamDates('「2026-04-09」'), {});
  eq(parseExamDates(''), {});
  eq(parseExamDates(undefined), {});
  eq(parseExamDates('["2026-04-09"]'), {});      // 陣列唔係日期→科目對照
});

test('parseExamDates 濾走唔似日期嘅 key 同空白科目', () => {
  eq(parseExamDates('{"2026-04-09":"中文","四月九日":"英文","2026-04-10":"  "}'),
     { '2026-04-09': '中文' });
});

// ═══════════════════════════════════════════════════════ 42 格模型

const BY_DATE = {
  '2026-07-01': day(1.5),
  '2026-07-03': day(3, { reflection: '今日好順' }),
  '2026-07-05': day(4.5, { mood: 'tired' }),
  '2026-07-08': day(2, { pending: true }),
  '2026-07-09': day(null, { reflection: '淨係寫咗反思' }),
  '2026-07-10': day(1, { reflection: '   ' }),
};
const CELLS = buildCells('2026-07', BY_DATE, {
  today: '2026-07-08',
  examDates: { '2026-07-15': '數學' },
});
const cellOf = (date) => CELLS.find(c => c.date === date);

test('buildCells 永遠 42 格、週一起頭', () => {
  eq(CELLS.length, 42);
  eq(CELLS[0].date, '2026-06-29');     // 2026 年 7 月首格
  eq(CELLS[41].date, '2026-08-09');    // 尾格
});

test('buildCells 標記非本月嘅格', () => {
  eq(CELLS[0].inMonth, false);
  eq(CELLS[41].inMonth, false);
  eq(cellOf('2026-07-01').inMonth, true);
  eq(cellOf('2026-07-31').inMonth, true);
});

test('buildCells 把當日總時數換算成色調級數', () => {
  eq(cellOf('2026-07-01').hours, 1.5);
  eq(cellOf('2026-07-01').level, 1);
  eq(cellOf('2026-07-03').level, 2);
  eq(cellOf('2026-07-05').level, 3);
  eq(cellOf('2026-07-02').hours, 0);
  eq(cellOf('2026-07-02').level, 0);
});

test('buildCells 帶出心情、反思、待同步、考試日、今日', () => {
  eq(cellOf('2026-07-05').mood, 'tired');
  eq(cellOf('2026-07-03').hasReflection, true);
  eq(cellOf('2026-07-08').pending, true);
  eq(cellOf('2026-07-08').isToday, true);
  eq(cellOf('2026-07-01').isToday, false);
  eq(cellOf('2026-07-15').exam, '數學');
  eq(cellOf('2026-07-14').exam, '');
});

test('buildCells：淨係寫咗反思、冇記錄嗰日仍然要出琥珀點（但冇色調）', () => {
  eq(cellOf('2026-07-09').hasReflection, true);
  eq(cellOf('2026-07-09').hours, 0);
  eq(cellOf('2026-07-09').level, 0);
});

test('buildCells：得空白字元嘅反思唔算有反思', () => {
  eq(cellOf('2026-07-10').hasReflection, false);
});

test('buildCells 跨年：2026-12 首格 2026-11-30、尾格 2027-01-10', () => {
  const dec = buildCells('2026-12', {}, { today: '2026-12-01' });
  eq(dec[0].date, '2026-11-30');
  eq(dec[41].date, '2027-01-10');
});

// ═══════════════════════════════════════════════════ 月總時數／連續日數

test('monthTotalHours 加總全月每一筆', () => {
  eq(monthTotalHours(BY_DATE), 12);
  eq(monthTotalHours({}), 0);
});

test('flattenRecords 補返 date（佇列入面嘅 record 本身冇 date 欄）', () => {
  const flat = flattenRecords({ '2026-07-01': day(2), '2026-07-02': day(1) });
  eq(flat.length, 2);
  eq(flat.map(r => r.date).sort(), ['2026-07-01', '2026-07-02']);
  eq(flat[0].hours + flat[1].hours, 3);
});

test('連續日數可以跨月（今個月 + 上個月兩份鏡像疊埋數）', () => {
  const july = { '2026-07-01': day(2), '2026-07-02': day(1) };
  const june = { '2026-06-29': day(1), '2026-06-30': day(2) };
  const records = [...flattenRecords(july), ...flattenRecords(june)];
  eq(streakDays(records, '2026-07-02'), 4);
});

test('mayExtendStreak：連續日數數到今個月一號＝窗口可能切斷咗，要補讀上個月', () => {
  eq(mayExtendStreak(8, '2026-07-08'), true);    // 由 1 號起日日有
  eq(mayExtendStreak(9, '2026-07-08'), true);
  eq(mayExtendStreak(7, '2026-07-08'), false);   // 2 號先開始，冇切斷
  eq(mayExtendStreak(0, '2026-07-08'), false);
});

// ═══════════════════════════════════════════════════════ 顯示層（字串）

await loadLang('zh');

test('monthTitleText 中文為「2026 年 7 月」', () => {
  eq(monthTitleText('2026-07'), '2026 年 7 月');
});

test('星期表頭週一起、共 7 格', () => {
  const html = weekdayHeadMarkup();
  eq((html.match(/<span>/g) || []).length, 7);
  ok(html.startsWith('<span>一</span>'), '第一格應為「一」');
  ok(html.endsWith('<span>日</span>'), '尾格應為「日」');
});

test('格仔：有時數就印數字（唔印「小時」，塞唔落 48px），完整字串放 aria-label／title', () => {
  const html = dayCellMarkup(cellOf('2026-07-03'));
  ok(html.includes('>3</span>'), '格內應有 3');
  ok(!html.includes('>3 小時<'), '格內唔應該印「3 小時」');
  ok(html.includes('3 小時'), 'aria-label／title 應有「3 小時」');
});

test('格仔：色調 class 跟時數級數', () => {
  ok(dayCellMarkup(cellOf('2026-07-01')).includes('lv1'));
  ok(dayCellMarkup(cellOf('2026-07-03')).includes('lv2'));
  ok(dayCellMarkup(cellOf('2026-07-05')).includes('lv3'));
  ok(!dayCellMarkup(cellOf('2026-07-02')).includes('lv1'), '0 小時唔上色');
});

test('格仔：有反思出琥珀點', () => {
  ok(dayCellMarkup(cellOf('2026-07-03')).includes('cal-dot-reflection'));
  ok(!dayCellMarkup(cellOf('2026-07-01')).includes('cal-dot-reflection'));
});

test('格仔：待同步用另一款記號（空心圈）並帶 title="待同步"', () => {
  const html = dayCellMarkup(cellOf('2026-07-08'));
  ok(html.includes('cal-dot-pending'), '應有待同步記號');
  ok(html.includes('title="待同步"'), '應有 title="待同步"');
  ok(!dayCellMarkup(cellOf('2026-07-01')).includes('cal-dot-pending'));
});

test('格仔：心情以 emoji 顯示（資料仍然係 key）', () => {
  const html = dayCellMarkup(cellOf('2026-07-05'));
  ok(html.includes(MOOD_EMOJI.tired), '應顯示 😫');
  ok(html.includes('疲累'), 'aria-label 應有心情名');
  ok(!html.includes('>tired<'), '唔應該印個 key 出嚟');
});

test('格仔：未知心情 key 唔會印出空白 emoji 位', () => {
  const [cell] = buildCells('2026-07', { '2026-07-01': day(1, { mood: '???' }) }, { today: '2026-07-01' })
    .filter(c => c.date === '2026-07-01');
  ok(!dayCellMarkup(cell).includes('cal-day-mood'));
});

test('格仔：今日加外框 class 同 aria-current', () => {
  const html = dayCellMarkup(cellOf('2026-07-08'));
  ok(html.includes('is-today'));
  ok(html.includes('aria-current="date"'));
  ok(!dayCellMarkup(cellOf('2026-07-01')).includes('aria-current'));
});

test('格仔：非本月嘅格加 is-out', () => {
  ok(dayCellMarkup(CELLS[0]).includes('is-out'));
  ok(!dayCellMarkup(cellOf('2026-07-08')).includes('is-out'));
});

test('格仔：考試日印科目名並加 is-exam', () => {
  const html = dayCellMarkup(cellOf('2026-07-15'));
  ok(html.includes('is-exam'));
  ok(html.includes('>數學</span>'), '應印科目名');
  ok(html.includes('考試日：數學'), 'aria-label 應講明係考試日');
});

test('格仔：科目名有 HTML 字元都會逃逸（老師打嘅字唔可以變成標籤）', () => {
  const [cell] = buildCells('2026-07', {}, {
    today: '2026-07-01', examDates: { '2026-07-01': '<b>數學</b>' },
  }).filter(c => c.date === '2026-07-01');
  const html = dayCellMarkup(cell);
  ok(!html.includes('<b>'), '唔可以有未逃逸嘅標籤');
  ok(html.includes('&lt;b&gt;數學&lt;/b&gt;'));
});

test('格仔全部帶得返 data-date，且一個月 42 個掣', () => {
  const html = gridMarkup(CELLS);
  eq((html.match(/<button /g) || []).length, 42);
  ok(html.includes('data-date="2026-07-08"'));
});

test('dayLabel 串起「日期・今日・時數・心情・反思・待同步」', () => {
  eq(dayLabel(cellOf('2026-07-08')), '7 月 8 日，今日，2 小時，待同步');
  eq(dayLabel(cellOf('2026-07-05')), '7 月 5 日，4.5 小時，疲累');
});

test('圖例講解色調同琥珀點；冇待同步就唔出待同步一項', () => {
  const html = legendMarkup(CELLS);
  ok(html.includes('少') && html.includes('多'));
  ok(html.includes('有寫反思'));
  ok(html.includes('待同步'), '呢個月有待同步嘅日子，應該解釋埋');
  ok(!legendMarkup(buildCells('2026-07', {}, { today: '2026-07-08' })).includes('待同步'));
});

test('頁籤：四個都要出，只有日曆係現行版面', () => {
  const html = tabBarMarkup('calendar');
  eq(TABS.map(x => x.key), ['calendar', 'report', 'papers', 'settings']);
  eq((html.match(/<button /g) || []).length, 4);
  ok(html.includes('月曆') && html.includes('週報') && html.includes('試卷') && html.includes('設定'));
  ok(html.includes('aria-current="page"'));
});

test('頁籤：未做嗰三個係 aria-disabled 而唔係 disabled（撳落去要有回應，唔可以似壞咗）', () => {
  const html = tabBarMarkup('calendar');
  eq((html.match(/aria-disabled="true"/g) || []).length, 3);
  eq((html.match(/is-soon/g) || []).length, 3);
  ok(!html.includes(' disabled'), '唔可以用 disabled 屬性');
  ok(html.includes('稍後推出'));
  eq(TABS.filter(x => x.view).map(x => x.view), ['calendar']);
});

test('頂欄第二行：有 dse_start_date 就出倒數，冇就淨係出屆別', () => {
  const actor = { cohort: '2026' };
  eq(headSubText(actor, { dse_start_date: '2026-07-18' }, '2026-07-08'), '2026 屆 · 距離 HKDSE 10 日');
  eq(headSubText(actor, {}, '2026-07-08'), '2026 屆');
  eq(headSubText(actor, { dse_start_date: '2020-04-01' }, '2026-07-08'), '2026 屆');
});

test('冇任何 i18n key 名漏咗出畫面（漏 key 時 t() 會回傳 key 本身）', () => {
  const html = gridMarkup(CELLS) + weekdayHeadMarkup() + legendMarkup(CELLS)
    + tabBarMarkup('calendar') + monthTitleText('2026-07');
  ok(!html.includes('calendar.'), 'calendar.* 有 key 漏咗');
  ok(!html.includes('nav.'), 'nav.* 有 key 漏咗');
  ok(!html.includes('mood.'), 'mood.* 有 key 漏咗');
});

await loadLang('en');

test('英文版：月份標題同星期表頭都跟語言走', () => {
  eq(monthTitleText('2026-07'), 'July 2026');
  ok(weekdayHeadMarkup().startsWith('<span>Mon</span>'));
  ok(tabBarMarkup('calendar').includes('Coming soon'));
  ok(dayCellMarkup(cellOf('2026-07-03')).includes('3 h'));
});

await loadLang('zh');   // 還原預設語言，避免影響其他測試檔案
