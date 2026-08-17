/*
 * 唯一的後端存取層 —— 所有 Google Apps Script 呼叫都經過這裡的 call()。
 * 用 text/plain 而非 application/json 是刻意的：Apps Script 的 doPost
 * 不能回應 CORS preflight（OPTIONS），application/json 會觸發瀏覽器發
 * preflight 而失敗；text/plain 屬於「simple request」，不會觸發 preflight。
 */

// 部署後填入 T7 產出的 /exec 網址（見 gas/README.md 第 7 節）。
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbwH43MUAuOW3aNVvgIKocfw024lsod4KdFtFYEm-2sAwQAJF5aiKjTyA78JCnSpEr_e/exec';

/**
 * 呼叫後端單一入口。成功回傳 body.data；失敗一律擲出帶 `code` 的
 * Error（呼叫方靠 err.code 分流：BAD_CREDENTIALS／AUTH_EXPIRED／
 * FORBIDDEN／BAD_INPUT／NOT_FOUND／OFFLINE／NO_BACKEND…）。
 */
export async function call(action, payload = {}, token = null) {
  if (GAS_URL.startsWith('PASTE_')) {
    throw Object.assign(new Error('尚未設定 GAS_URL，請見 gas/README.md'), { code: 'NO_BACKEND' });
  }
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
    });
  } catch {
    throw Object.assign(new Error('目前離線'), { code: 'OFFLINE' });
  }
  if (!res.ok) throw Object.assign(new Error(`伺服器回應 ${res.status}`), { code: 'OFFLINE' });
  const body = await res.json();
  if (!body.success) {
    throw Object.assign(new Error(body.error.message), { code: body.error.code });
  }
  return body.data;
}
