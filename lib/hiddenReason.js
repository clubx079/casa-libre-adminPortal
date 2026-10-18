// Why a USER listing is not on the site (Properties → Originals). Pure (no env / I/O) so it is unit-tested.
//
// The website keeps these listings off the site with properties.status (buyer
// lib/listings.js HIDDEN_STATUS) and admin_status 'inactive':
//   scanning          photos still being checked by the AI check (temporary)
//   rejected          a photo failed the AI check (raw_data.moderation.photos)
//   duplicate_review  held as a possible copy of one of their own listings
//   payment_pending   over the free listings of the month, not paid yet
//   expired           the paid period ended
// Anything else that is admin-inactive was switched off by hand (admin_off); an
// admin-active row that fails the listing checks is 'incomplete' (r._problems);
// a sell-wizard address held in Quarantine never became a property ('quarantine').

export const REASONS = {
  rejected: { es: 'Fotos rechazadas', en: 'Photos rejected', tone: 'bad' },
  duplicate_review: { es: 'Posible duplicado', en: 'Possible duplicate', tone: 'bad' },
  payment_pending: { es: 'Falta el pago', en: 'Waiting for payment', tone: 'wait' },
  expired: { es: 'Terminó el período pago', en: 'Paid period ended', tone: 'wait' },
  admin_off: { es: 'Desactivada por un admin', en: 'Turned off by an admin', tone: 'bad' },
  incomplete: { es: 'Faltan datos', en: 'Missing details', tone: 'bad' },
  scanning: { es: 'Revisando fotos', en: 'Photos being checked', tone: 'wait' },
  quarantine: { es: 'En cuarentena', en: 'In quarantine', tone: 'bad' },
};
export const REASON_ORDER = Object.keys(REASONS);

export const reasonLabel = (code, lang = 'en') => REASONS[code]?.[lang === 'es' ? 'es' : 'en'] || code;

// → null when the listing is live, else { code, failedPhotos?, totalPhotos? }.
export function hiddenReason(r) {
  if (!r) return null;
  if (r._held) return { code: 'quarantine' };
  const live = r.admin_status === 'active' && r.is_complete === true;
  if (live) return null;
  if (r.status && REASONS[r.status] && r.status !== 'admin_off' && r.status !== 'incomplete' && r.status !== 'quarantine') {
    if (r.status === 'rejected') {
      const photos = Array.isArray(r.moderation?.photos) ? r.moderation.photos : [];
      return { code: 'rejected', failedPhotos: photos.filter((p) => p?.verdict === 'fail').length, totalPhotos: photos.length };
    }
    return { code: r.status };
  }
  if (r.admin_status !== 'active') return { code: 'admin_off' };
  return { code: 'incomplete' };
}

// Short line under the reason pill.
export function reasonDetail(reason, { lang = 'en', problems = '' } = {}) {
  if (!reason) return '';
  const es = lang === 'es';
  if (reason.code === 'rejected' && reason.totalPhotos) return es ? `${reason.failedPhotos} de ${reason.totalPhotos} fotos no pasaron la revisión` : `${reason.failedPhotos} of ${reason.totalPhotos} photos failed the check`;
  if (reason.code === 'incomplete') return problems;
  return '';
}
