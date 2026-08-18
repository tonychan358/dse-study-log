import { test, eq, ok } from './assert.js';
import { loadLang } from '../js/i18n.js';
import {
  MOOD_KEYS, clampHours, stepHours, subjectNameOf, buildSubjectRows, remainingSubjects,
  rowsToRecords, totalHoursOf, dayFingerprint, isDirty, shareText, SHARE_RESULT,
  dateHeadText, subjectRowMarkup, moodsMarkup, dayEditorMarkup,
  orphanNoteSubjects, editorSnapshot,
} from '../js/views/dayEditor.js';
import { HOURS_MAX, HOURS_STEP } from '../js/lib/format.js';

/*
 * 全部係純函數／純字串測試：唔起真瀏覽器畫面、唔掂 localStorage、唔打後端。
 * dayEditor.js 刻意用動態 import 攞路由（見該檔頂部註解），所以喺呢度 import
 * 佢唔會連 js/main.js 嘅 boot() 一齊跑起。
 *
 * 分享階梯（shareText）三個 API 全部注入假嘅，永遠唔會掂真嘅剪貼簿或者
 * 系統分享面板。
 */

const SUBJECTS = [
  { code: 'CHI', name_zh: '中國語文', name_en: 'Chinese', sort: 1 },
  { code: 'ENG', name_zh: '英國語文', name_en: 'English', sort: 2 },
  { code: 'MATH', name_zh: '數學（必修部分）', name_en: 'Mathematics (Compulsory)', sort: 3 },
  { code: 'M2', name_zh: '數學延伸部分單元二', name_en: 'Mathematics Extended Module 2', sort: 4 },
  { code: 'PHY', name_zh: '物理', name_en: 'Physics', sort: 5 },
  { code: 'ICT', name_zh: '資訊及通訊科技', name_en: 'ICT', sort: 6 },
];
const rec = (subject, hours, content = '') => ({ subject_code: subject, hours, content });

// ═══════════════════════════════════════════════════════ 步進夾邊界

test('clampHours：負數、NaN、空值一律當 0（＝呢科今日冇記錄）', () => {
  eq(clampHours(0), 0);
  eq(clampHours(-3), 0);
  eq(clampHours('唔係數字'), 0);
  eq(clampHours(undefined), 0);
  eq(clampHours(null), 0);
  eq(clampHours(''), 0);
});

test('clampHours：上限 12，正常值原封不動', () => {
  eq(clampHours(12), HOURS_MAX);
  eq(clampHours(13), HOURS_MAX);
  eq(clampHours(999), HOURS_MAX);
  eq(clampHours(2.5), 2.5);
  eq(clampHours(0.25), 0.25);
});

test('stepHours：一級 0.25，由 0 起計', () => {
  eq(HOURS_STEP, 0.25);
  eq(stepHours(0, 1), 0.25);
  eq(stepHours(0.25, 1), 0.5);
  eq(stepHours(1.75, 1), 2);
  eq(stepHours(0.5, -1), 0.25);
  eq(stepHours(2, -1), 1.75);
});

test('stepHours：落到 0 就停（唔會出現負時數）', () => {
  eq(stepHours(0.25, -1), 0);
  eq(stepHours(0, -1), 0);
  eq(stepHours(-5, -1), 0);
});

test('stepHours：升到 12 就停（單科上限）', () => {
  eq(stepHours(11.75, 1), 12);
  eq(stepHours(12, 1), 12);
  eq(stepHours(99, 1), 12);
});

// 撳到盡頭時回傳值同原值一樣 —— 畫面就係靠呢個判斷「撳唔郁」，要出提示。
test('stepHours：夾到盡頭時回傳值等於原值（畫面靠呢點出提示）', () => {
  eq(stepHours(12, 1), 12);
  eq(stepHours(0, -1), 0);
  ok(stepHours(0, 1) !== 0, '未到盡頭就一定要有變化');
});

