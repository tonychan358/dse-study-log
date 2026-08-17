/*
 * 「加到主畫面」——判斷邏輯 + 瀏覽器安裝提示的狀態管理。
 *
 * 2026-08-17：由「只顯示文字提示」升級為「真正代使用者安裝」。SIR 的原
 * 話：「用戶加至主畫面可唔可以用一個 pop up button 連去幫佢做，唔好靠
 * 佢自己按」。平台現實決定了只能做到幾多：
 *
 *   - Chromium（Android／桌面 Chrome、Edge）：瀏覽器會在符合安裝資格時
 *     發出 `beforeinstallprompt`。攔截它（preventDefault）、收起來，之後
 *     由我們自己的「安裝」掣呼叫 `prompt()`，使用者一撳就見到系統原生的
 *     安裝對話框。**先決條件是要有已註冊的 Service Worker + manifest**，
 *     否則這個事件永遠不會發出——所以同一輪加了 `sw.js`（見該檔頭註）。
 *   - iOS Safari：**完全沒有 API**。網頁無法觸發「加入主畫面」，Apple 沒
 *     有提供任何等價介面。能做到最好的就是清楚的圖解步驟（分享 → 加至
 *     主畫面）。刻意不假扮成「一撳就裝」，亦不聲稱自己裝到。
 *   - 其他（桌面 Safari／Firefox…）：退回原本的文字提示，教使用者用瀏覽
 *     器選單自己加。
 *
 * 判斷部分全部寫成純函式（不摸 DOM、不讀 window），方便在
 * tests/install.test.js 用注入的假物件測試；有副作用的部分（收起
 * beforeinstallprompt 事件、註冊 SW）集中在檔案下半部，並且只在被呼叫時
 * 才碰 window，import 本身沒有副作用。
 */

export const DISMISS_KEY = 'installHintDismissed';

// ---------------------------------------------------------------- 純判斷式

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
 *  主畫面」嘅專屬圖解（呢套步驟喺 Android 度講會錯，Android 冇「分享」
 *  呢個安裝入口）。 */
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

/**
 * 安裝提示要顯示邊一種形態。單一入口，令登入畫面唔使自己散落一堆
 * if（呢個係整個模組最重要嘅純函式，四種 mode 各自對應一種平台現實）：
 *
 *   'hidden' —— 唔顯示（已安裝／已 standalone／使用者關閉過）
 *   'button' —— Chromium：真・一撳安裝掣（有收起咗嘅 beforeinstallprompt）
 *   'ios'    —— iOS Safari：圖解步驟（分享 → 加至主畫面），無 API 可用
 *   'hint'   —— 其餘瀏覽器：一句文字提示，教用瀏覽器選單自己加
 *
 * 次序有意義：'hidden' 的三個條件最優先（唔應該騷擾已安裝／已拒絕的
 * 人）；'button' 行先於 'ios'，因為 iPad 上的 Chrome/Edge UA 帶 iPad 但
 * 其實係 Chromium，真係收到 beforeinstallprompt 時應該畀真掣佢，唔係
 * 叫佢照住 Safari 嘅步驟做。
 */
export function installUiMode({ standalone, dismissed, canPrompt, ios, installed }) {
  if (standalone || dismissed || installed) return 'hidden';
  if (canPrompt) return 'button';
  if (ios) return 'ios';
  return 'hint';
}

/**
 * 把 `beforeinstallprompt` 的 userChoice 結果翻譯成我們自己的三態。
 * 只有 'accepted' 先當安裝咗；'dismissed'（使用者撳取消）要令個掣留低，
 * 佢可以再撳過——當成「已裝」而收起個掣係錯的，會令佢冇路可走。
 * 收到任何非預期的值（將來瀏覽器改 API／回傳 undefined）當成
 * 'unknown'，呼叫方會保守處理（唔收掣）。
 */
export function interpretInstallOutcome(choice) {
  const outcome = choice && choice.outcome;
  if (outcome === 'accepted') return 'accepted';
  if (outcome === 'dismissed') return 'dismissed';
  return 'unknown';
}

