let dict = {};
let lang = 'zh';

export function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

export async function loadLang(next) {
  const res = await fetch(new URL(`../i18n/${next}.json`, import.meta.url));
  dict = await res.json();
  lang = next;
  document.documentElement.lang = next === 'zh' ? 'zh-Hant' : 'en';
}

export function currentLang() { return lang; }

export function t(key, vars = {}) {
  const value = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
  if (typeof value !== 'string') { console.warn('[i18n] 缺少 key：', key); return key; }
  return value.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
