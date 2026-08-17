import { test, eq } from './assert.js';
import {
  isStandalone, shouldShowInstallHint, isIosDevice,
  isInstallHintDismissed, dismissInstallHint, DISMISS_KEY,
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