test('stepHours：唔喺 0.25 格上嘅舊資料會順手拉返落格', () => {
  eq(stepHours(0.3, 1), 0.5);     // 0.3 → 0.25 → 加一級
  eq(stepHours(0.3, -1), 0);      // 0.3 → 0.25 → 減一級
  eq(stepHours(1.1, 1), 1.25);
});

test('stepHours：由 0 一路撳到頂，每一級都係 0.25 嘅倍數且永遠唔超過 12', () => {
  let value = 0;
  for (let i = 0; i < 60; i++) {
    const next = stepHours(value, 1);
    ok(next <= HOURS_MAX, `${next} 超過上限`);
    ok(Math.round(next / HOURS_STEP) === next / HOURS_STEP, `${next} 唔喺 0.25 格上`);
    ok(next >= value, '單調不減');
    value = next;
  }
  eq(value, HOURS_MAX, '撳夠 48 下應該到 12');
});

// ═══════════════════════════════════════════════════════ 科目清單組合

test('subjectNameOf：依語言取名，科目表冇就照印 code（唔可以變空白）', () => {
  const s = SUBJECTS[2];
  eq(subjectNameOf(s, 'MATH', 'zh'), '數學（必修部分）');
  eq(subjectNameOf(s, 'MATH', 'en'), 'Mathematics (Compulsory)');
  eq(subjectNameOf(undefined, 'XXX', 'zh'), 'XXX');
  eq(subjectNameOf({ code: 'Y', name_zh: '', name_en: 'Only EN' }, 'Y', 'zh'), 'Only EN');
});

test('buildSubjectRows：只列自選科目，次序跟 subjects 表', () => {
  const rows = buildSubjectRows({ subjects: SUBJECTS, mySubjects: ['PHY', 'CHI', 'MATH'] });
  eq(rows.map(r => r.code), ['CHI', 'MATH', 'PHY']);
  eq(rows.map(r => r.hours), [0, 0, 0]);
  eq(rows[1].name, '數學（必修部分）');
});

test('buildSubjectRows：帶出當日已有時數', () => {
  const rows = buildSubjectRows({
    subjects: SUBJECTS, mySubjects: ['CHI', 'MATH'], records: [rec('MATH', 1.5)],
  });
  eq(rows.find(r => r.code === 'MATH').hours, 1.5);
  eq(rows.find(r => r.code === 'CHI').hours, 0);
});

// 嗰啲時數係學生真係記錄過嘅，唔可以因為佢改咗選科就靜靜哋唔見咗。
test('buildSubjectRows：當日有記錄但唔喺自選入面嘅科都要出（排喺自選之後）', () => {
  const rows = buildSubjectRows({
    subjects: SUBJECTS, mySubjects: ['CHI'], records: [rec('ICT', 2)],
  });
  eq(rows.map(r => r.code), ['CHI', 'ICT']);
  eq(rows[1].hours, 2);
});

test('buildSubjectRows：自選咗但科目表已停用／冇咗嘅科仍然要出', () => {
  const rows = buildSubjectRows({ subjects: SUBJECTS, mySubjects: ['CHI', 'BIO'] });
  eq(rows.map(r => r.code), ['CHI', 'BIO']);
  eq(rows[1].name, 'BIO', '科目表冇就照印 code');
});

test('buildSubjectRows：臨時加嘅科（extra）排喺最後，唔會重複', () => {
  const rows = buildSubjectRows({
    subjects: SUBJECTS, mySubjects: ['CHI'], extra: ['PHY', 'CHI'],
  });
  eq(rows.map(r => r.code), ['CHI', 'PHY']);
});

// 一科一列係核准版面嘅結果，但合併嗰陣唔可以掉咗學生打過嘅字。
test('buildSubjectRows：同一科幾筆記錄合併成一列（時數相加、內容串埋）', () => {
  const rows = buildSubjectRows({
    subjects: SUBJECTS,
    mySubjects: ['MATH'],
    records: [rec('MATH', 1.5, '三角函數'), rec('MATH', 0.75, '卷二')],
  });
  eq(rows.length, 1);
  eq(rows[0].hours, 2.25);
  eq(rows[0].content, '三角函數、卷二');
});

