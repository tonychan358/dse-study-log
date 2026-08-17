const results = [];

export function test(name, fn) {
  try { fn(); results.push({ pass: true, name }); }
  catch (e) { results.push({ pass: false, name, msg: e.message }); }
}

function isEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  const aIsArray = Array.isArray(a), bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => isEqual(v, b[i]));
  }
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(k => Object.prototype.hasOwnProperty.call(b, k) && isEqual(a[k], b[k]));
}

function describe(value) {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (value === undefined) return 'undefined';
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

export function eq(actual, expected, msg) {
  if (isEqual(actual, expected)) return;
  const a = describe(actual), b = describe(expected);
  throw new Error(`${msg ? msg + ' — ' : ''}預期 ${b}，實際 ${a}`);
}

export function ok(value, msg) {
  if (!value) throw new Error(msg || '預期為真值');
}

export function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || '預期擲出例外，但沒有');
}

export function renderResults() {
  const out = document.getElementById('out');
  const failed = results.filter(r => !r.pass);
  out.innerHTML =
    `<h1 class="${failed.length ? 'fail' : 'pass'}">` +
    `${results.length - failed.length} / ${results.length} 通過</h1>` +
    results.map(r =>
      `<div class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '✔' : '✘'} ${r.name}` +
      `${r.pass ? '' : `<br><small>${r.msg}</small>`}</div>`
    ).join('');
}
