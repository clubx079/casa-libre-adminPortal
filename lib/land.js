// Land / lot classification, shared by the scrape pipeline and the properties
// query. "Buildings" = houses, apartments, commercial, condos, auctions, …
// "Land" = raw lots / terrenos / loteamientos / campos.

export const LAND_PATTERNS = ['lote', 'terreno', 'campo', 'fracci', 'parcela'];
export const LAND_RE = new RegExp(LAND_PATTERNS.join('|'), 'i');

// True when a property_type denotes raw land (loteamiento, Lotes, terreno, campo, …).
export const isLandType = (t) => t != null && LAND_RE.test(String(t));

// AiroBase's PostgREST uses `%` (URL-encoded %25) as the ilike wildcard; `*` is ignored.
// EXCLUDE land: repeated not.ilike parts (AND-ed). (Null-type rows are excluded too.)
export const buildingsParts = () => LAND_PATTERNS.map((p) => `property_type=not.ilike.%25${p}%25`);
// ONLY land: an OR-group of ilike patterns (used inside `or=(...)` or `and=(or(...),...)`).
export const landOrGroup = () => LAND_PATTERNS.map((p) => `property_type.ilike.%25${p}%25`).join(',');
