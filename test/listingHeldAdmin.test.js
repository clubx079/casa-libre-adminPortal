import { describe, it, expect } from 'vitest';
import { listingHeldConfig, validateListingHeld, saveListingHeld, listingHeldCounts, LISTING_HELD_TEMPLATES } from '../lib/listingHeldAdmin.js';
import { automationSlots } from '../lib/whatsappAdmin.js';

describe('Listing not published (admin)', () => {
  it('defaults before the first save: 3 hours, reminder 45 hours later', () => {
    expect(listingHeldConfig(null)).toEqual({ enabled: false, enabledAt: null, hours: 3, reminderAfter: 45 });
  });
  it('saves hours as milestones; switching on stamps enabled_at', () => {
    const v = validateListingHeld({ hours: 4, reminderAfter: 20, enabled: true }, null, 'T');
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ milestones: [4, 24], enabled: true, enabled_at: 'T' });
    expect(validateListingHeld({ hours: 4, reminderAfter: '' }).value.milestones).toEqual([4]);
    expect(validateListingHeld({ hours: 0 }).errors.hours).toBeTruthy();
  });
  it('every email has the My listings button', () => {
    for (const t of LISTING_HELD_TEMPLATES) { expect(t.button_url).toBe('{{my_listings_url}}'); expect(t.body).toContain('{{property_title}}'); }
  });
  it('first save creates the four emails and the row', async () => {
    const inserted = [];
    const db = { select: async () => [], insert: async (table, rows) => { inserted.push([table, rows[0].key || rows[0].id]); return rows; }, update: async () => {} };
    const r = await saveListingHeld(db, { hours: 3, reminderAfter: 45 }, 'T');
    expect(r.ok && r.created).toBe(true);
    expect(inserted.filter(([t]) => t === 'email_templates').map(([, k]) => k)).toEqual(['listing-held-payment', 'listing-held-photos', 'listing-held-paused', 'listing-held-incomplete']);
    expect(inserted.at(-1)).toEqual(['automations', 'listing_held']);
  });
  it('counts sent per reason, and offers a WhatsApp template per reason', () => {
    expect(listingHeldCounts([{ dedupe_key: 'held:p1:payment:1' }, { dedupe_key: 'held:p1:payment:2' }, { dedupe_key: 'held:p2:photos:1' }, { dedupe_key: 'held:p2:photos:1:wa' }])).toEqual({ payment: 2, photos: 1 });
    const emails = LISTING_HELD_TEMPLATES.map((t, i) => ({ id: `e${i}`, key: t.key, name: t.name }));
    expect(automationSlots({ id: 'listing_held' }, emails).map((s) => s.suggested)).toEqual(['cl_pendiente_pago', 'cl_fotos_rechazadas', 'cl_publicacion_pausada', 'cl_publicacion_incompleta']);
  });
});
