import { test, eq } from './assert.js';
import { state, loadPublicConfig } from '../js/state.js';

// loadPublicConfig()（T11 fix round 1）用假 transport 測試，絕不打真
// 後端——見 js/api.js 的 call() 簽名：(action, payload, token) => Promise。
// 下面的假 transport 完全不碰網路，純粹記錄收到的參數、回傳／擲出預先
// 定好的結果，模擬成功／離線／後端舊版三種情境。
//
// test() 是同步的（見 i18n.test.js 的說明），所以跟該檔案一樣，先在
// module 頂層用 top-level await 把每個情境的非同步呼叫做完，再用同步的
// test() 包住純同步的斷言。

// --- 成功情境：白名單 config 併入 state.config ---
state.config = {}; // 每個情境獨立重置，避免殘留污染這個共用 singleton
let seenAction = null;
let seenPayload = null;
const ok1 = await loadPublicConfig(async (action, payload) => {
  seenAction = action;
  seenPayload = payload;
  return {
    dse_start_date: '2099-01-01',
    exam_dates: '{}',
    quotes_zh: '["語錄"]',
    quotes_en: '["quote"]',
    app_name_zh: '溫習日誌',
    app_name_en: 'Study Log',
  };
});

test('loadPublicConfig 成功：以 action=getPublicConfig、空 payload 呼叫 transport', () => {
  eq(seenAction, 'getPublicConfig');
  eq(seenPayload, {});
});

test('loadPublicConfig 成功：回傳 true，並把回應併入 state.config', () => {
  eq(ok1, true);
  eq(state.config.dse_start_date, '2099-01-01');
  eq(state.config.app_name_zh, '溫習日誌');
});

// --- 失敗情境一：離線（call() 對網路失敗一律擲出 code: 'OFFLINE'） ---
state.config = {};
const ok2 = await loadPublicConfig(async () => {
  throw Object.assign(new Error('目前離線'), { code: 'OFFLINE' });
});

test('loadPublicConfig 失敗（離線）：不會 throw，回傳 false', () => {
  eq(ok2, false);
});

test('loadPublicConfig 失敗（離線）：state.config 保持不變，不會被半殘缺的資料污染', () => {
  eq(state.config, {});
});

// --- 失敗情境二：後端仍是舊版、未部署 getPublicConfig（UNKNOWN_ACTION） ---
state.config = {};
const ok3 = await loadPublicConfig(async () => {
  throw Object.assign(new Error('未知的 action：getPublicConfig'), { code: 'UNKNOWN_ACTION' });
});

test('loadPublicConfig 失敗（後端舊版未有這個 action）：同樣不會 throw、不會拋出未捕捉的例外', () => {
  eq(ok3, false);
  eq(state.config, {});
});

// 還原 state.config，避免污染同一次測試執行內其他測試檔案——state 是
// js/state.js 匯出的共用 singleton，run.js 會依序 import 多個測試檔案。
state.config = {};
