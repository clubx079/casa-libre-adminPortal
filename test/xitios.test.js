import { describe, it, expect } from 'vitest';
import xitios, { areaM2, typeFromTitle, phoneIn, parseCards, parseDetail, placeFromTitle, placeParts } from '../lib/adapters/xitios.js';

const CARD = `<!-- ltn__product-item --> <div class="col-lg-12"> <div class="ltn__product-item"> <div class="product-img"> <a href="https://xitios.com.sv/propiedad/detalles/venta-de-casa-en-casas-del-bosque-pm"> <img src="https://xitios.com.sv/media/propiedad/06/venta-de-casa-en-casas-del-bosque-pm_phpYQKkux.webp" alt="#"></a> </div> <div class="product-info"> <div class="product-badge"> <ul> <li class="sale-badg">Venta</li> </ul> </div> <h2 class="product-title"><a href="https://xitios.com.sv/propiedad/detalles/venta-de-casa-en-casas-del-bosque-pm">Venta de Casa en Casas del Bosque PM</a></h2> <div class="product-img-location"> <ul> <li> <i class="flaticon-pin"></i> La Libertad, El Salvador </li> </ul> </div> <ul class="ltn__plot-brief"> <li><span>349 m2 </span> Área de construcción </li> <li><span>3 </span> Habitaciones </li> <li><span>4 </span> Baños </li> </ul> </div> <div class="product-info-bottom"> <div class="product-price"> <span>$850,000.00 </span> </div> </div> </div> </div>`;
const DETAIL = `<h1>Venta de Casa en Casas del Bosque PM</h1> <label><span class="ltn__secondary-color"><i class="flaticon-pin"></i></span> Nuevo Cuscatlán, La Libertad, El Salvador</label> <h4 class="title-2">Descripción</h4> <div class="content-description"><div>Venta de Casa en Casas del Bosque. C&oacute;digo CA-390.&nbsp;</div><div>- 740 v2 de terreno</div><div>Precio: $ 850,000</div><div>Informaci&oacute;n y Citas al 7923-2400</div></div> </div> <h4 class="title-2">Ubicación</h4>
<img src="https://xitios.com.sv/media/propiedad/06/venta-de-casa-en-casas-del-bosque-pm_phpWTSkUz.webp"><img src="https://xitios.com.sv/media/propiedad/06/venta-de-casa-en-casas-del-bosque-pm_phpWTSkUz.webp">
<img src="https://xitios.com.sv/media/propiedad/06/venta-de-casa-en-casas-del-bosque-pm_phpjIz4XM.webp"><img src="https://xitios.com.sv/media/propiedad/05/otra-propiedad-destacada_phpKjWHMq.webp">`;

describe('Xitios (El Salvador) adapter', () => {
  it('areas, types and the phone written in the description', () => {
    expect(areaM2('349 m2')).toBe(349);
    expect(areaM2('740 v2')).toBe(517.07);
    expect(typeFromTitle('Venta de Casa en Casas del Bosque')).toBe('Casa');
    expect(typeFromTitle('Alquiler de Apartamento en Torre Artea')).toBe('Departamento');
    expect(typeFromTitle('Venta de Terreno en Surf City')).toBe('Terreno');
    expect(phoneIn('Información y Citas al 7923-2400')).toBe('+50379232400');
    expect(phoneIn('WhatsApp: +503 6123 4567')).toBe('+50361234567');
    expect(phoneIn('Precio: $ 850,000')).toBe(null);
  });

  it('reads a search card', () => {
    const [c] = parseCards(`header ${CARD}`);
    expect(c).toMatchObject({ slug: 'venta-de-casa-en-casas-del-bosque-pm', title: 'Venta de Casa en Casas del Bosque PM', badge: 'Venta', location: 'La Libertad, El Salvador', built: 349, beds: 3, baths: 4, price: 850000 });
  });

  it('reads a listing page: municipality, description, only its own gallery (deduped)', () => {
    const d = parseDetail(DETAIL, 'venta-de-casa-en-casas-del-bosque-pm');
    expect(d.place).toBe('Nuevo Cuscatlán, La Libertad, El Salvador');
    expect(d.description).toContain('Código CA-390.');
    expect(d.images.length).toBe(2);
  });

  it('place to geocode: the development in the title + municipality', () => {
    expect(placeFromTitle('Venta de Casa en Casas del Bosque PM')).toBe('Casas del Bosque');
    expect(placeFromTitle('Alquiler de Apartamento en Torre Artea')).toBe('Torre Artea');
    expect(placeParts({ place: 'Nuevo Cuscatlán, La Libertad, El Salvador' })).toEqual({ city: 'Nuevo Cuscatlán', province: 'La Libertad' });
    const m = xitios.mapListing({ slug: 'x', title: 'Casa', place: 'Santa Tecla, La Libertad', lat: 13.67, lng: -89.28 }, { source: { id: 's' }, config: {} });
    expect(m.row).toMatchObject({ latitude: 13.67, longitude: -89.28 });
  });

  it('maps to a Casa Libre property with a published contact number', () => {
    const [c] = parseCards(`x ${CARD}`);
    Object.assign(c, parseDetail(DETAIL, c.slug));
    const m = xitios.mapListing(c, { source: { id: 's' }, config: {} });
    expect(m.row).toMatchObject({ listing_type: 'sale', property_type: 'Casa', price: 850000, currency: 'USD', bedrooms: 3, bathrooms: 4, covered_area: 349, city: 'Nuevo Cuscatlán', province: 'La Libertad', country: 'El Salvador', contact_phone: '+50379232400', contact_name: 'Xitios Bienes Raíces' });
    expect(m.images[0].is_feature).toBe(true);
    // no number in the description → the agency's published WhatsApp
    const m2 = xitios.mapListing({ ...c, description: 'Sin teléfono' }, { source: { id: 's' }, config: {} });
    expect(m2.row.contact_phone).toBe('+50379212125');
  });
});
