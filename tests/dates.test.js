import { test, eq } from './assert.js';
import {
  hkDateString, hkToday, addDays, monthGrid, weekStartOf, isoWeek, weekdayIndex,
  daysUntil, shiftMonth,
} from '../js/lib/dates.js';

test('hkDateString：UTC 16:30 已是香港的翌日', () => {
  eq(hkDateString(new Date('2026-07-28T16:30:00Z')), '2026-07-29');
});

test('hkDateString：UTC 15:59 仍是香港的當日', () => {
  eq(hkDateString(new Date('2026-07-28T15:59:00Z')), '2026-07-28');
});

test('hkToday 接受注入的時間', () => {
  eq(hkToday(new Date('2026-04-09T02:00:00Z')), '2026-04-09');
});

test('addDays 跨月', () => {
  eq(addDays('2026-07-31', 1), '2026-08-01');
});

test('addDays 跨年往回', () => {
  eq(addDays('2026-01-01', -1), '2025-12-31');
});

test('monthGrid 長度永遠 42', () => {
  eq(monthGrid(2026, 7).length, 42);
});

test('monthGrid 2026-07 由 6 月 29 日（星期一）起', () => {
  const g = monthGrid(2026, 7);
  eq(g[0], { date: '2026-06-29', inMonth: false });
});

test('monthGrid 2026-07 尾格為 8 月 9 日', () => {
  const g = monthGrid(2026, 7);
  eq(g[41], { date: '2026-08-09', inMonth: false });
});

test('monthGrid 標記本月的日子', () => {
  const g = monthGrid(2026, 7);
  eq(g[2], { date: '2026-07-01', inMonth: true });
  eq(g[32], { date: '2026-07-31', inMonth: true });
});

test('weekStartOf 星期三回到星期一', () => {
  eq(weekStartOf('2026-07-29'), '2026-07-27');
});

test('weekStartOf 星期一回到自己', () => {
  eq(weekStartOf('2026-07-27'), '2026-07-27');
});

test('weekStartOf 星期日回到同週星期一', () => {
  eq(weekStartOf('2026-08-09'), '2026-08-03');
});

test('isoWeek 一般情況', () => {
  eq(isoWeek('2026-07-29'), '2026-W31');
});

test('isoWeek 年初屬第 1 週', () => {
  eq(isoWeek('2026-01-01'), '2026-W01');
});

test('isoWeek 跨年：2027-01-01 屬 2026 年第 53 週', () => {
  eq(isoWeek('2027-01-01'), '2026-W53');
});

test('weekdayIndex 星期一為 1、星期日為 7', () => {
  eq(weekdayIndex('2026-07-27'), 1);
  eq(weekdayIndex('2026-08-09'), 7);
});

test('daysUntil 數純日曆日數', () => {
  eq(daysUntil('2027-04-09', '2027-04-01'), 8);
  eq(daysUntil('2027-01-01', '2026-12-25'), 7);
});

test('daysUntil 已過期／就係今日／格式不符一律 0（唔可以出 NaN）', () => {
  eq(daysUntil('2020-04-01', '2026-07-08'), 0);
  eq(daysUntil('2026-07-08', '2026-07-08'), 0);
  eq(daysUntil('', '2026-07-08'), 0);
  eq(daysUntil(undefined, '2026-07-08'), 0);
  eq(daysUntil('下個月', '2026-07-08'), 0);
});

test('shiftMonth 跨年進位／退位', () => {
  eq(shiftMonth('2026-07', 1), '2026-08');
  eq(shiftMonth('2026-12', 1), '2027-01');
  eq(shiftMonth('2026-01', -1), '2025-12');
  eq(shiftMonth('2026-07', 0), '2026-07');
  eq(shiftMonth('2026-03', -14), '2025-01');
});
