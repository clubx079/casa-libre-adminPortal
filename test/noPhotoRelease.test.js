import { describe, it, expect, afterEach } from 'vitest';
import { pickReleasable } from '../lib/noPhotoRelease';
import { splitReasons, canGoLive, quarantineState, publishWithoutPhotos } from '../lib/unverified';

const prop = (id, extra = {}) => ({
  id, source_id: 's1', external_id: `e-${id}`, admin_status: 'inactive', is_delisted: false, feature_image_url: null,
  contact_phone: '595981000000', city: 'Asunción', neighborhood: 'Villa Morra', latitude: -25.29, longitude: -57.58,
  dedupe_key: `k-${id}`, ...extra,
});
const rec = (id, reasons = ['no_images']) => ({ id: `q-${id}`, source_id: 's1', external_id: `e-${id}`, reasons });

describe('no_images is not a blocking reason while PUBLISH_WITHOUT_PHOTOS is on', () => {
  afterEach(() => { delete process.env.PUBLISH_WITHOUT_PHOTOS; });
  it('default on', () => {
    expect(publishWithoutPhotos()).toBe(true);
    expect(splitReasons(['no_images']).blocking).toEqual([]);
    expect(canGoLive(['no_images'], 'py')).toBe(true);
    expect(quarantineState({ reasons: ['no_images'], onSite: false, duplicateOfLive: false, cc: 'py' })).toBe('ready');
  });
  it('a duplicate or missing contact still blocks', () => {
    expect(canGoLive(['no_images', 'duplicate'], 'py')).toBe(false);
    expect(canGoLive(['no_images', 'no_contact'], 'py')).toBe(false);
    expect(quarantineState({ reasons: ['no_images'], onSite: false, duplicateOfLive: true, cc: 'py' })).toBe('blocked');
  });
  it('PUBLISH_WITHOUT_PHOTOS=0 restores the old rule', () => {
    process.env.PUBLISH_WITHOUT_PHOTOS = '0';
    expect(splitReasons(['no_images']).blocking).toEqual(['no_images']);
    expect(canGoLive(['no_images'], 'py')).toBe(false);
  });
});

describe('pickReleasable', () => {
  it('releases held no-photo listings and skips duplicates, out-of-country and incomplete ones', () => {
    const properties = [
      prop('ok'),
      prop('dupLive', { dedupe_key: 'shared-live' }),
      prop('batchA', { dedupe_key: 'same' }),
      prop('batchB', { dedupe_key: 'same' }),
      prop('abroad', { latitude: -34.9, longitude: -56.16 }),          // Montevideo pin on a PY listing
      prop('nophone', { contact_phone: null }),
      prop('live', { admin_status: 'active' }),
      prop('otherReason'),
    ];
    const records = [rec('ok'), rec('dupLive'), rec('batchA'), rec('batchB'), rec('abroad'), rec('nophone'), rec('live'), rec('otherReason', ['no_images', 'unverified_seller'])];
    const liveByKey = new Map([['shared-live', 'some-live-id']]);
    const { release, skipped } = pickReleasable({ records, properties, liveByKey, cc: 'py' });
    expect(release.map((r) => r.property_id)).toEqual(['ok', 'batchA']);
    expect(release[0].record_id).toBe('q-ok');
    expect(skipped).toEqual({ duplicate_of_live: 1, duplicate_in_batch: 1, out_of_country: 1, no_contact: 1, not_held: 1 });
  });
});
