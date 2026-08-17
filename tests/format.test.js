import { test, eq, throws } from './assert.js';
import { parseHours, formatHours, sumHours, HOURS_MIN, HOURS_MAX } from '../js/lib/format.js';

test('parseHours 接受合法值', () => {
  eq(parseHours('2'), 2);
  eq(parseHours('0.25'), 0.25);
  eq(parseHours('5.75'), 5.75);
  eq(parseHours(12), 12);
});

test('parseHours 接受前後空白', () => {
  eq(parseHours(' 1.5 '), 1.5);
});

test('parseHours 拒絕非數字', () => {
  throws(() => parseHours('abc'));
  throws(() => parseHours(''));
});

test('parseHours 拒絕超出範圍', () => {
  throws(() => parseHours('0'));
  throws(() => parseHours('-1'));
  throws(() => parseHours('12.25'));
});

test('parseHours 拒絕非 0.25 倍數', () => {
  throws(() => parseHours('0.3'));
  throws(() => parseHours('1.1'));
});

function codeOf(fn) {
  try { fn(); } catch (e) { return e.code; }
  return undefined; // 沒有擲出 → 回傳 undefined，令 eq 失敗
}

test('parseHours 的錯誤帶 code', () => {
  eq(codeOf(() => parseHours('abc')), 'NOT_A_NUMBER');
  eq(codeOf(() => parseHours('99')), 'OUT_OF_RANGE');
  eq(codeOf(() => parseHours('0.3')), 'BAD_STEP');
});

test('邊界常數', () => {
  eq(HOURS_MIN, 0.25);
  eq(HOURS_MAX, 12);
});

test('formatHours 去掉多餘的零', () => {
  eq(formatHours(1), '1');
  eq(formatHours(2.5), '2.5');
  eq(formatHours(5.75), '5.75');
});

test('sumHours 修正浮點誤差', () => {
  eq(sumHours([{ hours: 0.1 + 0.2 }, { hours: 0.7 }]), 1);
  eq(sumHours([{ hours: 2.25 }, { hours: 3.5 }]), 5.75);
  eq(sumHours([]), 0);
});
