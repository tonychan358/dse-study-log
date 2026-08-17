import { test, eq, ok, throws } from './assert.js';

function eqPasses(actual, expected) {
  let threw = false;
  try { eq(actual, expected); } catch { threw = true; }
  return !threw;
}

test('eq：key 順序不影響相等', () => {
  ok(eqPasses({ a: 1, b: 2 }, { b: 2, a: 1 }), '{a,b} 應等於 {b,a}（順序不同）');
});

test('eq：NaN 等於 NaN', () => {
  ok(eqPasses(NaN, NaN), 'NaN 應等於 NaN');
});

test('eq：NaN 不等於 null', () => {
  throws(() => eq(NaN, null), 'NaN 不應等於 null');
});

test('eq：null 不等於 undefined', () => {
  throws(() => eq(null, undefined), 'null 不應等於 undefined');
});

test('eq：巢狀物件與陣列在結構相同時相等', () => {
  ok(
    eqPasses({ n: 3, list: [1, { x: 2 }] }, { list: [1, { x: 2 }], n: 3 }),
    '巢狀物件／陣列結構相同（key 順序不同）應相等'
  );
});

test('eq：陣列不等於外觀相似的物件', () => {
  throws(() => eq([1, 2], { 0: 1, 1: 2 }), '陣列不應等於 plain object');
});

test('eq：key 數量不同視為不相等', () => {
  throws(() => eq({ a: 1 }, { a: 1, b: 2 }), 'key 數量不同應視為不相等');
});

test('eq：0 與 -0 視為不同（Object.is 語義）', () => {
  throws(() => eq(0, -0), '0 不應等於 -0（Object.is 語義，屬預期行為）');
});

test('eq：真正不相等時會擲出例外，不會被吞掉', () => {
  throws(() => eq({ a: 1 }, { a: 2 }), '值不同的物件應擲出例外');
});
