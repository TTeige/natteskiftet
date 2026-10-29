// Lokal tid med UTC-offset, slik loggene skriver den: 2026-10-29T03:12:00+01:00.
export function iso(ms) {
  const offset = -new Date(ms).getTimezoneOffset();
  const lokal = new Date(ms + offset * 60000).toISOString().slice(0, 19);
  const t = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const m = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${lokal}${offset < 0 ? '-' : '+'}${t}:${m}`;
}

export const klokke = (ms) => iso(ms).slice(11, 16);
