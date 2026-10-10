// Every row of a query, in pages of `size`, with the pages read at the same time (not one
// after another — each round trip to the database is ~0.3–0.8 s). How many pages to ask
// for is remembered from the last read of the same query, so they all start at once; a
// first read (or one that grew past it) asks the first page with an exact count first.
// `db` = dbFor(country). Rows are de-duplicated by id in case one was added between pages.
const lastCount = (globalThis.__clSelectAllCounts ||= new Map()); // table?query -> rows last time

export async function selectAll(db, table, query, size = 1000) {
  const key = `${table}?${query}`;
  const page = (off) => db.select(table, `${query}&limit=${size}&offset=${off}`);
  let rows;
  const guess = lastCount.get(key);
  if (guess !== undefined) {
    const pages = await Promise.all(Array.from({ length: Math.floor(guess / size) + 1 }, (_, i) => page(i * size)));
    rows = pages.flat();
    // grew past the guess: keep reading until a page comes back short
    for (let off = pages.length * size; pages[pages.length - 1].length === size; off += size) {
      pages.push(await page(off));
      rows = rows.concat(pages[pages.length - 1]);
    }
  } else {
    const first = await db.selectWithCount(table, `${query}&limit=${size}&offset=0`);
    const offsets = [];
    if (first.rows.length >= size) for (let off = size; off < first.count; off += size) offsets.push(off);
    rows = first.rows.concat(...(await Promise.all(offsets.map(page))));
  }
  if (lastCount.size > 200) lastCount.clear();
  lastCount.set(key, rows.length);
  if (!rows.length || rows[0].id === undefined) return rows;
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
}

// selectIn: rows whose `col` is one of `vals`, asked in chunks of 150 (URL length) — all
// chunks at the same time.
const inList = (vals) => vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',');
export async function selectIn(select, table, cols, col, vals, extra = '', chunk = 150) {
  const parts = [];
  for (let i = 0; i < vals.length; i += chunk) parts.push(vals.slice(i, i + chunk));
  const out = await Promise.all(parts.map((p) => select(table, `select=${cols}&${col}=in.(${encodeURIComponent(inList(p))})${extra}`)));
  return out.flat();
}
