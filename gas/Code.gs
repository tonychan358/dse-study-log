/**
 * DSE 溫習日誌 — Google Apps Script 後端
 *
 * 部署方式與試算表分頁結構請見同目錄 README.md。
 * 本檔案為單一 Web App 入口（doPost），讀寫同一試算表內的多個分頁。
 *
 * 本檔案涵蓋 Phase 1 Task 7–9 的範圍：Sheet 存取層、登入與 session
 * token、權限骨架、自測、記錄讀寫（getMonth／saveDay／clearDay），以及
 * 週報、設定、老師端總覽與報告、評語（getWeeklyReport／updateSettings／
 * getClassOverview／getStudentReport／saveComment）。
 *
 * 命名慣例：函式名以底線結尾（例如 json_、fail_）代表內部輔助函式，
 * 不對應任何前端 action，僅供本檔案內部呼叫。
 *
 * 並行寫入：所有「讀出整頁 → 記憶體修改 → 整批覆寫」的 handler 一律透過
 * `withLock_()` 序列化，避免兩個使用者幾乎同時觸發同一分頁的讀-改-寫時，
 * 後寫入者用自己讀到的舊版整頁覆蓋前者剛寫入的變更。純讀取的路徑
 * （`handleBootstrap`、`verifyToken`、`getConfig`）不經過鎖。
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const TOKEN_DAYS = 30;
const LOCK_WAIT_MS = 10000;

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  const e = new Error(message); e.code = code; throw e;
}

function nowIso_() { return new Date().toISOString(); }

/**
 * 包住「讀出整頁 → 記憶體修改 → 整批覆寫」這種讀取－修改－寫入的臨界區。
 * Apps Script 的 Web App 並不會為不同使用者的並行執行自動排隊，若兩個
 * 請求前後腳讀入同一分頁、各自修改、再各自整批覆寫，後寫入的一方會用
 * 自己讀到的舊版整頁覆蓋前者剛寫入的變更（例如兩個學生幾乎同時登入，
 * 其中一個的 `session_token` 會被另一個的整批覆寫悄悄抹走）。
 *
 * 用法：把「從 readSheet 開始、直到對應的 writeRowsFor_ 結束」整段包進
 * `fn`，只讀不寫的路徑（例如 `handleBootstrap`、`verifyToken`、單純的
 * `getConfig`）不需要用這個函式，包了反而會令全班的唯讀請求無謂地排隊。
 *
 * 逾時（預設 10 秒內排不到鎖）會以 `LOCKED` 錯誤回傳，而不是讓 Apps
 * Script 一直等到平台的執行時間上限才失敗；`release` 一律在 `finally`
 * 執行，確保 `fn` 內部即使呼叫 `fail_()` 拋出例外，鎖也一定會被釋放。
 *
 * Task 8、Task 9 的 `saveDay`／`clearDay`／`saveComment`／
 * `updateSettings` 等同樣屬於「讀-改-寫」的 handler，應重用本函式，
 * 不要各自另外寫一套鎖的邏輯。
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(LOCK_WAIT_MS);
  if (!acquired) fail_('LOCKED', '系統繁忙，請稍後再試');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Sheet 存取層
// ---------------------------------------------------------------------------

/**
 * 讀入整個分頁，以表頭為 key 轉成物件陣列。
 * 略過第一欄（key 欄）為空白的列，視為空白列。
 * 對本專案使用到的每個分頁而言，第一欄皆為該分頁的主鍵或必要欄位
 * （students → student_id、teachers → teacher_id、subjects → code、
 * teacher_comments → student_id、config → key、records_<cohort> → id、
 * days_<cohort> → student_id），正常寫入的合法列第一欄不會為空，
 * 因此此篩選不會誤刪合法資料。
 */
