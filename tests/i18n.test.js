import { test, eq, ok } from './assert.js';
import { loadLang, t, currentLang, flattenKeys } from '../js/i18n.js';

// 用 new URL(..., import.meta.url) 而非裸相對路徑字串，兩者在瀏覽器內對 module
// script 而言效果相同（都相對於本檔案自身），但前者在 Node 亦可正確解析
// （Node 的 fetch() 不會像瀏覽器 module 環境咁自動用呼叫方模組的 URL 補完裸相對
// 路徑），令這份測試可以在瀏覽器同 headless node 兩種環境下都得出同一結果。
const zh = await (await fetch(new URL('../i18n/zh.json', import.meta.url))).json();
const en = await (await fetch(new URL('../i18n/en.json', import.meta.url))).json();

test('兩份語言檔的 key 完全對應', () => {
  const a = flattenKeys(zh).sort();
  const b = flattenKeys(en).sort();
  eq(a, b);
});

test('沒有空字串', () => {
  const walk = (o, path = '') => Object.entries(o).forEach(([k, v]) =>
    typeof v === 'object' ? walk(v, `${path}${k}.`) : ok(String(v).trim() !== '', `${path}${k} 為空`));
  walk(zh); walk(en);
});

// 以下 3 個測試都依賴 loadLang('zh') 先完成。test() 是同步的（fn() 在
// try/catch 內同步執行，不會等待回傳的 Promise），若把 `await loadLang(...)`
// 寫在 async () => {} 的 test callback 內，test() 會在任何斷言執行之前
// 就同步 return 並記錄為通過 —— 即使斷言最終失敗（甚至永遠不會執行），
// 這個測試依然「通過」。因此改為在 module 頂層（top-level await）先把語言
// 切換完成，再用同步的 test() 包住純同步的斷言，確保每個斷言都真正執行、
// 而且在斷言失敗時 test() 真的會擲出並記錄失敗。
await loadLang('zh');

test('t 取得巢狀字串', () => {
  eq(t('login.submit'), '登入');
  eq(currentLang(), 'zh');
});

test('t 替換變數', () => {
  eq(t('day.summary', { count: 3, hours: 5.75 }), '今日 3 筆・共 5.75 小時');
});

test('t 遇未知 key 回傳 key 本身', () => {
  eq(t('no.such.key'), 'no.such.key');
});

await loadLang('en');

test('切換語言', () => {
  eq(t('login.submit'), 'Sign in');
  eq(currentLang(), 'en');
});

await loadLang('zh'); // 還原為預設語言，避免影響其他測試檔案
