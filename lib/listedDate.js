// "When was it listed?" for the Properties list — the date the listing landed on Casa
// Libre (properties.created_at: publish time for owners, first scrape for agencies),
// in the country's own time zone, plus a short "how long ago".
const TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };

export function listedDate(iso, { country = 'py', lang = 'es', now = Date.now() } = {}) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const en = lang === 'en';
  const timeZone = TZ[country] || TZ.py;
  const d = new Date(t);
  const date = d.toLocaleDateString(en ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  const full = d.toLocaleString(en ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  const hrs = Math.floor(mins / 60), days = Math.floor(hrs / 24);
  const ago = mins < 1 ? (en ? 'just now' : 'recién')
    : mins < 60 ? (en ? `${mins} min ago` : `hace ${mins} min`)
    : hrs < 24 ? (en ? `${hrs} h ago` : `hace ${hrs} h`)
    : days === 1 ? (en ? 'yesterday' : 'ayer')
    : days < 30 ? (en ? `${days} days ago` : `hace ${days} días`)
    : null;
  return { date, full, ago };
}
