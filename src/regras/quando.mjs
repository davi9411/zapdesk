// "16:30" (hoje) ou "2026-10-08 16:30" -> timestamp unix; null se inválido.
export function parseQuando(s, hoje = new Date()) {
  let d;
  const t = String(s || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    if (h > 23 || m > 59) return null;
    d = new Date(hoje); d.setHours(h, m, 0, 0);
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(t)) d = new Date(t.replace(' ', 'T').replace(/T(\d):/, 'T0$1:'));
  if (!d || isNaN(d)) return null;
  return Math.floor(d.getTime() / 1000);
}
