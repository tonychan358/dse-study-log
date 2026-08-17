/*
 * 「加到主畫面」提示——純邏輯部分。
 *
 * 呢一輪刻意冇 Service Worker（見 index.html 頂部註解），所以 Android/
 * Chrome 唔會觸發 beforeinstallprompt（安裝資格要求已註冊 Service
 * Worker），呢度就唔實作「一鍵安裝」按鈕，只顯示文字提示，教識使用者
 * 用瀏覽器內建嘅選單自己加（iOS：分享→加至主畫面；Android/Desktop
 * Chrome：網址列或選單嘅「安裝」/「加至主畫面」）。SW 上馬（Task 19）
 * 之後先加返 beforeinstallprompt 一鍵安裝。
 *
 * 全部函式刻意寫成純函式（唔直接摸 DOM），方便喺 tests/install.test.js
 * 用注入嘅假 window/navigator/storage 測試，唔使起瀏覽器環境。
 */

export const DISMISS_KEY = 'installHintDismissed';

/** 目前是唔是已經以「已安裝」（standalone）模式執行緊。
 *  win / nav 可注入假物件方便測試；預設用真正嘅 window / navigator。 */
export function isStandalone(win = window, nav = navigator) {
  const mediaStandalone = Boolean(
    win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches
  );
  const iosStandalone = Boolean(nav && nav.standalone === true); // iOS Safari 專屬旗標
  return mediaStandalone || iosStandalone;
}

/** 純判斷式：唔係 standalone、亦未俾使用者手動關閉過，先顯示提示。 */
export function shouldShowInstallHint({ standalone, dismissed }) {
  return !standalone && !dismissed;
}

/** 是否 iOS（Safari／WKWebView 系）裝置——決定要唔要顯示「分享→加至
 *  主畫面」嘅專屬字句（呢句喺 Android 度講會錯，Android 冇「分享」呢個
 *  安裝入口）。 */
export function isIosDevice(nav = navigator) {
  return /iphone|ipad|ipod/i.test(String((nav && nav.userAgent) || ''));
}

export function isInstallHintDismissed(storage = localStorage) {
  try { return storage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function dismissInstallHint(storage = localStorage) {
  // 寫入失敗（例如私隱模式封鎖 localStorage）唔應該阻礙「關閉」呢個
  // UI 動作本身——安靜咁忽略，下次重新整理提示會再出現，唔算嚴重。
  try { storage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
}