test('buildSubjectRows：英文介面用英文科目名', () => {
  const rows = buildSubjectRows({ subjects: SUBJECTS, mySubjects: ['M2'], lang: 'en' });
  eq(rows[0].name, 'Mathematics Extended Module 2');
});

test('buildSubjectRows：冇參數都唔會擲例外', () => {
  eq(buildSubjectRows(), []);
  eq(buildSubjectRows({}), []);
});

test('remainingSubjects：只回傳畫面上未有嘅科', () => {
  const rows = buildSubjectRows({ subjects: SUBJECTS, mySubjects: ['CHI', 'MATH'] });
  eq(remainingSubjects(SUBJECTS, rows).map(s => s.code), ['ENG', 'M2', 'PHY', 'ICT']);
  eq(remainingSubjects(SUBJECTS, buildSubjectRows({
    subjects: SUBJECTS, mySubjects: SUBJECTS.map(s => s.code),
  })), [], '全部都加咗就冇得再加');
});

// ═══════════════════════════════════════════════════ 列 → 記錄（整日覆寫）

test('rowsToRecords：0 小時嘅科唔會寫入後端', () => {
  const rows = [
    { code: 'CHI', hours: 0, content: '' },
    { code: 'MATH', hours: 2, content: '' },
    { code: 'PHY', hours: 1.5, content: '' },
  ];
  eq(rowsToRecords(rows), [rec('MATH', 2), rec('PHY', 1.5)]);
});

test('rowsToRecords：保住舊記錄嘅 content（唔可以順手洗走）', () => {
  eq(rowsToRecords([{ code: 'MATH', hours: 2, content: '三角函數' }]),
     [rec('MATH', 2, '三角函數')]);
});

test('totalHoursOf：加總非零嘅列', () => {
  eq(totalHoursOf([
    { code: 'MATH', hours: 2 }, { code: 'PHY', hours: 1.5 }, { code: 'CHI', hours: 0 },
  ]), 3.5);
  eq(totalHoursOf([]), 0);
});

// ═══════════════════════════════════════════ 逐科註解（0 小時嗰個陷阱）

test('orphanNoteSubjects：寫咗註解但 0 小時嘅科要捉得返（否則儲存時靜靜哋冇咗）', () => {
  const rows = [
    { code: 'MATH', name: '數學', hours: 2, content: '三角函數' },
    { code: 'PHY', name: '物理', hours: 0, content: '力學卷二' },
    { code: 'CHI', name: '中文', hours: 0, content: '' },
    { code: 'ENG', name: '英文', hours: 0, content: '   ' },
  ];
  eq(orphanNoteSubjects(rows), [{ code: 'PHY', name: '物理' }]);
});

test('orphanNoteSubjects：全部都有時數就冇嘢要報', () => {
  eq(orphanNoteSubjects([{ code: 'MATH', name: '數學', hours: 0.25, content: '溫書' }]), []);
  eq(orphanNoteSubjects([]), []);
});

test('rowsToRecords：0 小時嗰行連註解一齊唔會寫入（後端 classifyHours_ 亦當 omit）', () => {
  eq(rowsToRecords([{ code: 'PHY', hours: 0, content: '力學卷二' }]), []);
});

// 若果指紋唔計呢啲「孤兒註解」，學生喺 0 小時嘅科寫完字撳返回，畫面會當
// 佢乜都冇改過，連問都唔問就走咗，段字冇聲冇氣消失。
test('editorSnapshot：孤兒註解計入指紋，唔會被當成「乜都冇改過」', () => {
  const clean = [{ code: 'PHY', name: '物理', hours: 0, content: '' }];
  const withNote = [{ code: 'PHY', name: '物理', hours: 0, content: '力學卷二' }];
  eq(editorSnapshot(clean).orphanNotes, []);
  eq(editorSnapshot(withNote).orphanNotes, ['PHY:力學卷二']);
  eq(isDirty(editorSnapshot(withNote), editorSnapshot(clean)), true);
});