function readSheet(name) {
  const sh = SS.getSheetByName(name);
  if (!sh) fail_('NO_SHEET', '找不到分頁：' + name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1)
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      const o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

/**
 * ⚠️ 已查明的平台行為（Task 22 fix round 5，live 證據見
 * task-22-report.md「Fix round 5」、`docs/specs/2026-07-29-dse-study-log
 * -design.md` §5.2）：
 *
 * 【不變式】**同一次 Apps Script 執行內，經 Sheets 進階服務（REST）寫入
 * 過的分頁，不可以再用 `SpreadsheetApp`（`readSheet()`、
 * `sh.getDataRange().getValues()`）讀回那次寫入的內容。**
 *
 * 具體機制：`SpreadsheetApp` 對一個分頁物件維持的內容快取，在同一次
 * 執行內不會因為透過 Sheets 進階服務 REST API 寫入而更新——但**格線的
 * 維度（列數）會更新**。這個「維度新鮮、內容過期」的組合是最容易忽略
 * 的地方：`sh.getDataRange().getValues()` 回傳的陣列長度是對的（看起來
 * 確實涵蓋了新寫入的列），但那些列的內容全部讀回空字串，讓
 * `writeRowsFor_`／`readSheet()` 判斷「第一欄空白＝已刪除」的邏輯把
 * 剛剛才寫入的合法列誤判成空位——這正是 `runSelfTest()` 曾經回報
 * 「saveDay 未寫入預期列數」，以及 `writeRowsFor_` 在同一次執行內被
 * 呼叫第二次時清空操作「沒有效果」的根本原因（`matched` 從一開始就是
 * 空的，清空只是下游症狀）。
 *
 * ⚠️ **已明確排除的修法：`SpreadsheetApp.flush()`。** live 診斷中，
 * `flush()` 之後再讀曾經顯示「新鮮」的結果，但那次觀察有 confound
 * （`flush()` 生效／前一步的 REST 讀取本身順手刷新了快取／單純時間
 * 經過，三者無法區分，見 task-22-report.md「Fix round 5」的「C 有
 * confound」一節）。不要因為省一次 HTTP round-trip 就把這裡改回
 * `flush()`——那等於把正確性重新綁在一個沒有證據的平台行為假設上，
 * 跟 fix round 2 放棄 `batchUpdate` 原子性假設是同一個原則。
 *
 * 這也是為什麼 `writeRowsFor_` 內部判斷 matched／blanks 的那次讀取，
 * 以及 `runSelfTest()` 的整批覆寫往返驗證，都改用下面的
 * `getDataRangeViaRest_()`／`readSheetFresh_()`，直接透過 REST 讀取，
 * 不經過 `SpreadsheetApp`。**跨執行的一般讀取不受影響、不需要改**：
 * `handleGetMonth`／`handleGetWeeklyReport`／`handleGetClassOverview`
 * 等每一次都發生在全新的一次 `doPost()` 執行，那個時間點的
 * `SpreadsheetApp` 本來就沒有任何過期的內容快取，繼續用 `readSheet()`
 * 完全沒有問題，沒有理由為了這個問題把所有讀取都換成 REST（那只會讓
 * 每次讀取多付一次不必要的 HTTP round-trip，卻沒有任何安全性上的好處
 * ——production 稽核已經確認過，六個正式 handler 沒有一個會在同一次
 * 執行內、寫過某個分頁之後又讀回同一個分頁，見 task-22-report.md
 * 「Fix round 3」的稽核表）。
 */

/**
 * 等同 `sh.getDataRange().getValues()`，但透過 Sheets 進階服務的
 * REST API（`Values.get`）讀取，不經過 `SpreadsheetApp`——保證看得到
 * 同一次執行內剛透過 `writeRowsFor_` 寫入的內容。回傳跟 `getValues()`
 * 一樣的矩形二維陣列（缺的儲存格補上空字串，確保每一列的長度一致，
 * 因為 Sheets API v4 的 `Values.get` 預設不會把每一列都補齊到跟表頭
 * 一樣寬，這點跟 `SpreadsheetApp` 不同）。用 `UNFORMATTED_VALUE`
 * 讀值，讓數字型別的欄位（例如 `hours`）維持原生 JS number，不要變成
 * REST 預設 `FORMATTED_VALUE` 會給的顯示用字串。
 *
 * 只在「同一次執行內，可能已經寫過這個分頁、需要讀回真正最新內容」的
 * 地方使用，見本函式上方的不變式說明。呼叫前提是 Sheets 進階服務已經
 * 存在（呼叫方——`writeRowsFor_`／`runSelfTest()`——已經各自做過
 * fail-fast 檢查，這裡不重複檢查）。
 */
function getDataRangeViaRest_(name) {
  const resp = Sheets.Spreadsheets.Values.get(SS.getId(), name, { valueRenderOption: 'UNFORMATTED_VALUE' });
  const values = resp.values || [];
  if (values.length === 0) return [[]];
  var width = 0;
  values.forEach(function (row) { if (row.length > width) width = row.length; });
  return values.map(function (row) {
    const padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/**
 * 跟 `readSheet(name)` 語意完全相同（略過第一欄空白的列，依表頭轉成
 * 物件陣列），差別只在資料來源改用 `getDataRangeViaRest_()`（REST），
 * 保證同一次執行內看得到剛寫入的內容。目前只有 `runSelfTest()` 的
 * 整批覆寫往返驗證需要用到，見本節開頭的不變式說明。
 */
function readSheetFresh_(name) {
  const values = getDataRangeViaRest_(name);
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1)
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      const o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

/**
 * 把 1-indexed 欄號轉成 A1 記法的欄字母（1→'A'、12→'L'、27→'AA'）。
 * 只用來替 writeRowsFor_ 組出 Sheets API 要求的 A1 range 字串。
 */
function columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 在 `name` 分頁中，把符合 `keyPredicate` 的既有列換成 `newRows` 的內容；
 * 不符合的列完全不受影響。取代 Task 22 之前的 `writeRows(name, rows)`——
 * 那一版的語義是「這個分頁的新內容就是這些列」，所以每次寫入都要整批
 * 覆寫整個分頁：一位學生登入只為寫自己的 `session_token`，卻會連同
 * `students` 整張表（全班的明文密碼）一起重寫。詳見 spec §5.2、
 * task-22 brief。
 *
 * 演算法：
 *   1. **前置檢查**：`typeof Sheets === 'undefined'` → 立刻 `fail_()`，
 *      在碰觸任何 Range／分頁內容之前就擋下。沿用 `writeRows` 原本的
 *      fail-fast 理由（見 task-9-report.md「Fix Round 3」）：「忘記做
 *      一次性設定」是已知成因，必須變成一個完全不動資料、自己講清楚
 *      原因與補救方式的錯誤。
 *   2. 讀入分頁一次，逐列依「第一欄是否空白」分成 `blanks`（可重用的
 *      空位，記實際列號）與非空白列；非空白列轉成物件交 `keyPredicate`
 *      判斷，符合者記入 `matched`（同樣記實際列號，維持由上而下的原始
 *      順序——見下方「配對順序」的說明）。
 *   3. `newRows` 依序與 `matched` 配對：
 *        - 前 `min(matched.length, newRows.length)` 筆 → 就地覆寫該
 *          matched 列
 *        - `matched` 多出的列 → 清空（軟刪除；`readSheet` 本就略過第一
 *          欄空白的列，清空即等同刪除，見該函式註解）
 *        - `newRows` 多出的筆數 → 優先塞進 `blanks`，用盡才追加到分頁
 *          尾端
 *   4. 追加到尾端前，若會超出目前格線（`sh.getMaxRows()`），先
 *      `insertRowsAfter()` 擴張——Sheets API 不會自動擴張格線，寫入
 *      超出範圍的列會回 `exceeds grid limits`。
 *   5. 全部變更分成**兩次**`Sheets.Spreadsheets.Values.batchUpdate(...,
 *      valueInputOption: 'RAW')` 呼叫送出，理由與順序見下方「兩次呼叫、
 *      不依賴原子性」一節：
 *        - **第一次（寫）**：就地覆寫、空位重用、追加——全部是「寫入
 *          真實內容」的操作。這批若是空的，完全不送這次呼叫。
 *        - **第二次（清）**：清空 `matched` 多出的列（軟刪除）。只在有
 *          東西要清的時候才送；沒有的話（絕大多數呼叫）完全不送這次
 *          呼叫，維持只有一次 API 呼叫。
 *      兩批都是空的（`updates.length === 0`）時直接 `return`，完全不發
 *      任何 API 呼叫。
 *
 * **配對順序**：`matched[i]` 對應 `newRows[i]`，兩者皆依「分頁由上而下
 * 的既有順序」／「呼叫方傳入的順序」，兩者之間沒有其他身分關聯（例如
 * `handleSaveDay` 的 `newRows` 是重新以 `Utilities.getUuid()` 產生 `id`
 * 的新記錄，不是「延續」某一列舊記錄的身分）。這代表同一學生同一天的
 * 記錄在分頁裡的實際列號，寫入前後可能不同（例如原本連續 3 列，這次只
 * 存 2 筆 + 用掉別處一個空位，其中一筆可能落在分頁中段）。這是安全的：
 * 讀取端（`readSheet` 與所有呼叫它的 handler）一律把分頁內容當成
 * **無序集合**——`getMonth`／`getWeeklyReport`／`getClassOverview` 等
 * 全部用 `.filter()` 依 `student_id`／`date` 等欄位篩選，沒有任何地方
 * 依賴列與列之間的相對順序或列號本身的意義；唯一用到列號的地方是
 * `writeRowsFor_` 自己（決定要覆寫、清空還是追加）。
 *
 * **兩次呼叫、不依賴原子性（Task 22 fix round 2，取代 round 1 的做法）**：
 * round 1 曾經把覆寫、清空、追加合併成單一 `batchUpdate` 呼叫，靠著
 * 「這個呼叫是整批原子」的假設來保證安全；後來發現這個假設本身沒有
 * 證據——Google 對 `spreadsheets.batchUpdate`（結構性請求）有明文的原子
 * 性保證，但 `spreadsheets.values.batchUpdate`（本函式用的這個，純粹
 * 寫值）是不同的方法，官方文件沒有明講它在多個 range 之間能不能部分
 * 套用。試著設計一個 live 測試去驗證這個假設也失敗了：用「一筆合法 +
 * 一筆故意超出格線」的組合去試探，那種輸入是 Google 在**送出請求階段**
 * 就會擋下來的經典案例，測出「合法那筆也沒套用」時，沒辦法區分「因為
 * 原子」還是「因為整個請求根本沒被受理」——這個驗證方法本身就帶著
 * confound，不能證明原子性成立，只能證明不成立（測出「合法那筆套用
 * 了」才有意義）。找一個「通過驗證、卻在套用階段失敗」的輸入，是在對
 * 一個不受我們控制、內部行為未公開的 API 做研究，沒有保證會有答案，
 * 就算真的測出一次「看起來是原子」的結果，也只是一次觀察，不是合約。
 *
 * 所以現在的設計**不再需要知道答案**：把變更拆成兩次呼叫，**先送出全部
 * 「寫入真實內容」的操作（覆寫＋空位重用＋追加），確認這次呼叫沒有拋出
 * 例外之後，才送出「清空多餘 matched 列」的第二次呼叫**（見下方程式碼
 * 的兩個 `Sheets.Spreadsheets.Values.batchUpdate()` 呼叫點）。失敗矩陣：
 *
 *   - **第一次（寫）失敗**：例外在送出清空之前就拋出，分頁完全沒被動過
 *     ——跟沒呼叫過一樣。
 *   - **第一次成功、第二次（清）失敗**：該寫的新內容都已經正確寫入；
 *     只有原本就該清空的多餘 `matched` 列還留著舊內容沒被清掉。這是
 *     **多餘、但看得到、能診斷、下次還能自動清乾淨的舊資料**（見下一段
 *     「後果」），**不是**憑空消失的資料。
 *   - **兩次都成功**：正確的最終狀態。
 *
 * 這個保證**不需要**倚賴「`values.batchUpdate` 是不是原子」，也**不需要**
 * 倚賴「同一次呼叫內 `data[]` 的多個 range 會不會按陣列順序處理」——兩個
 * 未經證實的平台行為假設都不再是這個安全性質成立的前提，因為兩類變更
 * 從一開始就是兩次完全獨立、循序執行的 JS 呼叫（第二次呼叫在程式碼裡
 * 的位置，本來就保證只有在第一次呼叫同步返回、沒有拋出例外之後才會被
 * 執行到）。多付出的成本只有「清空多餘列」這條路徑會多一次 HTTP
 * round-trip，而這條路徑只在**列數縮減**（例如某天記錄從 3 筆改存 1
 * 筆）時才會發生，不是最常見的路徑——絕大多數呼叫（新增、就地覆寫、
 * 列數不變或增加）完全不受影響，仍然只有一次 API 呼叫。
 *
 * **後果——「清空失敗」留下的多餘列，`readSheet` 還是讀得到，這是刻意
 * 接受的權衡，不是被忽略的副作用**：多餘的 `matched` 列第一欄還沒被
 * 清空，所以 `readSheet`（略過第一欄空白的列，見該函式註解）不會把它
 * 過濾掉，呼叫方會看到它。具體到 `handleSaveDay`：如果某次存檔把記錄從
 * 3 筆改成 1 筆、第一次（寫）呼叫成功但第二次（清）呼叫失敗，該學生
 * 該日在 `records_<cohort>` 會暫時多出 2 筆本來要被清掉的舊記錄，
 * `getMonth`／週報等讀取端會看到「這天有 3 筆記錄」而不是使用者剛存的
 * 1 筆——這是看得見的不一致，不是資料遺失。**判斷為可接受**：這個狀態
 * 是自我修復的——同一個學生同一天下一次成功的 `saveDay`（或
 * `clearDay`）會重新對 `records_<cohort>` 執行整套 `writeRowsFor_`，
 * `keyPredicate` 一樣會抓到這些殘留的舊列（它們第一欄仍是舊的
 * `student_id`，內容合法，只是「多餘」），下一次的清空批次會把它們
 * 一併清掉，不需要任何額外的補償或修復程式碼。唯一的殘留視窗，是使用者
 * 存檔失敗（收到錯誤訊息）之後、到下一次成功存檔之前這段期間；使用者
 * 收到的是失敗提示，不是「已儲存」的假象，符合 `classifyHours_` 註解裡
 * 一貫的原則（絕不能讓呼叫方以為已儲存、實際上沒有）。
 *
 * ⚠️ **保留一句提醒，避免日後「優化」回單一呼叫**：round 1 的原子性
 * 假設從頭到尾沒有被 live 驗證過（也永久不會被驗證，round 2 已經放棄
 * 驗證它，見上文）。如果日後有人想把這兩次呼叫「優化」合併回一次
 * `batchUpdate`（例如著眼於少一次 HTTP round-trip），等於是重新把安全性
 * 綁回一個沒有證據的平台行為假設——在沒有新證據之前不要這樣做。
 *
 * `newRows` 的物件若含表頭沒有的 key，比照舊版 `writeRows`：靜默忽略。
 *
 * 對 `hours` 這類本來就是數字的欄位，Google 官方文件明講：「Non-string
 * values like booleans or numbers are always handled as RAW.」數字型別
 * 完全不受 `valueInputOption` 影響，一律原生保留，不需要額外處理。
 *
 * **`batchUpdate()` 的呼叫形狀已經 live 驗證過**（Task 22 fix round 3–5
 * 的 DIAG4：`data[]` 送出兩個 range，`response.totalUpdatedCells` 正確、
 * REST 讀回內容完整）——這件事本身沒有問題。
 *
 * ⚠️ **fix round 5（Critical）：讀入分頁那一步改成透過 REST
 * （`getDataRangeViaRest_`），不再用 `sh.getDataRange().getValues()`。**
 * 原因：live 診斷（DIAG3／DIAG5）證實，同一次 Apps Script 執行內，
 * 如果這個分頁已經被本函式（或同一次執行內的另一次呼叫，例如
 * `runSelfTest()` 連續呼叫兩次 `handleSaveDay`）透過 REST 寫過，
 * `SpreadsheetApp` 讀到的內容是過期的——**格線維度會更新，儲存格內容
 * 不會**——導致上面第 2 步的 matched／blanks 判斷把剛寫入的合法列誤判
 * 成空位，寫入看起來「成功」（`batchUpdate` 回應正常、REST 立刻讀得到）
 * 卻在下一次同執行內的呼叫裡完全找不到。詳見 `readSheet()` 下方那則
 * 不變式說明、task-22-report.md「Fix round 5」。`sh.getMaxRows()`／
 * `sh.insertRowsAfter()`（下面第 4 步）維持用 `SpreadsheetApp`，因為
 * live 證據顯示格線維度是新鮮的，只有內容過期。
 */
function writeRowsFor_(name, keyPredicate, newRows) {
  if (typeof Sheets === 'undefined') {
    fail_('SHEETS_API_MISSING',
      '尚未啟用「Google Sheets API」進階服務：Apps Script 編輯器左側' +
      '「服務」旁按「＋」→ 搜尋並加入 Google Sheets API → 儲存後重新' +
      '部署（部署 → 管理部署作業 → 編輯 → 新版本 → 部署）。啟用前，' +
      '任何寫入操作（登入、存記錄、改設定、存評語）都會失敗。');
  }
  const sh = SS.getSheetByName(name);
  if (!sh) fail_('NO_SHEET', '找不到分頁：' + name);

  // 用 REST（getDataRangeViaRest_）讀，不用 sh.getDataRange().getValues()
  // ——見 readSheet() 下方的不變式說明：同一次執行內，這個分頁如果已經
  // 被 writeRowsFor_ 自己（或同一次執行的另一次呼叫）寫過，
  // SpreadsheetApp 讀到的內容會是過期的（維度新鮮、內容過期），會讓
  // 下面的 matched／blanks 判斷把剛寫入的合法列誤判成空位。`sh` 這個
  // SpreadsheetApp 物件仍然保留，只用在下面的 getMaxRows()／
  // insertRowsAfter()——那兩個是格線的維度操作，live 證據顯示維度是
  // 新鮮的，只有儲存格內容過期，所以維度操作可以放心繼續用
  // SpreadsheetApp。
  const values = getDataRangeViaRest_(name);
  const head = values[0].map(String);

  // 逐列掃描一次：第一欄空白 -> 記入 blanks（可重用空位）；否則轉成
  // 物件交 keyPredicate 判斷，符合 -> 記入 matched。兩者都記「實際列號」
  // （1-indexed；values[0] 是表頭＝第 1 列，values[i] 對應第 i+1 列）。
  const blanks = [];
  const matched = [];
  for (var i = 1; i < values.length; i++) {
    var rowNum = i + 1;
    var raw = values[i];
    if (String(raw[0]).trim() === '') { blanks.push(rowNum); continue; }
    var obj = {};
    head.forEach(function (h, idx) { obj[h] = raw[idx]; });
    if (keyPredicate(obj)) matched.push(rowNum);
  }

  function toRowArray_(o) {
    return head.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  }
  const blankRow = new Array(head.length).fill('');

  // writeOps：全部「寫入真實內容」的操作（就地覆寫、空位重用、追加）。
  // clearOps：清空 matched 多出的列（軟刪除）。兩者分開送出兩次
  // batchUpdate，見上方文件註解「兩次呼叫、不依賴原子性」一節——不是
  // 為了效能或美觀，是刻意讓「清空」的安全性不必依賴 batchUpdate 是否
  // 原子、也不必依賴 data[] 陣列順序是否被遵守。
  const writeOps = []; // { row, values }：values 一律是單列陣列（長度 = head.length）
  const clearOps = [];

  const pairCount = Math.min(matched.length, newRows.length);
  for (var p = 0; p < pairCount; p++) {
    writeOps.push({ row: matched[p], values: toRowArray_(newRows[p]) });
  }
  // matched 多出的列 -> 清空（軟刪除）。與上面的覆寫互斥於同一次呼叫：
  // 這個迴圈只在 matched.length > newRows.length 時才有項目，此時下面的
  // 「空位重用／追加」迴圈必為空（反之亦然），兩類變更不會同時出現。
  for (var c = pairCount; c < matched.length; c++) {
    clearOps.push({ row: matched[c], values: blankRow.slice() });
  }

  // newRows 多出的筆數 -> 優先塞進 blanks，用盡才追加到尾端。全部算入
  // writeOps（都是寫入真實內容，不是清空）。
  const extra = newRows.slice(pairCount);
  const toAppend = [];
  var blankPtr = 0;
  extra.forEach(function (o) {
    if (blankPtr < blanks.length) {
      writeOps.push({ row: blanks[blankPtr], values: toRowArray_(o) });
      blankPtr++;
    } else {
      toAppend.push(o);
    }
  });

  if (toAppend.length > 0) {
    const lastRow = values.length; // 目前分頁最後一個有內容的列號（含表頭）
    const maxRows = sh.getMaxRows(); // 格線總列數，Sheets API 不會自動擴張
    const neededLastRow = lastRow + toAppend.length;
    if (neededLastRow > maxRows) {
      sh.insertRowsAfter(maxRows, neededLastRow - maxRows);
    }
    toAppend.forEach(function (o, idx) {
      writeOps.push({ row: lastRow + 1 + idx, values: toRowArray_(o) });
    });
  }

  if (writeOps.length === 0 && clearOps.length === 0) return;

  function opsToData_(ops) {
    return ops.map(function (u) {
      return {
        range: name + '!A' + u.row + ':' + columnLetter_(head.length) + u.row,
        values: [u.values]
      };
    });
  }

  // 第一次呼叫：全部真實內容。若這裡拋出例外，函式在這裡中止，第二次
  // 呼叫（清空）完全不會被執行到——分頁維持在呼叫前的原樣，見上方文件
  // 註解的失敗矩陣第一項。writeOps 為空時（例如整段清空、matched 全部
  // 大於 newRows 的情況）完全不送這次呼叫。
  if (writeOps.length > 0) {
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: opsToData_(writeOps) }, SS.getId());
  }

  // 第二次呼叫：只有清空多餘 matched 列時才送出。只在有東西要清時才
  // 呼叫——絕大多數呼叫（新增、就地覆寫、列數不變或增加）走不到這裡，
  // 全程只有一次 API 呼叫。若這裡拋出例外，writeOps 已經成功寫入的
  // 內容不受影響，只是多出幾列本該清空、但還留著舊內容的列（見上方
  // 文件註解「後果」一節，這是刻意接受的、看得見且能自我修復的權衡）。
  if (clearOps.length > 0) {
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: opsToData_(clearOps) }, SS.getId());
  }
}

