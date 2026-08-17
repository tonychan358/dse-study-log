import { test, eq } from './assert.js';
import {
  isStandalone, shouldShowInstallHint, isIosDevice,
  isInstallHintDismissed, dismissInstallHint, DISMISS_KEY,
  installUiMode, interpretInstallOutcome, canRegisterServiceWorker,
  captureInstallPrompt, hasInstallPrompt, triggerInstall,
  markInstalled, isInstalledThisSession, resetInstallState,
  subscribeInstallState,
} from '../js/lib/install.js';

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
}

test('shouldShowInstallHint：非 standalone 且未關閉過 -> 顯示', () => {
  eq(shouldShowInstallHint({ standalone: false, dismissed: false }), true);
});

test('shouldShowInstallHint：已經係 standalone -> 唔顯示', () => {
  eq(shouldShowInstallHint({ standalone: true, dismissed: false }), false);
});

test('shouldShowInstallHint：使用者已手動關閉過 -> 唔顯示', () => {
  eq(shouldShowInstallHint({ standalone: false, dismissed: true }), false);
});

test('shouldShowInstallHint：兩個條件都唔滿足 -> 唔顯示', () => {
  eq(shouldShowInstallHint({ standalone: true, dismissed: true }), false);
});

test('isStandalone：matchMedia 命中 -> true', () => {
  const fakeWin = { matchMedia: () => ({ matches: true }) };
  eq(isStandalone(fakeWin, {}), true);
});

test('isStandalone：navigator.standalone -> true（iOS Safari 專屬旗標）', () => {
  const fakeWin = { matchMedia: () => ({ matches: false }) };
  eq(isStandalone(fakeWin, { standalone: true }), true);
});

test('isStandalone：兩者皆否 -> false', () => {
  const fakeWin = { matchMedia: () => ({ matches: false }) };
  eq(isStandalone(fakeWin, { standalone: false }), false);
});

test('isIosDevice：iPhone UA -> true', () => {
  eq(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true);
});

test('isIosDevice：iPad UA -> true', () => {
  eq(isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }), true);
});

test('isIosDevice：Android UA -> false', () => {
  eq(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }), false);
});

test('isIosDevice：冇 userAgent -> false（唔擲例外）', () => {
  eq(isIosDevice({}), false);
});

test('DISMISS_KEY 係個字串常數（localStorage 用嘅 key 名）', () => {
  eq(typeof DISMISS_KEY, 'string');
});

test('isInstallHintDismissed：預設未關閉過 -> false', () => {
  eq(isInstallHintDismissed(fakeStorage()), false);
});

test('dismissInstallHint 寫入後，isInstallHintDismissed 讀到 true', () => {
  const storage = fakeStorage();
  dismissInstallHint(storage);
  eq(isInstallHintDismissed(storage), true);
});

test('isInstallHintDismissed：storage 擲例外時安靜回傳 false', () => {
  const badStorage = { getItem: () => { throw new Error('blocked'); } };
  eq(isInstallHintDismissed(badStorage), false);
});

// ------------------------------------------------------------ installUiMode

const MODE = { standalone: false, dismissed: false, canPrompt: false, ios: false, installed: false };

test('installUiMode：已 standalone -> hidden（唔騷擾已安裝嘅人）', () => {
  eq(installUiMode({ ...MODE, standalone: true, canPrompt: true, ios: true }), 'hidden');
});

test('installUiMode：使用者關閉過 -> hidden', () => {
  eq(installUiMode({ ...MODE, dismissed: true, canPrompt: true }), 'hidden');
});

test('installUiMode：本次 session 已安裝 -> hidden', () => {
  eq(installUiMode({ ...MODE, installed: true, canPrompt: true }), 'hidden');
});

test('installUiMode：Chromium 收到 beforeinstallprompt -> button（真・一撳安裝）', () => {
  eq(installUiMode({ ...MODE, canPrompt: true }), 'button');
});

test('installUiMode：iOS 且冇 prompt -> ios（圖解步驟）', () => {
  eq(installUiMode({ ...MODE, ios: true }), 'ios');
});

test('installUiMode：iPad 上嘅 Chromium（UA 似 iOS 但收到 prompt）-> button 而非 ios', () => {
  eq(installUiMode({ ...MODE, ios: true, canPrompt: true }), 'button');
});

test('installUiMode：非 iOS 又冇 prompt（Firefox／桌面 Safari）-> hint', () => {
  eq(installUiMode({ ...MODE }), 'hint');
});

// --------------------------------------------------- interpretInstallOutcome

test('interpretInstallOutcome：accepted', () => {
  eq(interpretInstallOutcome({ outcome: 'accepted' }), 'accepted');
});

test('interpretInstallOutcome：dismissed（使用者撳取消）', () => {
  eq(interpretInstallOutcome({ outcome: 'dismissed' }), 'dismissed');
});