test('editorSnapshot：records／mood／reflection 就係 saveDay 嘅 payload 形狀', () => {
  const snap = editorSnapshot(
    [{ code: 'MATH', name: '數學', hours: 2, content: '三角函數' }], 'ok', '  今日順利  ',
  );
  eq(snap.records, [rec('MATH', 2, '三角函數')]);
  eq(snap.mood, 'ok');
  eq(snap.reflection, '今日順利');
});

// ═══════════════════════════════════════════════════════ dirty state

const BASE = { records: [rec('MATH', 2), rec('PHY', 1.5)], mood: 'ok', reflection: '做完卷二' };

test('isDirty：完全一樣＝乾淨', () => {
  eq(isDirty(BASE, { ...BASE }), false);
});

test('isDirty：科目次序唔算改動', () => {
  eq(isDirty({ ...BASE, records: [rec('PHY', 1.5), rec('MATH', 2)] }, BASE), false);
});

test('isDirty：反思頭尾空白唔算改動（唔好無端端問「確定離開？」）', () => {
  eq(isDirty({ ...BASE, reflection: '  做完卷二  ' }, BASE), false);
});

test('isDirty：時數、心情、反思、加減科目全部認得出', () => {
  eq(isDirty({ ...BASE, records: [rec('MATH', 2.25), rec('PHY', 1.5)] }, BASE), true);
  eq(isDirty({ ...BASE, mood: 'tired' }, BASE), true);
  eq(isDirty({ ...BASE, mood: '' }, BASE), true);
  eq(isDirty({ ...BASE, reflection: '改咗' }, BASE), true);
  eq(isDirty({ ...BASE, records: [rec('MATH', 2)] }, BASE), true);
  eq(isDirty({ ...BASE, records: [...BASE.records, rec('CHI', 1)] }, BASE), true);
});

test('dayFingerprint：空白日同空白日一樣', () => {
  eq(dayFingerprint({}), dayFingerprint({ records: [], mood: '', reflection: '' }));
});

// ═══════════════════════════════════════════════════════ 分享階梯

const recorder = (impl) => {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
};
const abortErr = () => Object.assign(new Error('使用者取消'), { name: 'AbortError' });

const shareOk = recorder();
const r1 = await shareText('文字', { share: shareOk, copy: recorder(), legacyCopy: () => true });

test('分享：有 navigator.share 就優先用佢，唔會再複製', () => {
  eq(r1, SHARE_RESULT.shared);
  eq(shareOk.calls.length, 1);
  eq(shareOk.calls[0][0], { text: '文字' });
});

const copyAfterAbort = recorder();
const r2 = await shareText('文字', {
  share: recorder(() => { throw abortErr(); }), copy: copyAfterAbort, legacyCopy: () => true,
});

// 使用者喺系統面板撳「取消」係正常操作，唔應該當失敗退去複製、亦唔應該報錯。
test('分享：使用者取消（AbortError）當正常，唔會退去複製', () => {
  eq(r2, SHARE_RESULT.cancelled);
  eq(copyAfterAbort.calls.length, 0);
});

const copyOk = recorder();
const r3 = await shareText('文字', {
  share: recorder(() => { throw new Error('唔支援'); }), copy: copyOk, legacyCopy: () => true,
});

test('分享：share 擲其他例外 → 退到剪貼簿', () => {
  eq(r3, SHARE_RESULT.copied);
  eq(copyOk.calls[0][0], '文字');
});

const r4 = await shareText('文字', { share: null, copy: copyOk, legacyCopy: () => true });

test('分享：完全冇 navigator.share（桌面）→ 直接用剪貼簿', () => {
  eq(r4, SHARE_RESULT.copied);
});

let legacyGot = null;
const r5 = await shareText('文字', {
  share: null,
  copy: recorder(() => { throw new Error('唔係安全來源'); }),
  legacyCopy: (text) => { legacyGot = text; return true; },
});

