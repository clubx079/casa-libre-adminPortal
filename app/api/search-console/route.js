// GET /api/search-console?days=7|28|90 — Google Search Console for the active country's site
// (lib/searchConsole.js overview): clicks, impressions, CTR, position, daily series, top keywords,
// top pages, devices, countries, sitemaps. Read-only. No access → { access: false }.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { overview } from '@/lib/searchConsole';
import { translateText } from '@/lib/groqTranslate';
import { translateManyToEnglish } from '@/lib/translate';

// English for each keyword, in one Groq call (numbered lines keep the order); free translator as
// fallback. Cached per keyword for the life of the process.
const enCache = new Map();
async function english(list) {
  const todo = [...new Set(list.filter((q) => q && !enCache.has(q)))];
  if (todo.length) {
    let out = null;
    try {
      const t = await translateText(todo.map((q, i) => `${i + 1}. ${q}`).join('\n'), 'en', {
        system: 'Translate each numbered Spanish search query from Paraguay into short natural English. Keep the numbering, one per line, nothing else.',
      });
      if (t) {
        const m = new Map(String(t).split('\n').map((l) => /^\s*(\d+)[.)]\s*(.+)$/.exec(l)).filter(Boolean).map((x) => [Number(x[1]), x[2].trim()]));
        out = todo.map((_, i) => m.get(i + 1) || null);
      }
    } catch { out = null; }
    if (!out || out.some((x) => !x)) {
      const free = await translateManyToEnglish(todo).catch(() => []);
      out = todo.map((q, i) => out?.[i] || free?.[i] || null);
    }
    todo.forEach((q, i) => { if (out[i]) enCache.set(q, out[i]); });
  }
  return list.map((q) => enCache.get(q) || null);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cache = new Map(); // `${cc}:${days}` -> { at, data }

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const d = Number(new URL(req.url).searchParams.get('days'));
  const days = [7, 28, 90].includes(d) ? d : 28;
  const key = `${cc}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return NextResponse.json(hit.data);
  try {
    const data = await overview(cc, days);
    if (data.access && data.queries?.length) {
      const en = await english(data.queries.map((q) => q.key)).catch(() => []);
      data.queries = data.queries.map((q, i) => ({ ...q, en: en[i] || null }));
    }
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), country: cc }, { status: 502 });
  }
}
