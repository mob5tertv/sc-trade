const NBSP = ' ';

// Russian decimal separator
function comma(n: number): string {
  return String(n).replace('.', ',');
}

/** '6 120' (non-breaking space as the thousands separator). */
export function formatUec(n: number): string {
  const rounded = Math.round(n);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return rounded < 0 ? `-${digits}` : digits;
}

/** '936k', '1,25M'. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const units = Math.round(abs);
  if (units < 1000) return units === 0 ? '0' : `${sign}${units}`;
  const thousands = Math.round(abs / 1000);
  if (thousands < 1000) return `${sign}${thousands}k`;
  return `${sign}${comma(Math.round(abs / 10_000) / 100)}M`;
}

/** '12,7%' from a ratio of 0.127. */
export function formatPct(ratio: number): string {
  const tenths = Math.round(ratio * 1000) / 10;
  return `${(tenths === 0 ? 0 : tenths).toFixed(1).replace('.', ',')}%`;
}

/** Age of a data point: 'сейчас', '40 мин', '1,5 ч' (half-hour steps), '2 д'. Rounds down. */
export function formatAge(sec: number): string {
  if (sec < 60) return 'сейчас';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин`;
  if (sec < 86_400) return `${comma(Math.floor(sec / 1800) / 2)} ч`;
  return `${Math.floor(sec / 86_400)} д`;
}

/** '14:32' or '1:04:32'. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