// 舊 iOS Safari 淨係得 execCommand('copy')。
test('分享：clipboard 唔得（非安全來源／權限被拒）→ 退到 execCommand', () => {
  eq(r5, SHARE_RESULT.copied);
  eq(legacyGot, '文字');
});

const r6 = await shareText('文字', {
  share: null,
  copy: recorder(() => { throw new Error('唔得'); }),
  legacyCopy: () => false,
});
const r7 = await shareText('文字', {});

// 呢個係最要緊嘅一條：學生撳咗掣唔可以乜都冇發生。
test('分享：三級全部唔得 → 回 manual（畫面要出可全選嘅文字方塊）', () => {
  eq(r6, SHARE_RESULT.manual);
  eq(r7, SHARE_RESULT.manual, '乜 API 都冇都要有得手動複製');
});

const r8 = await shareText('文字', {
  share: null, copy: null, legacyCopy: () => { throw new Error('爆咗'); },
});

test('分享：execCommand 自己擲例外都唔會炸咗個掣，照樣退到 manual', () => {
  eq(r8, SHARE_RESULT.manual);
});

// ═══════════════════════════════════════════════════════ 顯示層（字串）

await loadLang('zh');

test('註解欄：預設收埋、aria-expanded=false，但一定要喺 DOM 入面', () => {
  const html = subjectRowMarkup({ code: 'MATH', name: '數學', hours: 2, content: '' });
  ok(html.includes('data-note-toggle="MATH"'));
  ok(html.includes('aria-expanded="false"'), '預設收埋');
  ok(html.includes('aria-controls="day-note-MATH"'));
  ok(html.includes('id="day-note-MATH" hidden'), '註解欄預設 hidden');
  ok(html.includes('data-note="MATH"'));
});

test('註解欄：有內容嘅科目收埋狀態下都睇得出（has-note）', () => {
  const withNote = subjectRowMarkup({ code: 'MATH', name: '數學', hours: 2, content: '三角函數' });
  const without = subjectRowMarkup({ code: 'MATH', name: '數學', hours: 2, content: '' });
  ok(withNote.includes('has-note'), '有註解要有記號');
  ok(!without.includes('has-note'));
  ok(withNote.includes('value="三角函數"'), '既有內容要讀返出嚟');
  ok(withNote.includes('修改'), 'aria-label 要講明係修改定新增');
});

test('註解欄：0 小時 + 有註解 → 即場出警告；有時數就唔出', () => {
  const orphan = subjectRowMarkup({ code: 'PHY', name: '物理', hours: 0, content: '力學卷二' });
  ok(orphan.includes('data-warn="PHY"'));
  ok(!orphan.includes('data-warn="PHY" role="status" hidden'), '應該睇得見');
  ok(orphan.includes('未有時數'));
  const fine = subjectRowMarkup({ code: 'PHY', name: '物理', hours: 1, content: '力學卷二' });
  ok(fine.includes('hidden'), '有時數就收埋個警告');
});

test('註解內容有 HTML 字元都會逃逸', () => {
  const html = subjectRowMarkup({ code: 'X', name: 'X', hours: 1, content: '<img src=x>' });
  ok(!html.includes('<img'), '唔可以有未逃逸嘅標籤');
  ok(html.includes('&lt;img'));
});

test('唯讀：註解直接攤出嚟，唔使老師撳開（亦冇任何輸入元件）', () => {
  const html = subjectRowMarkup({ code: 'MATH', name: '數學', hours: 2, content: '三角函數' }, true);
  ok(html.includes('三角函數'));
  ok(!html.includes('<input'), '唯讀唔可以有輸入欄');
  ok(!html.includes('data-note-toggle'), '唯讀唔可以有展開掣');
});

test('日期抬頭：「8 月 17 日」＋「星期一」', () => {
  eq(dateHeadText('2026-08-17'), { main: '8 月 17 日', sub: '星期一' });
  eq(dateHeadText('2026-08-16').sub, '星期日');
});

