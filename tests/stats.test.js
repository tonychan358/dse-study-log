import { test, eq } from './assert.js';
import { weekTotals, weekOverWeek, streakDays, daysSinceLastRecord, leastTouchedSubject }
  from '../js/lib/stats.js';

const week = [
  { date: '2026-07-27', subject_code: 'MATH', hours: 2 },
  { date: '2026-07-27', subject_code: 'PHY', hours: 1.5 },
  { date: '2026-07-29', subject_code: 'MATH', hours: 0.75 },
  { date: '2026-08-05', subject_code: 'MATH', hours: 9 }, // 下一週，不應計入
];

test('weekTotals 只計該週七日', () => {
  const r = weekTotals(week, '2026-07-27');
  eq(r.total, 4.25);
});

test('weekTotals 按日彙總', () => {
  const r = weekTotals(week, '2026-07-27');
  eq(r.byDate['2026-07-27'], 3.5);
  eq(r.byDate['2026-07-29'], 0.75);
  eq(r.byDate['2026-07-28'], undefined);
});

test('weekTotals 按科目彙總', () => {
  const r = weekTotals(week, '2026-07-27');
  eq(r.bySubject, { MATH: 2.75, PHY: 1.5 });
});

test('weekTotals 空輸入', () => {
  eq(weekTotals([], '2026-07-27'), { total: 0, byDate: {}, bySubject: {} });
});

test('weekOverWeek 上升', () => {
  eq(weekOverWeek(12, 10), { delta: 2, pct: 20 });
});

test('weekOverWeek 下跌', () => {
  eq(weekOverWeek(5, 10), { delta: -5, pct: -50 });
});

test('weekOverWeek 上週為 0 時 pct 為 null', () => {
  eq(weekOverWeek(5, 0), { delta: 5, pct: null });
});

test('streakDays 由今日起連續', () => {
  const rs = [
    { date: '2026-07-29', subject_code: 'MATH', hours: 1 },
    { date: '2026-07-28', subject_code: 'MATH', hours: 1 },
    { date: '2026-07-27', subject_code: 'MATH', hours: 1 },
  ];
  eq(streakDays(rs, '2026-07-29'), 3);
});

test('streakDays 今日未記錄則由昨日起計', () => {
  const rs = [
    { date: '2026-07-28', subject_code: 'MATH', hours: 1 },
    { date: '2026-07-27', subject_code: 'MATH', hours: 1 },
  ];
  eq(streakDays(rs, '2026-07-29'), 2);
});

test('streakDays 斷開即停', () => {
  const rs = [
    { date: '2026-07-29', subject_code: 'MATH', hours: 1 },
    { date: '2026-07-26', subject_code: 'MATH', hours: 1 },
  ];
  eq(streakDays(rs, '2026-07-29'), 1);
});

test('streakDays 無記錄為 0', () => {
  eq(streakDays([], '2026-07-29'), 0);
});

test('daysSinceLastRecord', () => {
  const rs = [{ date: '2026-07-26', subject_code: 'MATH', hours: 1 }];
  eq(daysSinceLastRecord(rs, '2026-07-29'), 3);
  eq(daysSinceLastRecord([], '2026-07-29'), null);
});

test('daysSinceLastRecord 未來日期記錄不算數，視為從未記錄', () => {
  const rs = [{ date: '2026-08-15', subject_code: 'MATH', hours: 1 }];
  eq(daysSinceLastRecord(rs, '2026-07-29'), null);
});

test('daysSinceLastRecord 未來記錄與真實過去記錄並存時，仍以過去記錄為準', () => {
  const rs = [
    { date: '2026-07-26', subject_code: 'MATH', hours: 1 },
    { date: '2026-08-15', subject_code: 'MATH', hours: 1 },
  ];
  eq(daysSinceLastRecord(rs, '2026-07-29'), 3);
});

test('leastTouchedSubject 取零時數的科目', () => {
  eq(leastTouchedSubject({ MATH: 5, PHY: 2 }, ['MATH', 'PHY', 'CHEM']), 'CHEM');
});

test('leastTouchedSubject 全部有時數時取最少', () => {
  eq(leastTouchedSubject({ MATH: 5, PHY: 2 }, ['MATH', 'PHY']), 'PHY');
});

test('leastTouchedSubject 無自選科目回傳 null', () => {
  eq(leastTouchedSubject({}, []), null);
});

test('leastTouchedSubject 完全打和時取 mySubjects 中排第一的科目', () => {
  eq(leastTouchedSubject({ A: 2, B: 2 }, ['A', 'B']), 'A');
});