function getConfig() {
  const out = {};
  readSheet('config').forEach(function (r) { out[r.key] = r.value; });
  return out;
}

// ---------------------------------------------------------------------------
// 入口：doPost
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = req.action;
    const payload = req.payload || {};
    const handlers = {
      // login／getPublicConfig 是僅有的兩個免認證 action，刻意排在其餘
      // 一律先 verifyToken(req.token) 的 action 之前，跟 handleLogin 一樣
      // 完全不觸碰 token。
      login: function () { return handleLogin(payload); },
      getPublicConfig: function () { return handleGetPublicConfig(); },
      bootstrap: function () { return handleBootstrap(verifyToken(req.token)); },
      logout: function () { return handleLogout(verifyToken(req.token)); },
      getMonth: function () { return handleGetMonth(verifyToken(req.token), payload); },
      saveDay: function () { return handleSaveDay(verifyToken(req.token), payload); },
      clearDay: function () { return handleClearDay(verifyToken(req.token), payload); },
      getWeeklyReport: function () { return handleGetWeeklyReport(verifyToken(req.token), payload); },
      updateSettings: function () { return handleUpdateSettings(verifyToken(req.token), payload); },
      getClassOverview: function () { return handleGetClassOverview(verifyToken(req.token), payload); },
      getStudentReport: function () { return handleGetStudentReport(verifyToken(req.token), payload); },
      saveComment: function () { return handleSaveComment(verifyToken(req.token), payload); }
    };
    if (!handlers[action]) fail_('UNKNOWN_ACTION', '未知的 action：' + action);
    return json_({ success: true, data: handlers[action]() });
  } catch (err) {
    return json_({
      success: false,
      error: { code: err.code || 'INTERNAL', message: String(err.message || err) }
    });
  }
}