test('心情：五個 tile、次序同核准版面一致，資料存 key 唔存 emoji', () => {
  eq(MOOD_KEYS, ['happy', 'ok', 'tired', 'frustrated', 'fired']);
  const html = moodsMarkup('tired');
  eq((html.match(/<button /g) || []).length, 5);
  ok(html.includes('data-mood="tired"'));
  ok(html.includes('aria-pressed="true"'), '揀咗嗰個要 aria-pressed=true');
  eq((html.match(/aria-pressed="true"/g) || []).length, 1, '同一時間只可以揀一個');
  ok(html.includes('攰'), '短標籤跟核准版面');
  ok(html.includes('疲累'), '全稱留返俾螢幕閱讀器');
  ok(!html.includes('>tired<'), '唔可以印個 key 出嚟');
});

test('心情：一個都未揀時五個都係 aria-pressed=false', () => {
  eq((moodsMarkup('').match(/aria-pressed="false"/g) || []).length, 5);
});

test('科目列：出 ＋／− 掣同時數，兩粒掣都帶得返科目 code', () => {
  const html = subjectRowMarkup({ code: 'MATH', name: '數學（必修部分）', hours: 1.5, content: '' });
  ok(html.includes('data-step="-1"'));
  ok(html.includes('data-step="1"'));
  ok(html.includes('data-code="MATH"'));
  ok(html.includes('>1.5</span>'));
  ok(html.includes('數學（必修部分）'));
});

test('科目列：0 小時用淡色（is-zero），唔係唔顯示', () => {
  const html = subjectRowMarkup({ code: 'CHI', name: '中國語文', hours: 0, content: '' });
  ok(html.includes('is-zero'));
  ok(html.includes('>0</span>'));
});

test('科目列：唯讀模式冇任何 ＋／− 掣', () => {
  const html = subjectRowMarkup({ code: 'MATH', name: '數學', hours: 2, content: '' }, true);
  ok(!html.includes('<button'), '唯讀唔可以有掣');
  ok(html.includes('2'));
});

test('科目名有 HTML 字元都會逃逸（老師打嘅字唔可以變成標籤）', () => {
  const html = subjectRowMarkup({ code: 'X', name: '<b>數學</b>', hours: 1, content: '' });
  ok(!html.includes('<b>'), '唔可以有未逃逸嘅標籤');
  ok(html.includes('&lt;b&gt;數學&lt;/b&gt;'));
});

const ROWS = [
  { code: 'MATH', name: '數學（必修部分）', hours: 1.5, content: '' },
  { code: 'PHY', name: '物理', hours: 0.5, content: '' },
  { code: 'CHI', name: '中國語文', hours: 0, content: '' },
];
const FULL = dayEditorMarkup({
  date: '2026-08-17', rows: ROWS, mood: 'ok', reflection: '做完卷二', canAdd: true,
});

test('成版：抬頭、總時數、三個區塊、儲存同報給老師都齊', () => {
  ok(FULL.includes('8 月 17 日'));
  ok(FULL.includes('星期一'));
  ok(FULL.includes('id="day-total">2<'), '總時數應為 2');
  ok(FULL.includes('各科時數'));
  ok(FULL.includes('今日感受'));
  ok(FULL.includes('今日反思'));
  ok(FULL.includes('id="day-save"'));
  ok(FULL.includes('id="day-share"'));
  ok(FULL.includes('報給老師'));
  ok(FULL.includes('清空本日'));
});

test('成版：反思用 textarea，placeholder 係核准版面嗰句（學生口氣）', () => {
  ok(FULL.includes('<textarea'));
  ok(FULL.includes('今日溫咗啲咩？'));
  ok(FULL.includes('>做完卷二</textarea>'));
});

test('成版：「加其他科目」係一個掣，唔係下拉選單（唔彈鍵盤）', () => {
  ok(FULL.includes('id="day-add"'));
  ok(FULL.includes('＋ 加其他科目'));
  ok(!FULL.includes('<select'), '唔可以用 select');
  ok(!FULL.includes('type="number"'), '時數唔可以打字輸入');
  ok(!FULL.includes('type="range"'), '時數唔可以用拉桿');
});

