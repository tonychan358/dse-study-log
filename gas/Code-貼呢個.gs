

/* ==========================================================================
 * 臨時診斷函數（Phase 5）——查完會整段刪走，唔屬於正式後端。
 *
 * 分辨嘅問題：同一次執行內，用 Sheets API 寫入之後，SpreadsheetApp 讀
 * 唔讀得返啱先寫落去嘅「內容」（Phase 1 只比較過「列數」，冇比較內容）。
 *
 * 四種讀法喺同一次執行、同一批剛寫入嘅列上面比對，事前講定嘅預測：
 *   內容快取假設   → A=0、B=2       （SpreadsheetApp 睇唔到，REST 睇到）
 *   空位重用有 bug → A=0、B=0       （兩邊都睇唔到）
 *   根本冇問題     → A=2、B=2
 * C（flush 之後）同 D（全新 handle）唔係用嚟分辨假設，係用嚟決定修法。
 * ========================================================================== */
function DIAG5_readAfterWriteContent() {
  var ssId = SS.getId();
  var rName = 'records_' + getConfig().current_cohort;
  var probe = '__DIAG_PHASE5__';

  var before = SS.getSheetByName(rName).getDataRange().getValues();
  var blanksBefore = [];
  for (var i = 1; i < before.length; i++) {
    if (String(before[i][0]).trim() === '') blanksBefore.push(i + 1);
  }
  Logger.log('[Phase5] 寫入前：列數(含表頭)=' + before.length +
    '、空位列號=' + JSON.stringify(blanksBefore) +
    (blanksBefore.length === 0
      ? '（冇空位＝今次係純追加場景。內容快取假設預測就算係純追加一樣會重現；空位重用假設預測唔會重現。）'
      : '（有空位＝今次混合重用同追加。）'));

  writeRowsFor_(rName, function (r) { return String(r.student_id) === probe; }, [
    { id: Utilities.getUuid(), student_id: probe, date: '2000-01-01', subject_code: 'X', hours: 1, content: '', updated_at: nowIso_() },
    { id: Utilities.getUuid(), student_id: probe, date: '2000-01-01', subject_code: 'Y', hours: 2, content: '', updated_at: nowIso_() }
  ]);

  function report(label, values) {
    values = values || [];
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][1]) === probe) rows.push(i + 1);
    }
    Logger.log('[Phase5] ' + label + '：列數=' + values.length +
      '、搵到探針 ' + rows.length + ' 列 ' + JSON.stringify(rows) + '（預期 2）');
    return rows.length;
  }

  var a = report('讀法A 同一個 SpreadsheetApp handle', SS.getSheetByName(rName).getDataRange().getValues());
  var b = report('讀法B REST（Sheets.Spreadsheets.Values.get）', Sheets.Spreadsheets.Values.get(ssId, rName + '!A1:G').values);

  SpreadsheetApp.flush();
  var c = report('讀法C flush() 之後、同一個 handle', SS.getSheetByName(rName).getDataRange().getValues());

  var d = report('讀法D openById 開嘅全新 handle',
    SpreadsheetApp.openById(ssId).getSheetByName(rName).getDataRange().getValues());

  Logger.log('[Phase5] 結果彙總：A=' + a + '、B=' + b + '、C=' + c + '、D=' + d + '（每項預期 2）');
  Logger.log('[Phase5] 判讀：A=0 且 B=2 → 內容快取假設成立；A=0 且 B=0 → 寫入端有問題，快取假設死；' +
    'A=2 且 B=2 → 兩個假設都死，今次冇重現到，要搵重現條件。');

  // ---- 清理：只用 REST，唔經 writeRowsFor_（避免清理本身又中同一個問題）----
  var vals = Sheets.Spreadsheets.Values.get(ssId, rName + '!A1:G').values || [];
  var cleanup = [];
  for (var j = 1; j < vals.length; j++) {
    if (String(vals[j][1]) === probe) {
      cleanup.push({ range: rName + '!A' + (j + 1) + ':G' + (j + 1), values: [['', '', '', '', '', '', '']] });
    }
  }
  if (cleanup.length > 0) {
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: cleanup }, ssId);
    Logger.log('[Phase5] 已清理 ' + cleanup.length + ' 列探針');
  } else {
    Logger.log('[Phase5] REST 都搵唔到探針列，冇嘢可清——請人工搜尋 "' + probe + '" 確認。');
  }
}