/**
 * 呢個 origin 註冊得 Service Worker 未。SW 規格只允許安全來源
 * （secure context）：https、或者 localhost／127.0.0.1 的 http。file://
 * 一定失敗（而且係 throw，唔係回傳 false），所以要事先擋住，唔好靠
 * try/catch 收拾。刻意唔用 window.isSecureContext ——  Chrome 當 file://
 * 都算 "potentially trustworthy"（isSecureContext 為 true），但 SW 註冊
 * 依然會擲例外，用它判斷會誤中。
 */
export function canRegisterServiceWorker({ protocol, hostname }) {
  if (protocol === 'https:') return true;
  if (protocol !== 'http:') return false;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

// ------------------------------------------------- 有副作用：安裝提示狀態

let deferredPrompt = null;   // 收起咗嘅 beforeinstallprompt 事件（Chromium）
let installedFlag = false;   // 收到 appinstalled 之後為 true
const listeners = new Set(); // 狀態變咗要通知邊個（登入畫面訂閱住）

function notify() {
  listeners.forEach((fn) => { try { fn(); } catch { /* 一個訂閱者爆咗唔可以拖冧其他 */ } });
}

/** 登入畫面訂閱安裝狀態變化；回傳退訂函式（重新 render 時要叫，否則會
 *  積落一堆指向已被替換 DOM 的舊 callback）。 */
export function subscribeInstallState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 攔截並收起 beforeinstallprompt。一定要 preventDefault()，否則
 *  Chromium 會自己彈迷你安裝條，我哋就冇機會用自己個掣。 */
export function captureInstallPrompt(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  deferredPrompt = event || null;
  notify();
}

export function hasInstallPrompt() { return deferredPrompt !== null; }

export function markInstalled() {
  installedFlag = true;
  deferredPrompt = null;   // 已裝，事件用唔著亦唔可以重用
  notify();
}

export function isInstalledThisSession() { return installedFlag; }

/**
 * 撳「安裝」掣時叫。回傳 interpretInstallOutcome() 的三態，或者 'unavailable'
 * （根本冇收起過事件／已經用過）。
 *
 * `prompt()` 每個事件只可以用一次，所以無論結果如何都要棄掉
 * deferredPrompt；使用者撳取消時亦棄掉——Chromium 之後會（在符合條件時）
 * 重新發一次 beforeinstallprompt，我哋照收，個掣自然會返嚟。
 */
export async function triggerInstall() {
  const event = deferredPrompt;
  if (!event || typeof event.prompt !== 'function') return 'unavailable';
  deferredPrompt = null;
  let result = 'unknown';
  try {
    await event.prompt();
    result = interpretInstallOutcome(await event.userChoice);
  } catch {
    result = 'unknown';   // 例如事件已失效；當作「唔知」，個掣照樣收起，
                          // 但唔會誤報已安裝
  }
  if (result === 'accepted') installedFlag = true;
  notify();
  return result;
}

/** 測試／重設用：清空模組內的安裝狀態。 */
export function resetInstallState() {
  deferredPrompt = null;
  installedFlag = false;
}

/**
 * 註冊 Service Worker。
 *
 * URL 用 `new URL('../../sw.js', import.meta.url)`（相對於本模組檔案）而
 * 唔係字面 './sw.js'（相對於文件 URL）：兩者喺 `/index.html` 時一樣，但
 * 前者喺任何頁面路徑下都指得中 app 根目錄嘅 sw.js，喺
 * `http://localhost:8005/` 同 `https://…github.io/dse-study-log/` 兩邊都
 * 正確。scope 唔明寫——預設就係 SW 檔案所在目錄（即 app 根），呢個正正
 * 係想要嘅相對 scope；寫死絕對路徑反而會喺其中一邊爆 SecurityError。
 *
 * 失敗（唔支援、非安全來源、註冊被拒）一律安靜略過：SW 只係離線 fallback
 * 同 beforeinstallprompt 的先決條件，冇咗 app 照用。
 */
export function registerServiceWorker(win = window, nav = navigator) {
  if (!nav || !('serviceWorker' in nav)) return false;
  if (!canRegisterServiceWorker(win.location)) return false;
  try {
    nav.serviceWorker.register(new URL('../../sw.js', import.meta.url)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