test('成版：冇得再加科目時唔出「加其他科目」', () => {
  ok(!dayEditorMarkup({
    date: '2026-08-17', rows: ROWS, mood: '', reflection: '', canAdd: false,
  }).includes('id="day-add"'));
});

// 計劃書 §6.4：當日毫無記錄時唔顯示「報給老師」。
test('成版：當日毫無記錄時「報給老師」收埋', () => {
  const empty = dayEditorMarkup({
    date: '2026-08-17',
    rows: [{ code: 'CHI', name: '中國語文', hours: 0, content: '' }],
    mood: '', reflection: '',
  });
  ok(empty.includes('id="day-share" hidden'), '應該係 hidden');
  ok(empty.includes('id="day-save"'), '儲存掣照出（可以淨係存心情／反思）');
});

test('成版：手動複製方塊一開始收埋，但一定要喺 DOM 入面', () => {
  ok(FULL.includes('id="day-manual"'));
  ok(FULL.includes('id="day-manual-text"'));
  ok(FULL.includes('readonly'));
});

const RO = dayEditorMarkup({
  date: '2026-08-17', rows: ROWS, mood: 'ok', reflection: '做完卷二',
  readOnly: true, name: '陳大文',
});

test('唯讀（老師身分）：冇任何輸入元件、冇動作列、冇清空', () => {
  ok(!RO.includes('<textarea class="day-reflect"'), '唔可以有得改反思');
  ok(!RO.includes('data-step'), '唔可以有 ＋／− 掣');
  ok(!RO.includes('id="day-save"'));
  ok(!RO.includes('id="day-share"'));
  ok(!RO.includes('id="day-clear"'));
  ok(!RO.includes('id="day-add"'));
  ok(RO.includes('day-actions') === false, '唔應該有固定動作列');
});

test('唯讀：內容照樣睇得晒（時數、心情、反思、學生名）', () => {
  ok(RO.includes('數學（必修部分）'));
  ok(RO.includes('做完卷二'));
  ok(RO.includes('陳大文'));
  ok(RO.includes('data-mood="ok"'), '揀咗嗰個心情仍然顯示');
  eq((RO.match(/data-mood=/g) || []).length, 1, '唯讀只顯示揀咗嗰一個心情');
});

test('唯讀：當日完全冇記錄時出一句「當日沒有記錄」', () => {
  const html = dayEditorMarkup({ date: '2026-08-17', rows: [], mood: '', reflection: '', readOnly: true });
  ok(html.includes('當日沒有記錄'));
});

test('冇任何 i18n key 名漏咗出畫面（漏 key 時 t() 會回傳 key 本身）', () => {
  const html = FULL + RO + moodsMarkup('ok');
  ok(!html.includes('day.'), 'day.* 有 key 漏咗');
  ok(!html.includes('mood.'), 'mood.* 有 key 漏咗');
  ok(!html.includes('calendar.'), 'calendar.* 有 key 漏咗');
  ok(!html.includes('share.'), 'share.* 有 key 漏咗');
  ok(!html.includes('offline.'), 'offline.* 有 key 漏咗');
});

await loadLang('en');

test('英文版：抬頭、區塊標題、掣文字都跟語言走', () => {
  eq(dateHeadText('2026-08-17'), { main: 'August 17', sub: 'Mon' });
  const html = dayEditorMarkup({
    date: '2026-08-17', rows: ROWS, mood: 'ok', reflection: 'done', canAdd: true,
  });
  ok(html.includes('Hours by subject'));
  ok(html.includes("Today's reflection"));
  ok(html.includes('Send to teacher'));
  ok(html.includes('Save'));
  ok(!html.includes('day.'), '英文版亦唔可以漏 key');
});

await loadLang('zh');   // 還原預設語言，避免影響其他測試檔案
