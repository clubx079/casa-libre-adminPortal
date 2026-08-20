import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// IP -> city/state/country via ip-api.com. The free tier is rate-limited, so we
// (1) cache every result in-process and (2) resolve many IPs in one batch request.
// Mirrors the DeelMap admin's users/geo-lookup implementation.
const cache = new Map(); // ip -> { city, state, country }
const NULL_GEO = { city: null, state: null, country: null };

// ip-api /batch accepts up to 100 IPs per POST and echoes `query` back so we can
// map results to inputs. Chunks of 100 keep us within limits.
async function batchLookup(ips) {
  const out = {};
  for (let i = 0; i < ips.length; i += 100) {
    const chunk = ips.slice(i, i + 100);
    try {
      const res = await fetch('http://ip-api.com/batch?fields=status,city,regionName,countryCode,query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      for (const d of Array.isArray(data) ? data : []) {
        const geo = d.status === 'success'
          ? { city: d.city, state: d.regionName, country: d.countryCode }
          : NULL_GEO;
        if (d.query) { out[d.query] = geo; cache.set(d.query, geo); }
      }
    } catch {
      for (const ip of chunk) if (!out[ip]) out[ip] = NULL_GEO;
    }
  }
  return out;
}

// POST { ips: [...] } -> { ip: { city, state, country } }  (cached-first, then batch)
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let ips = [];
  try { ips = (await req.json())?.ips || []; } catch {}
  ips = [...new Set(ips.filter(Boolean))];

  const result = {};
  const misses = [];
  for (const ip of ips) {
    if (cache.has(ip)) result[ip] = cache.get(ip);
    else misses.push(ip);
  }
  if (misses.length) Object.assign(result, await batchLookup(misses));

  return NextResponse.json(result);
}
