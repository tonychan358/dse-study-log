import { addDays } from './dates.js';

const round2 = n => Math.round(n * 100) / 100;

export function weekTotals(records, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const inWeek = records.filter(r => days.includes(r.date));
  const byDate = {}, bySubject = {};
  for (const r of inWeek) {
    byDate[r.date] = round2((byDate[r.date] || 0) + Number(r.hours));
    bySubject[r.subject_code] = round2((bySubject[r.subject_code] || 0) + Number(r.hours));
  }
  const total = round2(inWeek.reduce((t, r) => t + Number(r.hours), 0));
  return { total, byDate, bySubject };
}

export function weekOverWeek(thisTotal, lastTotal) {
  const delta = round2(thisTotal - lastTotal);
  const pct = lastTotal === 0 ? null : Math.round((delta / lastTotal) * 100);
  return { delta, pct };
}

export function streakDays(records, today) {
  const dates = new Set(records.map(r => r.date));
  if (dates.size === 0) return 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (dates.has(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}

export function daysSinceLastRecord(records, today) {
  const pastDates = records.map(r => r.date).filter(d => d <= today);
  if (pastDates.length === 0) return null;
  const last = pastDates.sort().at(-1);
  let n = 0, cursor = today;
  while (cursor > last) { n++; cursor = addDays(cursor, -1); }
  return n;
}

export function leastTouchedSubject(bySubject, mySubjects) {
  if (!mySubjects || mySubjects.length === 0) return null;
  let best = null, bestHours = Infinity;
  for (const code of mySubjects) {
    const h = bySubject[code] || 0;
    if (h < bestHours) { best = code; bestHours = h; }
  }
  return best;
}
