import { test, eq } from './assert.js';
import { buildShareText, MOOD_EMOJI } from '../js/lib/share.js';

// 本檔案一律用「整段字串完全相等」斷言（eq 逐字元比對），不用 contains 式斷言——
// 格式本身就是這個函數的規格，多一個空行、少一個空格都要炸。
// 期望字串一律用一般字串 + 明確 '\n' 相接，不用多行 template literal，避免縮排
// 意外滲入字串內容（模板字面值裡的換行後若有前導空白，會原封不動變成內容的一部分）。

test('MOOD_EMOJI 對照表', () => {
  eq(MOOD_EMOJI, { happy: '😊', ok: '😐', tired: '😫', frustrated: '😤', fired: '🔥' });
});

test('完整訊息（全部段落齊備）— 中文', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: '陳大文',
    records: [
      { subject_code: 'math', hours: 2, content: '三角函數練習' },
      { subject_code: 'phy', hours: 1.5, content: '力學卷二' },
      { subject_code: 'chi', hours: 0.75, content: '' },
    ],
    subjectNames: { math: '數學', phy: '物理', chi: '中文' },
    mood: 'happy',
    reflection: '今日終於搞掂咗三角恆等式，開心。',
    streak: 12,
    lang: 'zh',
  });
  const expected =
    '📚 8月1日（六）陳大文\n' +
    '\n' +
    '數學 2h — 三角函數練習\n' +
    '物理 1.5h — 力學卷二\n' +
    '中文 0.75h\n' +
    '\n' +
    '合計 4.25 小時\n' +
    '連續打卡 12 日\n' +
    '\n' +
    '今日感受 😊\n' +
    '今日終於搞掂咗三角恆等式，開心。';
  eq(out, expected);
});

test('完整訊息（全部段落齊備）— 英文', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'Chan Tai Man',
    records: [
      { subject_code: 'math', hours: 2, content: 'Trig identities practice' },
      { subject_code: 'phy', hours: 1.5, content: 'Mechanics paper 2' },
      { subject_code: 'chi', hours: 0.75, content: '' },
    ],
    subjectNames: { math: 'Mathematics', phy: 'Physics', chi: 'Chinese' },
    mood: 'happy',
    reflection: 'Finally nailed the trig identities today, feeling good.',
    streak: 12,
    lang: 'en',
  });
  const expected =
    '📚 1 Aug (Sat) Chan Tai Man\n' +
    '\n' +
    'Mathematics 2h — Trig identities practice\n' +
    'Physics 1.5h — Mechanics paper 2\n' +
    'Chinese 0.75h\n' +
    '\n' +
    'Total 4.25 hours\n' +
    '12-day streak\n' +
    '\n' +
    'Today 😊\n' +
    'Finally nailed the trig identities today, feeling good.';
  eq(out, expected);
});

test('無 content 的記錄行：不附破折號', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時';
  eq(out, expected);
});

test('content 去除前後空白後才附加', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '   溫書   ' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）X\n\n數學 1h — 溫書\n\n合計 1 小時';
  eq(out, expected);
});

test('content 全是空白字元視為無內容', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '   ' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時';
  eq(out, expected);
});

test('記錄次序依原陣列順序，不重新排序', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [
      { subject_code: 'chi', hours: 1, content: '' },
      { subject_code: 'math', hours: 1, content: '' },
    ],
    subjectNames: { math: '數學', chi: '中文' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）X\n\n中文 1h\n數學 1h\n\n合計 2 小時';
  eq(out, expected);
});

test('未知 subject_code：直接顯示 code，不顯示 undefined', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: '阿明',
    records: [{ subject_code: 'unknownX', hours: 1, content: '' }],
    subjectNames: {},
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）阿明\n\nunknownX 1h\n\n合計 1 小時';
  eq(out, expected);
});

test('streak 為 0 時不顯示連續打卡行', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時');
});

test('streak 為 1 時不顯示連續打卡行', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 1,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時');
});

test('streak 為 2 時顯示連續打卡行（邊界）', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 2,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時\n連續打卡 2 日');
});

test('無 mood 但有 reflection：只顯示反思行', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '今日狀態麻麻。',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時\n\n今日狀態麻麻。');
});

test('有 mood 但無 reflection：只顯示今日感受行', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: 'tired',
    reflection: '   ',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時\n\n今日感受 😫');
});

test('mood 不在 MOOD_EMOJI 對照表內：視為無 mood', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: 'confused',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時');
});

test('只有記錄，其餘全空：無多餘空行、結尾無多餘換行', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 1,
    lang: 'zh',
  });
  const expected = '📚 8月1日（六）X\n\n數學 1h\n\n合計 1 小時';
  eq(out, expected);
  eq(out.endsWith('\n'), false, '結尾不應有多餘換行');
  eq(out.includes('\n\n\n'), false, '不應有連續空行');
});

test('日期：月末（7月31日）', () => {
  const out = buildShareText({
    date: '2026-07-31',
    name: '阿明',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: '數學' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 7月31日（五）阿明\n\n數學 1h\n\n合計 1 小時');
});

test('日期：跨年（2027年1月1日）— 英文', () => {
  const out = buildShareText({
    date: '2027-01-01',
    name: 'X',
    records: [{ subject_code: 'math', hours: 1, content: '' }],
    subjectNames: { math: 'Mathematics' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'en',
  });
  eq(out, '📚 1 Jan (Fri) X\n\nMathematics 1h\n\nTotal 1 hours');
});

test('浮點合計：0.25 + 0.5 + 2.75 修正為 3.5', () => {
  const out = buildShareText({
    date: '2026-08-01',
    name: '阿明',
    records: [
      { subject_code: 'a', hours: 0.25, content: '' },
      { subject_code: 'b', hours: 0.5, content: '' },
      { subject_code: 'c', hours: 2.75, content: '' },
    ],
    subjectNames: { a: 'A科', b: 'B科', c: 'C科' },
    mood: '',
    reflection: '',
    streak: 0,
    lang: 'zh',
  });
  eq(out, '📚 8月1日（六）阿明\n\nA科 0.25h\nB科 0.5h\nC科 2.75h\n\n合計 3.5 小時');
});
