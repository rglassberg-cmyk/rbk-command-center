// Israel Fund event-name normalization.
//
// Veracross emits event names with varying prefixes and minor wording
// drift (e.g. "APL: Kfar Aza Refugee Support", "DEV: Kfar Aza Children",
// "Latet Israel Pesach 2024"). For the Israel Fund money-in cache we
// collapse them onto a canonical set that matches Emily's tracker.
//
// Returning `null` means "drop this event entirely from the Israel
// Fund view" — used for events that pass the External Funds filter but
// don't belong on this page (e.g. Columbus Baseball Tournament).
//
// New normalization rules belong here, not inline in route/sync code,
// so the page route and the incremental sync stay in lockstep.

export function normalizeIsraelFundEvent(rawName: string): string | null {
  let name = rawName.replace(/^(APL:|DEV:)\s*/i, '').trim();

  if (name === 'Columbus Baseball Tournament') return null;
  if (name.startsWith('Kfar Aza')) return 'Kfar Aza';
  if (name === 'Latet - Purim 24' || /Latet Israel Pesach/i.test(name)) return 'Latet';
  if (/resilience/i.test(name) || /baking for a better world/i.test(name)) return 'Israel Crisis';
  if (name === 'Yeshivat Hesder Kiryat Shmona Israel') return 'Kiryat Shemona Yeshivah';
  if (name === 'Israel - Omri Hadad') return 'Education Sayeret Matkal Soldier';

  return name;
}