// ---------------------------------------------------------------------------
// 登入與 token
// ---------------------------------------------------------------------------

function makeToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function findRowIndex_(name, keyField, keyValue) {
  const rows = readSheet(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyField]) === String(keyValue)) return { index: i, row: rows[i], rows: rows };
  }
  return null;
}

function handleLogin(payload) {
  const id = String(payload.id || '').trim();
  const pw = String(payload.password || '');
  if (!id || !pw) fail_('BAD_CREDENTIALS', '請輸入學號和密碼');

  // 鎖從「查出這個帳號的那一列」開始，覆蓋到「寫回 session_token」結束：
  // 這裡跟 saveDay 的「兩人搶同一個空位」不是同一種風險（本函式的
  // keyPredicate 只會命中這個帳號自己的 1 列，不會跟其他帳號的列衝突，
  // 也從來不會走到 blanks 那條路）；真正的風險是遺失更新（lost update）
  // ——findRowIndex_ 讀到的是某一刻的整列快照，若鎖只包住 writeRowsFor_
  // 本身，這個快照跟寫回之間若有另一個並發請求改了同一列的其他欄位
  // （例如同一帳號幾乎同時觸發 updateSettings 改密碼），這裡建構的
  // updatedRow 會用鎖外那份舊快照把它悄悄覆蓋掉。
  const result = withLock_(function () {
    var kind = 'student';
    var keyField = 'student_id';
    var hit = findRowIndex_('students', 'student_id', id);
    if (!hit) { kind = 'teacher'; keyField = 'teacher_id'; hit = findRowIndex_('teachers', 'teacher_id', id); }
    if (!hit) fail_('BAD_CREDENTIALS', '學號或密碼不正確');
    if (String(hit.row.status) !== 'active') fail_('BAD_CREDENTIALS', '學號或密碼不正確');
    if (String(hit.row.password) !== pw) fail_('BAD_CREDENTIALS', '學號或密碼不正確');

    const token = makeToken_();
    const expiry = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
    const sheetName = kind === 'student' ? 'students' : 'teachers';
    const updatedRow = Object.assign({}, hit.row, { session_token: token, token_expiry: expiry });
    writeRowsFor_(sheetName, function (r) { return String(r[keyField]) === id; }, [updatedRow]);
    return { kind: kind, row: updatedRow, token: token };
  });

  // buildSession_ 只讀 subjects／config，不寫任何分頁，放在鎖外執行，
  // 縮短持鎖時間。
  return Object.assign({ token: result.token }, buildSession_(result.kind, result.row));
}

function buildSession_(kind, row) {
  const cfg = getConfig();
  return {
    actor: {
      kind: kind,
      id: kind === 'student' ? String(row.student_id) : String(row.teacher_id),
      name_zh: String(row.name_zh || row.name || ''),
      name_en: String(row.name_en || row.name || ''),
      role: kind === 'student' ? 'student' : String(row.role || 'teacher'),
      cohort: kind === 'student' ? String(row.cohort) : String(cfg.current_cohort),
      my_subjects: String(row.my_subjects || '').split(',').filter(String),
      lang: String(row.lang || 'zh'),
      theme: String(row.theme || 'light')
    },
    subjects: readSheet('subjects')
      .filter(function (s) { return String(s.active) === 'TRUE' || s.active === true; })
      .sort(function (a, b) { return Number(a.sort) - Number(b.sort); }),
    config: cfg
  };
}

function verifyToken(token) {
  if (!token) fail_('AUTH_EXPIRED', '未登入');
  const sheets = [['students', 'student_id', 'student'], ['teachers', 'teacher_id', 'teacher']];
  for (var s = 0; s < sheets.length; s++) {
    const rows = readSheet(sheets[s][0]);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].session_token) === String(token)) {
        if (new Date(rows[i].token_expiry) < new Date()) fail_('AUTH_EXPIRED', '登入已過期');
        if (String(rows[i].status) !== 'active') fail_('AUTH_EXPIRED', '帳戶已停用');
        return {
          kind: sheets[s][2],
          id: String(rows[i][sheets[s][1]]),
          row: rows[i],
          sheetName: sheets[s][0]
        };
      }
    }
  }
  fail_('AUTH_EXPIRED', '登入已過期');
}

/** mode 為 'read' 或 'write'。學生只可存取自己；老師對記錄只可 read。 */
function assertCanAccess(actor, studentId, mode) {
  if (actor.kind === 'student') {
    if (String(studentId) !== actor.id) fail_('FORBIDDEN', '沒有權限');
    return actor.id;
  }
  if (mode === 'write') fail_('FORBIDDEN', '老師不可修改學生記錄');
  return String(studentId);
}

/** 學生請求一律忽略 payload 的 studentId，只認 token 對應的學生。 */
function targetStudent_(actor, payload, mode) {
  const requested = actor.kind === 'student' ? actor.id : String(payload.studentId || '');
  return assertCanAccess(actor, requested, mode);
}

function handleBootstrap(actor) {
  return buildSession_(actor.kind, actor.row);
}

