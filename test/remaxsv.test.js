import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import remaxsv, { areaM2, mapType, parseDetail, parseContact, svPhone } from '../lib/adapters/remaxsv.js';

// Real pages (trimmed to the JSON-LD + the page's `information` object) from
// www.remax-centralamerica.com/<listing id>, fetched 2026-10-15.
const fx = (id) => fs.readFileSync(path.join(__dirname, 'fixtures', `remaxsv-cam-${id}.html`), 'utf8');

const DETAIL = `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstateListing","name":"APANECA | CABINS FOR SALE","description":"Cabaña en la Ruta de las Flores","url":"https://www.remax-elsalvador.com/el-salvador/apaneca/apaneca--003093331063","identifier":"003093331063","offers":{"@type":"Offer","priceCurrency":"USD","price":"147,000.00"},"about":{"@type":"Residence","address":{"@type":"PostalAddress","streetAddress":"Hotel Santa Leticia, Apaneca, Ahuachapán","addressRegion":"Ahuachapán","addressCountry":"El Salvador"}}}</script>
<ul><li><span>Property type:</span> <strong>House/Villa</strong></li><li><span>Contract type:</span> <strong>For Sale</strong></li>
<li><span>Bathrooms:</span> <strong>2</strong></li><li><span>Bedrooms:</span> <strong>3</strong></li><li><span>Garage capacity:</span> <strong>1</strong></li>
<li><span>Construction size:</span> <strong>99.00 Sq. Mt. -</strong></li><li><span>Lot size:</span> <strong>500.00 Sq. Vr. -</strong></li></ul>
<iframe src="https://maps.google.com/maps?q=13.853799,-89.782690&hl=es&z=14&amp;output=embed"></iframe>
<div data-src="https://images.remax-ccamls.com/003093331063/original/Photo_1.jpg"></div>
<div data-src="https://images.remax-ccamls.com/003093331063/original/Photo_1.jpg"></div>
<div data-src="https://remaxcaribbeanandcentralamerica.azureedge.net/images/003093331063/v3/HDPhotos/Foto 2.jpeg"></div>
<div data-src="https://images.remax-ccamls.com/003093331062/original/sibling-photo.jpg"></div>
<h3>Properties for sale in Ahuachapán</h3>
<div data-src="https://images.remax-ccamls.com/009999999999/original/other-listing.jpg"></div>`;

describe('RE/MAX El Salvador adapter', () => {
  it('sizes: square metres and varas cuadradas → m²', () => {
    expect(areaM2('99.00 Sq. Mt.')).toBe(99);
    expect(areaM2('3,772.40 Sq. Vr.')).toBe(2635.92);
    expect(areaM2('0.00 Sq. Mt.')).toBe(null);
    expect(areaM2('')).toBe(null);
  });

  it('decodes accents and dashes in texts', () => {
    const d = parseDetail(DETAIL.replace('Cabaña en la Ruta de las Flores', 'Venta en El Tr&aacute;nsito &ndash; 41 manzanas'), '003093331063');
    expect(d.description).toBe('Venta en El Tránsito – 41 manzanas');
  });

  it('property types → the Spanish types of the site', () => {
    expect(mapType('Lot/Land')).toBe('Terreno');
    expect(mapType('House/Villa')).toBe('Casa');
    expect(mapType('Apartment/Condo')).toBe('Departamento');
    expect(mapType('Office')).toBe('Oficina');
  });

  it('reads the detail page: JSON-LD, facts, map, the gallery above the similar-listings section (deduped)', () => {
    const d = parseDetail(DETAIL, '003093331063');
    expect(d).toMatchObject({ title: 'APANECA | CABINS FOR SALE', price: 147000, currency: 'USD', city: 'Apaneca', region: 'Ahuachapán', lat: 13.853799, lng: -89.78269 });
    expect(d.facts['Property type']).toBe('House/Villa');
    expect(d.images).toEqual([
      'https://images.remax-ccamls.com/003093331063/original/Photo_1.jpg',
      'https://remaxcaribbeanandcentralamerica.azureedge.net/images/003093331063/v3/HDPhotos/Foto%202.jpeg',
      'https://images.remax-ccamls.com/003093331062/original/sibling-photo.jpg',
    ]);
  });

  it('El Salvador phones → +503XXXXXXXX (agent mobiles "503 7xxxxxxx", office landlines "2xxx-xxxx")', () => {
    expect(svPhone('503 75299985')).toBe('+50375299985');
    expect(svPhone('2519-9530')).toBe('+50325199530');
    expect(svPhone('+(503) 7768-9994')).toBe('+50377689994');
    expect(svPhone('503 1234')).toBe(null);
    expect(svPhone('')).toBe(null);
    expect(svPhone('+1 305 555 1234')).toBe(null);
  });

  it('contact from the RE/MAX Central America page: agent phone first, named "Agent · Office"', () => {
    expect(parseContact(fx('003114742003'))).toMatchObject({ phone: '+50375299985', name: 'Douglas Anstirman · RE/MAX PRO', via: 'agent' });
    expect(parseContact(fx('002473227001'))).toMatchObject({ phone: '+50378883144', name: 'María Salaverria · RE/MAX EXPANSION', via: 'agent' });
  });

  it('falls back to the office phone when the agent has none', () => {
    const html = fx('003114742003').replace(/"telephone":"503 75299985"/, '"telephone":""').replace(/"mobile":"503 75299985"/, '"mobile":null');
    expect(parseContact(html)).toMatchObject({ phone: '+50325199530', name: 'RE/MAX PRO', via: 'office' });
    expect(parseContact('<html>nothing</html>')).toMatchObject({ phone: null, via: null });
  });

  it('maps the contact into contact_phone / contact_name', () => {
    const d = { ...parseDetail(DETAIL, '003093331063'), contact: parseContact(fx('003114742003')) };
    const m = remaxsv.mapListing(d, { source: { id: 'src' }, config: {} });
    expect(m.row).toMatchObject({ contact_phone: '+50375299985', contact_name: 'Douglas Anstirman · RE/MAX PRO' });
  });

  it('maps to a Casa Libre property: US$, sale, m², no phone when no contact was found', () => {
    const m = remaxsv.mapListing(parseDetail(DETAIL, '003093331063'), { source: { id: 'src' }, config: {} });
    expect(m.external_id).toBe('003093331063');
    expect(m.row).toMatchObject({ listing_type: 'sale', property_type: 'Casa', price: 147000, price_usd: 147000, currency: 'USD', bedrooms: 3, bathrooms: 2, parking_spaces: 1, covered_area: 99, land_area: 349.37, country: 'El Salvador', city: 'Apaneca', province: 'Ahuachapán', contact_phone: null, latitude: 13.853799 });
    expect(m.images.length).toBe(3);
    expect(m.images[0].is_feature).toBe(true);
  });
});
