// The Properties list's type filter (Buildings / Land / All) and what it shows when the URL has
// no ?class=: Scraped opens on Buildings (thousands of rows; land is the minority and is looked
// at on purpose), Originals — what users published themselves, a short list — opens on All, so a
// seller's land listing is never hidden by default. The URL only carries ?class= when it differs
// from that page's default. Pure — test/propertyClass.test.js.
export const CLASSES = ['buildings', 'land', 'all'];
export const defaultClass = (kind) => (kind === 'originals' ? 'all' : 'buildings');
export const classOf = (param, kind) => (CLASSES.includes(param) ? param : defaultClass(kind));
// → the value for the URL's ?class=, or '' to leave it out
export const classParam = (cls, kind) => (CLASSES.includes(cls) && cls !== defaultClass(kind) ? cls : '');