function handleLogout(actor) {
  return withLock_(function () {
    const key = actor.kind === 'student' ? 'student_id' : 'teacher_id';
    // 鎖內重新讀一次該列（而不是沿用 actor.row 這份鎖外讀到的舊快照），
    // 避免在拿到鎖之前若有人剛好改了同一列的其他欄位（例如密碼），這裡
    // 又用鎖外的舊值把它覆寫回去。
    const hit = findRowIndex_(actor.sheetName, key, actor.id);
    if (!hit) return { ok: true }; // token 剛通過驗證，理論上一定找得到；找不到就當作已登出
    const updatedRow = Object.assign({}, hit.row, { session_token: '', token_expiry: '' });
    writeRowsFor_(actor.sheetName, function (r) { return String(r[key]) === actor.id; }, [updatedRow]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 公開設定（免認證）
// ---------------------------------------------------------------------------

/**
 * 登入畫面在使用者輸入帳號密碼之前——完全沒有 token——就要顯示 DSE 倒數
 * 與語錄，所以這個 action 跟 `login` 一樣排在 `verifyToken` 之前，不驗證
 * 任何身分。這代表任何知道這個 Web App 網址的人（不只是老師的學生）都
 * 呼叫得到它。
 *
 * 正因如此，這裡**絕對不能**把 `getConfig()` 的結果整個回傳。
 * `getConfig()` 讀的是 `config` 分頁的**全部**列；今天這個分頁裡確實只有
 * 倒數日期、語錄這類公開展示用的無害資料，但老師日後隨時可能在同一個
 * 分頁加入新的 key——例如某個外部服務的 API key、給自己看的內部備註、
 * 甚至日後接第三方服務用的密鑰。如果這個免認證的 action 照單全收整包
 * `config` 回傳，那一刻新 key 就會在完全沒有任何錯誤、警告或部署提示的
 * 情況下，透過這個公開端點外洩給任何人——而且因為介面看起來一直正常
 * 運作，這個外洩很可能長期沒有人發現。
 *
 * 唯一安全的做法是在這裡寫死一份白名單，只挑出登入畫面真正需要的 6 個
 * key。之後若要讓登入畫面多顯示一個 config key，必須有人手動把它加進
 * 下面這個陣列——這是刻意的摩擦：逼一個人為「這個 key 可以公開」做出
 * 明確判斷，而不是讓新加的 config key 自動繼承「可公開」這個危險的預設。
 */
function handleGetPublicConfig() {
  const cfg = getConfig();
  const whitelist = ['dse_start_date', 'exam_dates', 'quotes_zh', 'quotes_en', 'app_name_zh', 'app_name_en'];
  const out = {};
  whitelist.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
  });
  return out;
}

// ---------------------------------------------------------------------------
// 記錄讀寫：getMonth／saveDay／clearDay
// ---------------------------------------------------------------------------

/**
 * 解析某位學生所屬屆別對應的分頁名稱。
 * 學生請求：屆別直接取自 token 對應的 `actor.row.cohort`。
 * 老師請求：屆別要先用 `payload.studentId` 查出該學生的 `cohort`（老師的
 * `actor.row` 沒有 `cohort` 欄位）；找不到該學生即視為錯誤輸入。
 */
function cohortSheets_(actor, payload) {
  var cohort;
  if (actor.kind === 'student') {
    cohort = String(actor.row.cohort);
  } else {
    const sid = String(payload.studentId || '');
    const hit = findRowIndex_('students', 'student_id', sid);
    if (!hit) fail_('NOT_FOUND', '找不到學生：' + sid);
    cohort = String(hit.row.cohort);
  }
  return { records: 'records_' + cohort, days: 'days_' + cohort, cohort: cohort };
}

function handleGetMonth(actor, payload) {
  const studentId = targetStudent_(actor, payload, 'read');
  const ym = String(payload.yearMonth || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) fail_('BAD_INPUT', 'yearMonth 格式須為 YYYY-MM');
  const names = cohortSheets_(actor, payload);
  const match = function (r) {
    return String(r.student_id) === studentId && String(r.date).indexOf(ym) === 0;
  };
  return {
    records: readSheet(names.records).filter(match),
    days: readSheet(names.days).filter(match)
  };
}

function validateHours_(h) {
  const n = Number(h);
  if (isNaN(n) || n < 0.25 || n > 12 || Math.round(n / 0.25) !== n / 0.25) {
    fail_('BAD_INPUT', '時數不合法：' + h);
  }
  return n;
}

/**
 * 判斷 handleSaveDay 收到的一筆記錄的 hours 該怎麼處理，分三類：
 *  - 'omit'：缺席／空字串／恰好 0 —— 視為「這科目本日未填」的空白列，
 *    靜默略過，不當成錯誤。日編輯畫面（Task 14）整日重送當日狀態，需要
 *    一個方法表示「這科目沒填」，其 client 送出前也已先濾走 0 小時的列，
 *    這裡是多一層防線，行為一致。
 *  - 'invalid'：有值但是負數、非數字、或 NaN —— 沒有任何合法的 client
 *    會送出這種值，一旦出現代表輸入有問題，直接以 BAD_INPUT 拒絕整個
 *    請求，不可以靜默略過再回報 { ok: true }：那會讓呼叫方以為已儲存，
 *    實際上什麼都沒寫入。
 *  - 'value'：其餘情況（正數）交給 validateHours_ 判斷範圍與步進是否合法。
 */
function classifyHours_(raw) {
  if (raw === undefined || raw === null || raw === '') return 'omit';
  const n = Number(raw);
  if (isNaN(n)) return 'invalid';
  if (n === 0) return 'omit';
  if (n < 0) return 'invalid';
  return 'value';
}

/**
 * 寫入某學生某日的記錄與反思——只動 `records_<cohort>`／`days_<cohort>`
 * 兩個分頁裡「這個學生、這一天」對應的那 1–5 列（`writeRowsFor_`），
 * 不再是整批覆寫整個分頁。
 *
 * 並行寫入：本函式一次寫入 `records_<cohort>` 與 `days_<cohort>` 兩個
 * 分頁。若分開用兩次 `withLock_()`（各自鎖 records、鎖 days），中間會
 * 有一個沒有鎖保護的空窗——另一個請求可能剛好在那個空窗讀到「records
 * 已更新、days 未更新」的半新半舊狀態。因此兩個分頁的讀與寫全部包在
 * 同一個 `withLock_()` 呼叫內，整段視為一個原子操作。這個理由與寫入
 * 範圍縮小到單一 student-day 無關：即使兩位學生編輯不同日期已經完全不
 * 共用任何一列，同一位學生對 `records`／`days` 這兩個分頁的寫入仍然是
 * 一組要嘛都成功、要嘛都不成功的操作，鎖的位置維持不變（見
 * `writeRowsFor_` 文件註解「配對順序」一節與 task-22-report.md 的
 * 說明）。
 */
function handleSaveDay(actor, payload) {
  const studentId = targetStudent_(actor, payload, 'write');
  const date = String(payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('BAD_INPUT', 'date 格式須為 YYYY-MM-DD');
  const names = cohortSheets_(actor, payload);
  const stamp = nowIso_();

  // hours 缺席／''／0 → 靜默略過（空白列）；hours 為負數／非數字／NaN →
  // 以 BAD_INPUT 拒絕整個請求（絕不能靜默略過又回報 { ok: true }，那等於
  // 告訴呼叫方已儲存、實際上什麼都沒寫入）；其餘正數交 validateHours_
  // 判斷範圍與步進。詳見 classifyHours_ 的說明。
  const incoming = [];
  (payload.records || []).forEach(function (r) {
    const kind = classifyHours_(r.hours);
    if (kind === 'omit') return;
    if (kind === 'invalid') fail_('BAD_INPUT', '時數不合法：' + r.hours);
    incoming.push({
      id: Utilities.getUuid(),
      student_id: studentId,
      date: date,
      subject_code: String(r.subject_code || ''),
      hours: validateHours_(r.hours),
      content: String(r.content || ''),
      updated_at: stamp
    });
  });

  const mood = String(payload.mood || '');
  const reflection = String(payload.reflection || '');

  const isThisDay = function (r) {
    return String(r.student_id) === studentId && String(r.date) === date;
  };

  return withLock_(function () {
    writeRowsFor_(names.records, isThisDay, incoming);

    const dayRows = (mood || reflection)
      ? [{ student_id: studentId, date: date, mood: mood, reflection: reflection, updated_at: stamp }]
      : [];
    writeRowsFor_(names.days, isThisDay, dayRows);

    return { ok: true, date: date };
  });
}

/**
 * 清空某學生某日的記錄與反思：兩個分頁裡符合的列全部清空
 * （`writeRowsFor_` 的 `newRows` 傳空陣列）。與 `handleSaveDay` 同理，
 * 讀與寫同樣包在同一個 `withLock_()` 呼叫內，避免兩分頁之間出現半新
 * 半舊的空窗。
 */
function handleClearDay(actor, payload) {
  const studentId = targetStudent_(actor, payload, 'write');
  const date = String(payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('BAD_INPUT', 'date 格式須為 YYYY-MM-DD');
  const names = cohortSheets_(actor, payload);
  const isThisDay = function (r) {
    return String(r.student_id) === studentId && String(r.date) === date;
  };
  return withLock_(function () {
    writeRowsFor_(names.records, isThisDay, []);
    writeRowsFor_(names.days, isThisDay, []);
    return { ok: true, date: date };
  });
}

// ---------------------------------------------------------------------------
// 週報、設定、老師端總覽與報告、評語
// ---------------------------------------------------------------------------

function daysRange_(from, to) {
  return function (r) { return String(r.date) >= from && String(r.date) <= to; };
}

/**
 * 只用來算「相隔 n 日」的日期字串，全程只操作字串，不讓 Date 物件流出這個
 * 函式（回傳前一律 toISOString().slice(0, 10) 轉回 YYYY-MM-DD 純文字）。
 * 中午 12:00 UTC 建構是避免時區換算把日期挪前挪後一天。
 */
function addDaysIso_(dateStr, n) {
  const p = dateStr.split('-');
  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}

function handleGetWeeklyReport(actor, payload) {
  const studentId = targetStudent_(actor, payload, 'read');
  const weekStart = String(payload.weekStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) fail_('BAD_INPUT', 'weekStart 格式須為 YYYY-MM-DD');
  const names = cohortSheets_(actor, payload);
  const mine = function (r) { return String(r.student_id) === studentId; };
  const lastStart = addDaysIso_(weekStart, -7);
  const allRecords = readSheet(names.records).filter(mine);
  return {
    records: allRecords.filter(daysRange_(weekStart, addDaysIso_(weekStart, 6))),
    lastWeekRecords: allRecords.filter(daysRange_(lastStart, addDaysIso_(lastStart, 6))),
    days: readSheet(names.days).filter(mine)
           .filter(daysRange_(weekStart, addDaysIso_(weekStart, 6)))
  };
}

/**
 * 讀出 actor 自己在 students／teachers 對應的那一列 → 記憶體修改 →
 * 用 `writeRowsFor_` 就地覆寫那一列（不再是整頁覆寫），屬於檔頭與
 * withLock_() 說明的讀-改-寫臨界區，讀與寫必須包在同一次 withLock_()
 * 呼叫內，否則兩個使用者幾乎同時更新設定時，後寫入者會用自己讀到的
 * 舊列覆蓋前者剛寫入的變更。
 *
 * 密碼長度驗證特意放在 withLock_() 之外：這是純粹只看 payload、不需要
 * 讀任何分頁就能判斷的輸入驗證，跟 handleSaveDay 把時數／日期格式驗證
 * 放在鎖外是同一個原則——重複送出不合法密碼的請求不應該卡住全班共用的
 * 鎖。密碼是否可能被 Google Sheets 誤判成公式（例如以 = 開頭）已不需要
 * 在這裡處理：`writeRowsFor_` 一律用 Sheets API 的 `valueInputOption:
 * 'RAW'` 寫入，從寫入端一次性堵住這整類問題，不必再對個別欄位的內容做
 * 字元黑名單。
 */
function handleUpdateSettings(actor, payload) {
  var newPassword;
  if (payload.password !== undefined) {
    newPassword = String(payload.password);
    if (newPassword.length < 6) fail_('BAD_INPUT', '密碼至少 6 個字元');
  }
  return withLock_(function () {
    const key = actor.kind === 'student' ? 'student_id' : 'teacher_id';
    const hit = findRowIndex_(actor.sheetName, key, actor.id);
    if (!hit) fail_('NOT_FOUND', '找不到帳戶');
    const r = Object.assign({}, hit.row);
    if (payload.my_subjects !== undefined && actor.kind === 'student') {
      r.my_subjects = (payload.my_subjects || []).join(',');
    }
    if (payload.lang !== undefined) r.lang = String(payload.lang);
    if (payload.theme !== undefined) r.theme = String(payload.theme);
    if (newPassword !== undefined) r.password = newPassword;
    writeRowsFor_(actor.sheetName, function (row) { return String(row[key]) === actor.id; }, [r]);
    return { ok: true };
  });
}

function assertTeacher_(actor) {
  if (actor.kind !== 'teacher') fail_('FORBIDDEN', '只限老師');
}

/**
 * spec 只允許 period 是 'overall' 或 ISO 週（例如 '2026-W31'，格式對應
 * js/lib/dates.js 的 isoWeek()）。缺少這道驗證時，呼叫方（未來的前端或
 * 手動測試）打錯一個字就會在 teacher_comments 造出一個永遠不會被
 * handleGetStudentReport 用同樣鍵值查到的孤兒列——不會報錯、老師也看不
 * 出評語其實存到了別的地方，是一種悄悄失敗。
 */
function assertValidPeriod_(period) {
  if (period === 'overall' || /^\d{4}-W\d{2}$/.test(period)) return;
  fail_('BAD_INPUT', 'period 格式須為 overall 或 YYYY-Www（例如 2026-W31）');
}

/** 純讀取，不經過 withLock_：老師總覽只讀 students／records_<cohort>／
 *  days_<cohort>，不寫入任何分頁，鎖住反而會令全班的唯讀請求無謂排隊。 */
function handleGetClassOverview(actor, payload) {
  assertTeacher_(actor);
  const cfg = getConfig();
  const cohort = String(payload.cohort || cfg.current_cohort);
  const weekStart = String(payload.weekStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) fail_('BAD_INPUT', 'weekStart 格式須為 YYYY-MM-DD');

  const students = readSheet('students')
    .filter(function (s) { return String(s.cohort) === cohort && String(s.status) === 'active'; })
    .map(function (s) {
      return {
        student_id: String(s.student_id), name_zh: String(s.name_zh),
        name_en: String(s.name_en), class: String(s.class),
        my_subjects: String(s.my_subjects || '').split(',').filter(String)
      };
    });

  const from = addDaysIso_(weekStart, -7);
  const to = addDaysIso_(weekStart, 6);
  return {
    cohort: cohort, weekStart: weekStart, students: students,
    records: readSheet('records_' + cohort).filter(daysRange_(from, to)),
    days: readSheet('days_' + cohort).filter(daysRange_(from, to)),
    lastRecordDates: lastRecordByStudent_(cohort)
  };
}

function lastRecordByStudent_(cohort) {
  const out = {};
  readSheet('records_' + cohort).forEach(function (r) {
    const sid = String(r.student_id), d = String(r.date);
    if (!out[sid] || d > out[sid]) out[sid] = d;
  });
  return out;
}

/** 純讀取，不經過 withLock_：只讀 students／records_<cohort>／
 *  days_<cohort>／teacher_comments，不寫入任何分頁。 */
function handleGetStudentReport(actor, payload) {
  assertTeacher_(actor);
  const sid = String(payload.studentId || '');
  const period = String(payload.period || 'overall');
  assertValidPeriod_(period);
  const hit = findRowIndex_('students', 'student_id', sid);
  if (!hit) fail_('NOT_FOUND', '找不到學生');
  const cohort = String(hit.row.cohort);
  const mine = function (r) { return String(r.student_id) === sid; };
  const comments = readSheet('teacher_comments').filter(function (c) {
    return String(c.student_id) === sid && String(c.cohort) === cohort
        && String(c.period) === period;
  });
  return {
    student: {
      student_id: sid, name_zh: String(hit.row.name_zh), name_en: String(hit.row.name_en),
      class: String(hit.row.class), cohort: cohort,
      my_subjects: String(hit.row.my_subjects || '').split(',').filter(String)
    },
    records: readSheet('records_' + cohort).filter(mine),
    days: readSheet('days_' + cohort).filter(mine),
    comment: comments.length ? String(comments[0].comment) : ''
  };
}

/**
 * teacher_comments 以 (student_id, cohort, period) 為冪等鍵：用
 * `writeRowsFor_` 找出符合這個鍵的既有列，換成新的一列，確保同一鍵
 * 最終只有一列（更新，不會愈存愈多列）；不符合的列（其他學生／其他
 * period）完全不受影響。讀-找-寫屬同一個臨界區，全部包在同一次
 * `withLock_()` 呼叫內；查 sid 對應 cohort 的
 * `findRowIndex_('students', ...)` 只讀 students、不屬於
 * `teacher_comments` 這個臨界區，因此放在鎖外面先驗證完，縮短持鎖時間
 * （與 handleSaveDay 把輸入驗證放在鎖外、只把 records／days 的讀-改-寫
 * 包進鎖的做法一致）。
 */
function handleSaveComment(actor, payload) {
  assertTeacher_(actor);
  const sid = String(payload.studentId || '');
  const period = String(payload.period || 'overall');
  assertValidPeriod_(period);
  const hit = findRowIndex_('students', 'student_id', sid);
  if (!hit) fail_('NOT_FOUND', '找不到學生');
  const cohort = String(hit.row.cohort);
  const comment = String(payload.comment || '');
  const teacherId = actor.id;
  const stamp = nowIso_();

  return withLock_(function () {
    writeRowsFor_('teacher_comments', function (c) {
      return String(c.student_id) === sid && String(c.cohort) === cohort && String(c.period) === period;
    }, [{
      student_id: sid, cohort: cohort, period: period,
      comment: comment, teacher_id: teacherId, updated_at: stamp
    }]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 自測：runSelfTest
// ---------------------------------------------------------------------------

/**
 * 掃描並清空 `name` 分頁裡所有殘留的 `__SELFTEST__` 列，**不限日期**。
 * 用在 `runSelfTest()` 建立 `before` 基準線之前——見 `runSelfTest()`
 * 文件註解「不變式」一節：任何殘留列都會讓 `before` 基準線把它算進去；
 * 若殘留剛好落在往返驗證固定使用的 `2000-01-01`，`isThisDay` 判斷式
 * 還會把它直接拉進 matched／newRows 配對邏輯，這正是 live 環境真實
 * 發生過的偽陽性成因（前一次執行因為某種原因中途中止、`finally` 內的
 * 清理沒有機會或沒有成功執行，殘留的 `__SELFTEST__` 列留到下一次
 * 執行才被讀到）。不限日期地清，是刻意更保守的防線：就算殘留剛好落在
 * 別的日期、不會被 `isThisDay` 配對到，也一樣會讓 `before` 基準線多算，
 * 不值得只防「剛好同日期」這一種情況。
 *
 * 沿用既有的讀寫機制，不引入新機制：讀用 `readSheetFresh_()`（REST，
 * 理由同 `runSelfTest()` 本體——同一次執行內可能剛寫過這個分頁，見
 * `readSheet()` 上方的不變式說明）；清用 `writeRowsFor_()`（`newRows`
 * 傳空陣列＝清空所有 matched 列，跟 `handleClearDay()` 用的是同一套
 * 清空邏輯，只是這裡的 `keyPredicate` 只認 `student_id`、不看
 * `date`）。
 *
 * 回傳清掉的列數（0 代表本來就乾淨）；呼叫方用這個數字決定要不要記一筆
 * 「上一次執行留下殘留」的資訊性訊息。
 */
function sweepSelftestRows_(name) {
  const leftover = readSheetFresh_(name).filter(function (r) { return String(r.student_id) === '__SELFTEST__'; });
  if (leftover.length > 0) {
    writeRowsFor_(name, function (r) { return String(r.student_id) === '__SELFTEST__'; }, []);
  }
  return leftover.length;
}

/**
 * 於 Apps Script 編輯器手動執行。Task 7 階段檢查：
 *   0.（Fix round 3；Task 22 之後改由 writeRowsFor_ 延續同一個 fail-fast
 *      檢查）「Google Sheets API」進階服務是否已加入——這項檢查排在所有
 *      其他檢查最前面，且**必須**在下面第 4 項的整批覆寫往返驗證之前
 *      執行完畢並記錄結果：往返驗證會呼叫 handleSaveDay／handleClearDay，
 *      兩者都經過 writeRowsFor_()，而 writeRowsFor_() 一旦少了這個進階
 *      服務就會在碰任何 range 之前 fail_()（見 writeRowsFor_() 的文件
 *      註解、task-9-report.md「Fix Round 3」、task-22-report.md）。這項
 *      檢查沒有另外用 if/return 讓函式提早結束，而是跟其他檢查一樣把
 *      問題訊息 push 進 `problems`——因為即使進階服務沒加，前面幾項
 *      純讀取的檢查（分頁／欄位／重複 ID）仍然是安全、有意義的診斷，
 *      不必因為這一項沒過就跳過其餘檢查。真正重要的是：第 4 項往返
 *      驗證的既有 `problems.length === 0` 閘門，會因為這裡已經 push 了
 *      一則問題而自動被擋下，不需要額外寫一次判斷式。
 *   1. 六個固定分頁與當屆兩個分頁齊備、必要欄位齊全
 *   2. config 必要 key 齊備
 *   3. students 內部 student_id 不重複、teachers 內部 teacher_id 不重複、
 *      student_id 與 teacher_id 兩表之間不重複、subjects.code 不重複
 *   4.（Task 8）saveDay／clearDay 整批覆寫的往返驗證：只在當屆兩個分頁
 *      皆存在、且前面（含第 0 項）尚未發現任何問題時才執行，避免
 *      handleSaveDay／handleClearDay 內部的讀取在分頁缺失時擲出未被攔截
 *      的例外，令 runSelfTest() 中途崩潰、之前收集的 problems 也一併
 *      遺失。用 `__SELFTEST__`（不存在於名冊的假學號）寫入真實的
 *      records_<cohort>／days_<cohort>，測完以 try/finally 清走，確保
 *      就算中段斷言或 handleSaveDay／handleClearDay 本身擲出例外，殘留
 *      列也一定會被清理。**驗證讀一律用 `readSheetFresh_()`（REST），
 *      不用 `readSheet()`**——這一段本來就是「同一次執行內，寫過某個
 *      分頁之後，緊接著讀回同一個分頁」的典型情況，正是 `readSheet()`
 *      文件註解裡那則不變式要擋的事：Task 22 fix round 3–5 就是從這裡
 *      的偽陽性（`readSheet()` 讀到「維度新鮮、內容過期」的假象，回報
 *      「saveDay 未寫入預期列數」）一路追出這個平台行為，詳見
 *      task-22-report.md。
 *      **不變式：本函式必須可以安全地重複執行、也必須可以安全地在
 *      「上一次執行不正常結束」之後執行。** `try/finally` 本身只保證
 *      「這一次執行」結束時清乾淨，不保證「上一次執行」真的有清乾淨
 *      ——`finally` 內的清理呼叫（`handleClearDay`）本身也可能失敗、
 *      或整個 Apps Script 執行被平台強制中止（逾時、手動停止），兩種
 *      情況都會讓 `__SELFTEST__` 殘留到下一次執行才被看到。若下一次
 *      執行直接拿殘留列還在的分頁去建立 `before` 基準線，殘留列本身
 *      就會讓計數錯誤；若殘留列的日期剛好等於本函式固定使用的
 *      `2000-01-01`，`isThisDay` 判斷式還會把它當成「這個學生這一天
 *      已有的列」直接拉進 matched／newRows 配對邏輯，讓後面三個計數
 *      判斷全部失準——這正是曾經在 live 環境真實發生過的偽陽性（三個
 *      「saveDay/clearDay 未如預期」的問題同時出現，實際上寫入邏輯完全
 *      沒問題，問題出在上一次執行的殘留污染了這一次的基準線）。因此在
 *      建立 `before` 基準線**之前**，先呼叫 `sweepSelftestRows_()`
 *      清掉兩個分頁裡所有殘留的 `__SELFTEST__` 列（不限日期，見該函式
 *      文件註解）。若清出殘留，代表上一次執行不正常結束，這本身值得
 *      留意，但不是這一次執行的失敗——見下面 Logger.log 那段的說明。
 * 結果同時寫入執行日誌（Logger.log）及以陣列回傳（空陣列代表全部通過）。
 */
function runSelfTest() {
  const problems = [];

  if (typeof Sheets === 'undefined') {
    problems.push(
      '尚未啟用「Google Sheets API」進階服務：Apps Script 編輯器左側' +
      '「服務」旁按「＋」→ 搜尋並加入 Google Sheets API → 儲存後重新' +
      '部署（部署 → 管理部署作業 → 編輯 → 新版本 → 部署），再重新' +
      '執行一次 runSelfTest()。啟用前，任何寫入操作（登入、存記錄、' +
      '改設定、存評語）都會失敗，下面的整批覆寫往返驗證也會因此略過。'
    );
  }

  const required = {
    students: ['student_id', 'name_zh', 'name_en', 'class', 'cohort', 'password',
               'my_subjects', 'lang', 'theme', 'session_token', 'token_expiry', 'status'],
    teachers: ['teacher_id', 'name', 'password', 'role', 'lang', 'theme',
               'session_token', 'token_expiry', 'status'],
    subjects: ['code', 'name_zh', 'name_en', 'sort', 'active'],
    teacher_comments: ['student_id', 'cohort', 'period', 'comment', 'teacher_id', 'updated_at'],
    config: ['key', 'value']
  };
  Object.keys(required).forEach(function (name) {
    const sh = SS.getSheetByName(name);
    if (!sh) { problems.push('缺少分頁：' + name); return; }
    const head = sh.getDataRange().getValues()[0].map(String);
    required[name].forEach(function (col) {
      if (head.indexOf(col) === -1) problems.push(name + ' 缺少欄位：' + col);
    });
  });

  const cfg = getConfig();
  ['current_cohort', 'dse_start_date', 'exam_dates', 'quotes_zh', 'quotes_en'].forEach(function (k) {
    if (!cfg[k]) problems.push('config 缺少 key：' + k);
  });

  // 當屆分頁：先確認分頁存在，存在的話再檢查必要欄位是否齊備。
  const cohort = String(cfg.current_cohort || '');
  const cohortRequired = {};
  cohortRequired['records_' + cohort] =
    ['id', 'student_id', 'date', 'subject_code', 'hours', 'content', 'updated_at'];
  cohortRequired['days_' + cohort] =
    ['student_id', 'date', 'mood', 'reflection', 'updated_at'];
  Object.keys(cohortRequired).forEach(function (name) {
    const sh = SS.getSheetByName(name);
    if (!sh) { problems.push('缺少當屆分頁：' + name); return; }
    const head = sh.getDataRange().getValues()[0].map(String);
    cohortRequired[name].forEach(function (col) {
      if (head.indexOf(col) === -1) problems.push(name + ' 缺少欄位：' + col);
    });
  });

  const sids = readSheet('students').map(function (r) { return String(r.student_id); });
  const tids = readSheet('teachers').map(function (r) { return String(r.teacher_id); });
  sids.forEach(function (id) {
    if (tids.indexOf(id) !== -1) problems.push('學號與教師編號重複：' + id);
  });
  if (new Set(sids).size !== sids.length) problems.push('students 有重複的 student_id');
  if (new Set(tids).size !== tids.length) problems.push('teachers 有重複的 teacher_id');

  const codes = readSheet('subjects').map(function (r) { return String(r.code); });
  if (new Set(codes).size !== codes.length) problems.push('subjects 有重複的 code');

  // 整批覆寫的往返驗證（用 __SELFTEST__ 這個不存在於名冊的 id，測完清走）。
  // 只在當屆兩個分頁都存在、且前面尚未發現任何問題時才執行，避免
  // handleSaveDay/handleClearDay 內部的 readSheet 在分頁缺失時拋出
  // 未被攔截的例外，令 runSelfTest() 中途崩潰、之前收集的 problems 也遺失。
  //
  // ⚠️ fix round 5：這裡的驗證讀全部改用 readSheetFresh_()（REST），不用
  // readSheet()（SpreadsheetApp）。這正是本函式自己會踩到 readSheet()
  // 上方那則不變式的地方——handleSaveDay 內部透過 writeRowsFor_ 用 REST
  // 寫入 records_<cohort> 之後，這裡緊接著在同一次執行內要讀回同一個
  // 分頁確認寫入結果；用 SpreadsheetApp 讀會看到「維度新鮮、內容過期」
  // 的假象（列數對了，但剛寫入的列讀起來像是空的），造成明明寫入正確
  // 卻回報「saveDay 未寫入預期列數」的偽陽性。見 task-22-report.md
  // 「Fix round 3–5」的完整診斷過程。
  const cfg2 = getConfig();
  const rName = 'records_' + cfg2.current_cohort;
  const dName = 'days_' + cfg2.current_cohort;
  if (SS.getSheetByName(rName) && SS.getSheetByName(dName) && problems.length === 0) {
    // 前置清理：建立 before 基準線之前，先清掉兩個分頁裡任何殘留的
    // __SELFTEST__ 列（不限日期）——見 sweepSelftestRows_() 的文件註解、
    // 本函式檔頭「不變式」一節。若不清，殘留列會讓 before 把它算進去，
    // 若殘留的日期又剛好等於下面固定使用的 2000-01-01，isThisDay 判斷式
    // 還會把它拉進 matched／newRows 配對，讓下面三個計數判斷全部失準
    // ——這是曾經在 live 環境真實發生過的偽陽性根因。
    const leftoverRecords = sweepSelftestRows_(rName);
    const leftoverDays = sweepSelftestRows_(dName);
    if (leftoverRecords > 0 || leftoverDays > 0) {
      // 刻意用 Logger.log 而不是 push 進 problems：找到殘留代表「上一次
      // 執行不正常結束」，值得留意，但不是這一次執行本身的失敗——這次
      // 執行已經自己把殘留清乾淨，下面的往返驗證會在乾淨的基準線上重新
      // 跑一次、理應通過。若改成 push 進 problems，problems.length === 0
      // 會被誤判成「這次自測失敗」，呼叫方（含日後可能接的告警）會把一個
      // 已經自我修復的狀況當成當下的 bug 處理；但也不能完全不講，直接
      // 吞掉的話，「上一次執行為什麼沒清乾淨」這個訊號會永遠沒人看到
      // （例如某次改動不小心讓 handleClearDay 的清理又變回無效果，只是
      // 這次剛好沒有卡在往返驗證中間，problems 仍然是空的）——因此改記
      // 進執行日誌，人工或未來的日誌監控看得到，但不影響 problems 陣列
      // 代表的「這次自測本身通過與否」。
      Logger.log('ℹ 發現上一次執行留下的 __SELFTEST__ 殘留列（records: ' +
        leftoverRecords + '、days: ' + leftoverDays + '），已於本次執行' +
        '清理，不影響這次自測結果。若經常出現，代表上一次 runSelfTest()' +
        '執行不正常結束（例如中途逾時、被手動停止），值得留意。');
    }

    const before = readSheetFresh_(rName).length;
    const fakeActor = { kind: 'student', id: '__SELFTEST__', row: { cohort: cfg2.current_cohort } };
    // try/finally：不管中段斷言是否失敗、handleSaveDay／handleClearDay 是否
    // 擲出未預期的例外（例如 LOCKED），finally 內的 handleClearDay 一定會
    // 執行一次，避免 __SELFTEST__ 的列殘留在老師的真實資料裡；try 內再包
    // 一層 catch，令未預期的例外化為一筆 problems 訊息而不是讓整個
    // runSelfTest() 中斷、遺失之前已收集的問題。finally 內的清理呼叫本身
    // 也包一層 catch，避免清理失敗又蓋掉原本的例外或讓 runSelfTest() 中斷。
    try {
      handleSaveDay(fakeActor, { date: '2000-01-01',
        records: [{ subject_code: 'X', hours: 1 }, { subject_code: 'Y', hours: 2 }] });
      if (readSheetFresh_(rName).length !== before + 2) problems.push('saveDay 未寫入預期列數');
      handleSaveDay(fakeActor, { date: '2000-01-01', records: [{ subject_code: 'X', hours: 3 }] });
      if (readSheetFresh_(rName).length !== before + 1) problems.push('saveDay 未整批覆寫舊列');
    } catch (e) {
      problems.push('往返驗證擲出例外：' + String(e.message || e));
    } finally {
      try {
        handleClearDay(fakeActor, { date: '2000-01-01' });
      } catch (e2) {
        problems.push('往返驗證清理失敗：' + String(e2.message || e2));
      }
    }
    if (readSheetFresh_(rName).length !== before) problems.push('clearDay 未清乾淨');
  }

  Logger.log(problems.length === 0 ? '✔ 自測全部通過' : '✘ 問題：\n' + problems.join('\n'));
  return problems;
}