test('interpretInstallOutcome：非預期／空值 -> unknown（唔可以當成已安裝）', () => {
  eq(interpretInstallOutcome(undefined), 'unknown');
  eq(interpretInstallOutcome({}), 'unknown');
  eq(interpretInstallOutcome({ outcome: 'accepted_maybe' }), 'unknown');
});

// -------------------------------------------------- canRegisterServiceWorker

test('canRegisterServiceWorker：https -> true', () => {
  eq(canRegisterServiceWorker({ protocol: 'https:', hostname: 'tonychan358.github.io' }), true);
});

test('canRegisterServiceWorker：http://localhost -> true（本機開發）', () => {
  eq(canRegisterServiceWorker({ protocol: 'http:', hostname: 'localhost' }), true);
  eq(canRegisterServiceWorker({ protocol: 'http:', hostname: '127.0.0.1' }), true);
});

test('canRegisterServiceWorker：http 到區網 IP -> false（非安全來源）', () => {
  eq(canRegisterServiceWorker({ protocol: 'http:', hostname: '192.168.1.20' }), false);
});

test('canRegisterServiceWorker：file:// -> false（註冊會擲例外，要事先擋）', () => {
  eq(canRegisterServiceWorker({ protocol: 'file:', hostname: '' }), false);
});

// ------------------------------------------------ 收起／觸發 beforeinstallprompt

/** 假嘅 beforeinstallprompt 事件。 */
function fakePromptEvent(outcome) {
  const e = {
    prevented: false,
    preventDefault() { e.prevented = true; },
    promptCalls: 0,
    prompt() { e.promptCalls += 1; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome }),
  };
  return e;
}

resetInstallState();

test('captureInstallPrompt：一定要 preventDefault（否則 Chromium 自己彈迷你安裝條）', () => {
  const e = fakePromptEvent('accepted');
  captureInstallPrompt(e);
  eq(e.prevented, true);
  eq(hasInstallPrompt(), true);
});

test('captureInstallPrompt 會通知訂閱者', () => {
  resetInstallState();
  let calls = 0;
  const off = subscribeInstallState(() => { calls += 1; });
  captureInstallPrompt(fakePromptEvent('accepted'));
  off();
  eq(calls, 1);
});

test('訂閱者退訂之後唔會再收到通知', () => {
  resetInstallState();
  let calls = 0;
  subscribeInstallState(() => { calls += 1; })();     // 訂閱完即刻退訂
  captureInstallPrompt(fakePromptEvent('accepted'));
  eq(calls, 0);
});

test('markInstalled：標記為已安裝，並棄掉用剩嘅 prompt 事件', () => {
  resetInstallState();
  captureInstallPrompt(fakePromptEvent('accepted'));
  markInstalled();
  eq(isInstalledThisSession(), true);
  eq(hasInstallPrompt(), false);
});

// triggerInstall 係 async。test() 係同步嘅（見 tests/i18n.test.js 的長註
// 解），async callback 內的斷言唔會被 test() 等到，失敗都會記成通過。所以
// 一律喺 module 頂層 await 攞結果，再用同步 test() 斷言。
resetInstallState();
const noPromptResult = await triggerInstall();

test('triggerInstall：未收過事件 -> unavailable（唔擲例外）', () => {
  eq(noPromptResult, 'unavailable');
  eq(isInstalledThisSession(), false);
});

resetInstallState();
const acceptEvent = fakePromptEvent('accepted');
captureInstallPrompt(acceptEvent);
const acceptResult = await triggerInstall();

test('triggerInstall：使用者接受 -> accepted，並標記為已安裝', () => {
  eq(acceptResult, 'accepted');
  eq(acceptEvent.promptCalls, 1);
  eq(isInstalledThisSession(), true);
});

resetInstallState();
captureInstallPrompt(fakePromptEvent('dismissed'));
const cancelResult = await triggerInstall();
const cancelStillHasPrompt = hasInstallPrompt();
const cancelInstalled = isInstalledThisSession();

test('triggerInstall：使用者取消 -> dismissed，唔會誤當已安裝', () => {
  eq(cancelResult, 'dismissed');
  eq(cancelInstalled, false);
});

test('triggerInstall：事件用完即棄（prompt() 每個事件只可以用一次）', () => {
  eq(cancelStillHasPrompt, false);
});

resetInstallState();
captureInstallPrompt({
  preventDefault() {},
  prompt() { throw new Error('event is no longer usable'); },
});
const throwResult = await triggerInstall();

test('triggerInstall：prompt() 擲例外 -> unknown，唔會誤報已安裝', () => {
  eq(throwResult, 'unknown');
  eq(isInstalledThisSession(), false);
});

resetInstallState();   // 還原，避免影響其他測試檔案
