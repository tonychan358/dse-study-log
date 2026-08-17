export const HOURS_MIN = 0.25;
export const HOURS_MAX = 12;
export const HOURS_STEP = 0.25;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

export function parseHours(input) {
  const n = Number(String(input).trim());
  if (String(input).trim() === '' || Number.isNaN(n)) fail('NOT_A_NUMBER', '請輸入數字');
  if (n < HOURS_MIN || n > HOURS_MAX) fail('OUT_OF_RANGE', `時數須介乎 ${HOURS_MIN} 至 ${HOURS_MAX}`);
  if (Math.round(n / HOURS_STEP) !== n / HOURS_STEP) fail('BAD_STEP', `時數須為 ${HOURS_STEP} 的倍數`);
  return n;
}

export function formatHours(n) {
  return String(Math.round(n * 100) / 100);
}

export function sumHours(list) {
  return Math.round(list.reduce((t, x) => t + Number(x.hours || 0), 0) * 100) / 100;
}
